import fs from 'node:fs';
import path from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { SETTINGS } from '@/structures/settings.js';
import { SITE_STORAGE_PREFIX } from '@/utils/AlbumWebsite.js';
import { uploadPath, watchPath } from '@/utils/File.js';
import { applyUploadSecurityHeaders } from '@/utils/UploadSecurity.js';

/*
	Serves the bytes of a website file by uuid.

	The files of a website album are stored under their real path
	(`site/{albumIdentifier}/{sitePath}`), which is not reachable as a flat
	upload URL, and the album may not have a public link at all. The gallery,
	the album cover and the upload panel still have to show them, so the uuid
	the row already has becomes the address: it is unguessable, it survives a
	replace-in-place and it does not depend on the album being shared.
*/

export const schema = {
	summary: 'Get file content',
	description:
		'Serves the bytes of a website file. Used for the gallery previews of files stored under their website path.',
	tags: ['Files'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the file.')
		})
		.required(),
	response: {
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/file/:uuid/content',
	method: 'get',
	middlewares: ['apiKey']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };

	const file = await prisma.files.findFirst({
		where: {
			uuid,
			// Nothing that is quarantined is ever served
			quarantine: false,
			// Only the files stored under their website path are addressed here
			name: { startsWith: `${SITE_STORAGE_PREFIX}/` }
		},
		select: {
			hash: true,
			isS3: true,
			isWatched: true,
			name: true,
			size: true,
			type: true
		}
	});

	if (!file) {
		void res.notFound('The file could not be found');
		return;
	}

	const etag = `"${file.hash}"`;
	const ifNoneMatch = req.headers['if-none-match'];
	if (ifNoneMatch?.split(',').some(value => value.trim() === etag)) {
		res.header('ETag', etag);
		void res.code(304).send();
		return;
	}

	applyUploadSecurityHeaders(res);
	res.header('Content-Type', file.type || 'application/octet-stream');
	// The name is not sent along: it is user controlled and may not be ASCII
	res.header('Content-Disposition', 'inline');
	// The uuid stays the same when the file is replaced, so a cached copy has to
	// be revalidated against the ETag on every request
	res.header('Cache-Control', 'no-cache');
	res.header('ETag', etag);

	if (file.isS3) {
		try {
			const { createS3Client } = await import('@/structures/s3.js');
			const client = createS3Client();
			const object = await client.send(
				new GetObjectCommand({
					Bucket: SETTINGS.S3Bucket,
					Key: file.name
				})
			);

			if (!object.Body) throw new Error('S3 returned an empty body');

			res.header('Content-Length', String(object.ContentLength ?? file.size));
			return res.send(object.Body);
		} catch (error) {
			req.log.error(error, `Failed to fetch the website file ${file.name}`);
			void res.notFound('The file could not be found');
			return;
		}
	}

	const filePath = path.join(file.isWatched ? watchPath : uploadPath, file.name);
	const stats = await fs.promises.stat(filePath).catch(() => null);
	if (!stats) {
		void res.notFound('The file could not be found');
		return;
	}

	res.header('Content-Length', String(stats.size));
	return res.send(fs.createReadStream(filePath));
};
