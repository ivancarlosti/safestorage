import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyRequest } from 'fastify';
import prisma from '@/structures/database.js';
import { SETTINGS } from '@/structures/settings.js';
import {
	buildSiteIndex,
	isDocumentSitePath,
	resolveSiteRequest,
	type SiteFileEntry,
	type SiteIndex
} from '@/utils/AlbumWebsite.js';
import { uploadPath, watchPath } from '@/utils/File.js';
import { log, logError } from '@/utils/Logger.js';
import { applyWebsiteSecurityHeaders, type WebsiteSecurityMode } from '@/utils/WebsiteSecurity.js';

/*
	Serves an album as a static website, both for `/site/{identifier}/…` (path
	mode) and for `{identifier}.{hostingDomain}` (domain mode). The website is only
	ever served when the instance switch is on, the album is flagged as a website
	and the link itself has `serveWebsite`.
*/

export interface HostedSite {
	index: SiteIndex;
	linkId: number;
}

/*
	Returns the site for a link identifier, or `null` for anything that must look
	like a missing page (disabled link, expired link, album not a website, hosting
	turned off). Every failure answers the same 404 on purpose: a visitor should
	not be able to tell a disabled website from an identifier that never existed.
*/
export const loadHostedSite = async (identifier: string): Promise<HostedSite | null> => {
	if (!SETTINGS.websiteHostingEnabled) return null;

	const link = await prisma.links.findFirst({
		where: {
			identifier,
			enabled: true,
			serveWebsite: true
		},
		select: {
			id: true,
			albumId: true,
			expiresAt: true
		}
	});

	if (!link) return null;
	if (link.expiresAt && link.expiresAt < new Date()) return null;

	const album = await prisma.albums.findFirst({
		where: {
			id: link.albumId,
			isWebsite: true
		},
		select: {
			id: true
		}
	});

	if (!album) return null;

	const files = await prisma.files.findMany({
		where: {
			albums: {
				some: {
					id: link.albumId
				}
			},
			// Quarantined files are not part of anything that is served publicly.
			quarantine: false
		},
		select: {
			createdAt: true,
			hash: true,
			isS3: true,
			isWatched: true,
			name: true,
			original: true,
			sitePath: true,
			size: true,
			type: true,
			uuid: true
		}
	});

	return { index: buildSiteIndex(files as SiteFileEntry[]), linkId: link.id };
};

export type ParsedRange = { end: number; start: number } | 'invalid' | undefined;

/*
	The subset of a Fastify reply the website server needs. Domain mode cannot use
	`reply.send()` (a hijacked reply is considered sent), so it implements this
	interface on top of the raw socket instead.
*/
export interface WebsiteResponse {
	code: (statusCode: number) => WebsiteResponse;
	header: (name: string, value: string) => WebsiteResponse;
	send: (payload?: unknown) => unknown;
}

/*
	Parses a single `bytes=` range. Multiple ranges are refused (`invalid`)
	instead of being silently joined: it keeps the response a single stream.
*/
export const parseRangeHeader = (header: string | undefined, size: number): ParsedRange => {
	if (!header) return undefined;
	if (size <= 0) return 'invalid';

	const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/.exec(header.trim());
	if (!match) return 'invalid';

	const rawStart = match.groups?.start ?? '';
	const rawEnd = match.groups?.end ?? '';
	if (!rawStart && !rawEnd) return 'invalid';

	if (!rawStart) {
		const suffix = Number(rawEnd);
		if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
		return { start: Math.max(size - suffix, 0), end: size - 1 };
	}

	const start = Number(rawStart);
	let end = rawEnd ? Number(rawEnd) : size - 1;
	if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return 'invalid';

	end = Math.min(end, size - 1);
	return { start, end };
};

const countSiteView = async (linkId: number) => {
	// Views were always best-effort: a failed counter must not fail the page.
	try {
		await prisma.links.update({
			where: { id: linkId },
			data: { views: { increment: 1 } }
		});
	} catch (error) {
		logError(log, 'Failed to count a website view', error);
	}
};

const notFoundBody =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title></head><body><h1>404</h1><p>This page does not exist on this website.</p></body></html>';

interface OpenedSiteFile {
	contentLength: number;
	stream?: Readable;
}

/*
	Opens the bytes of a file. S3 files are proxied instead of being redirected to
	a pre-signed URL: the security headers, the Content-Type of the row and the
	Range support all have to stay under the backend's control.
*/
const openSiteFile = async (entry: SiteFileEntry, range: Exclude<ParsedRange, 'invalid'> | undefined) => {
	const size = Number(entry.size);

	if (entry.isS3) {
		const { createS3Client } = await import('@/structures/s3.js');
		const client = createS3Client();
		const result = await client.send(
			new GetObjectCommand({
				Bucket: SETTINGS.S3Bucket,
				Key: entry.name,
				Range: range ? `bytes=${range.start}-${range.end}` : undefined
			})
		);

		if (!result.Body) throw new Error('S3 returned an empty body');

		return {
			contentLength: range ? range.end - range.start + 1 : (result.ContentLength ?? size),
			stream: result.Body as unknown as Readable
		} satisfies OpenedSiteFile;
	}

	const filePath = path.join(entry.isWatched ? watchPath : uploadPath, entry.name);
	/*
		The row says the file exists, but a watched file can be removed from disk
		(or the volume can be restored from another machine). Statting first turns
		that into a clean 404 instead of a response whose headers promise bytes that
		never arrive.
	*/
	const stats = await fs.promises.stat(filePath);
	const stream = fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);

	return {
		contentLength: range ? range.end - range.start + 1 : stats.size,
		stream
	} satisfies OpenedSiteFile;
};

const sendSiteFile = async ({
	entry,
	mode,
	req,
	res,
	sitePath,
	status = 200
}: {
	entry: SiteFileEntry;
	mode: WebsiteSecurityMode;
	req: FastifyRequest;
	res: WebsiteResponse;
	sitePath: string;
	status?: number;
}) => {
	applyWebsiteSecurityHeaders(res, mode);
	res.header('Accept-Ranges', 'bytes');
	res.header('Content-Type', entry.type || 'application/octet-stream');
	res.header('Cache-Control', isDocumentSitePath(sitePath) ? 'no-cache' : 'public, max-age=31536000, immutable');

	const etag = `"${entry.hash}"`;
	res.header('ETag', etag);

	const ifNoneMatch = req.headers['if-none-match'];
	if (
		ifNoneMatch &&
		ifNoneMatch
			.split(',')
			.map(value => value.trim())
			.includes(etag)
	) {
		res.code(304);
		return res.send();
	}

	const size = Number(entry.size);
	const range = parseRangeHeader(req.headers.range as string | undefined, size);

	if (range === 'invalid') {
		res.header('Content-Range', `bytes */${size}`);
		res.code(416);
		return res.send({ message: 'Range not satisfiable' });
	}

	if (req.method === 'HEAD') {
		res.header('Content-Length', String(range ? range.end - range.start + 1 : size));
		if (range) res.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
		res.code(range ? 206 : status);
		return res.send();
	}

	let opened: OpenedSiteFile;
	try {
		opened = await openSiteFile(entry, range);
	} catch (error) {
		logError(req.log, `Failed to open the website file ${entry.name}`, error);
		return sendSiteNotFound({ mode, req, res });
	}

	res.header('Content-Length', String(opened.contentLength));
	if (range) res.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
	res.code(range ? 206 : status);

	return res.send(opened.stream);
};

const sendSiteNotFound = async ({
	mode,
	req,
	res
}: {
	mode: WebsiteSecurityMode;
	req: FastifyRequest;
	res: WebsiteResponse;
}) => {
	applyWebsiteSecurityHeaders(res, mode);
	res.header('Content-Type', 'text/html; charset=utf-8');
	res.header('Cache-Control', 'no-store');
	res.code(404);

	return res.send(req.method === 'HEAD' ? undefined : notFoundBody);
};

export interface HandleWebsiteRequestOptions {
	identifier: string;
	mode: WebsiteSecurityMode;
	requestPath: string;
}

/*
	Resolves and answers one request for a hosted website. Shared by the `/site`
	routes and by the subdomain hook so both entry points behave identically.
*/
export const handleWebsiteRequest = async ({
	identifier,
	mode,
	requestPath,
	req,
	res
}: HandleWebsiteRequestOptions & { req: FastifyRequest; res: WebsiteResponse }) => {
	const site = await loadHostedSite(identifier);
	if (!site) return sendSiteNotFound({ mode, req, res });

	// Both entry points hand over the raw request target, which can carry a query
	// string or a fragment; only the pathname is part of the site path.
	const pathname = requestPath.split('?')[0]!.split('#')[0]!;
	const resolution = resolveSiteRequest(site.index, pathname);

	if (resolution.status === 301) {
		res.header('Cache-Control', 'no-store');
		res.code(301).header('Location', resolution.location);
		return res.send();
	}

	if (resolution.status === 404) {
		if (resolution.fallback) {
			return sendSiteFile({
				entry: resolution.fallback,
				mode,
				req,
				res,
				sitePath: resolution.fallback.sitePath ?? '',
				status: 404
			});
		}

		return sendSiteNotFound({ mode, req, res });
	}

	if (isDocumentSitePath(resolution.path)) void countSiteView(site.linkId);

	return sendSiteFile({ entry: resolution.entry, mode, req, res, sitePath: resolution.path });
};
