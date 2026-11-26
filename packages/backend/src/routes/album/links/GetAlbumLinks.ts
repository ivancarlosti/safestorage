import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { SETTINGS } from '@/structures/settings.js';
import { buildSiteIndex, type SiteFileEntry } from '@/utils/AlbumWebsite.js';
import { getWebsiteUrl } from '@/utils/WebsiteUrl.js';

export const schema = {
	summary: 'Get links',
	description: 'Gets all existing album links',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.')
		})
		.required(),
	response: {
		200: z.object({
			message: responseMessageSchema,
			websiteWarnings: z
				.array(z.string())
				.describe('Path conflicts that keep files from being served on the album website.'),
			links: z.array(
				z.object({
					identifier: z.string().describe('The identifier of the link'),
					uuid: z.string().describe('The uuid of the link'),
					enabled: z.boolean().describe('Whether the link is enabled'),
					enableDownload: z.boolean().describe('Whether the link allows downloads'),
					allowUploads: z.boolean().describe('Whether visitors can upload files through the link'),
					hideFiles: z
						.boolean()
						.describe('Whether the album contents are hidden and only the visitor uploads are shown'),
					serveWebsite: z.boolean().describe('Whether the link serves the album as a static website'),
					websiteUrl: z
						.string()
						.nullable()
						.describe('The URL of the website, or null when the link does not serve one'),
					viewMode: z
						.enum(['list', 'thumbs'])
						.nullable()
						.describe('The view mode of the link, or null to inherit the album'),
					expiresAt: z.date().nullable().describe('The expiration date of the link'),
					views: z.number().describe('The amount of views the link has'),
					createdAt: z.date().describe('The creation date of the link'),
					editedAt: z.date().nullable().describe('The last edit date of the link'),
					albumUuid: z.string().describe('The uuid of the album')
				})
			)
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:uuid/links',
	method: 'get',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };
	if (!uuid) {
		void res.badRequest('Invalid uuid supplied');
		return;
	}

	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		},
		select: {
			id: true,
			isWebsite: true
		}
	});

	if (!album) {
		void res.badRequest("Album doesn't exist or doesn't belong to the user");
		return;
	}

	const links = await prisma.links.findMany({
		where: {
			albumId: album.id,
			userId: req.user.id
		},
		select: {
			uuid: true,
			identifier: true,
			views: true,
			enabled: true,
			enableDownload: true,
			allowUploads: true,
			hideFiles: true,
			serveWebsite: true,
			viewMode: true,
			expiresAt: true,
			createdAt: true,
			editedAt: true
		}
	});

	/*
		The owner is the only one who can fix a path conflict, so the warnings are
		returned with the links the settings dialog already fetches.
	*/
	let websiteWarnings: string[] = [];
	if (album.isWebsite) {
		const files = await prisma.files.findMany({
			where: {
				albums: { some: { id: album.id } },
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

		websiteWarnings = buildSiteIndex(files as SiteFileEntry[]).warnings;
	}

	return res.send({
		message: 'Successfully retrieved links',
		websiteWarnings,
		links: links.map(link => ({
			...link,
			albumUuid: uuid,
			/*
				A link can keep `serveWebsite` while the instance switch or the album
				flag is off; in that case there is no URL to show, and the link falls
				back to the gallery until both are on again.
			*/
			websiteUrl:
				link.serveWebsite && album.isWebsite && SETTINGS.websiteHostingEnabled
					? getWebsiteUrl(req, link.identifier)
					: null
		}))
	});
};
