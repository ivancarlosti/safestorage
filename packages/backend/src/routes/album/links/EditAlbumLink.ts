import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { SETTINGS } from '@/structures/settings.js';
import { isDnsSafeIdentifier } from '@/utils/AlbumWebsite.js';
import { isValidViewMode } from '@/utils/ViewMode.js';

export const schema = {
	summary: 'Edit link',
	description: 'Edits an album link',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.'),
			linkUuid: z.string().describe('The uuid of the link.')
		})
		.required(),
	body: z.object({
		enabled: z.boolean().optional().describe('Whether the link is enabled.'),
		enableDownload: z.boolean().optional().describe('Whether the link allows downloads.'),
		allowUploads: z.boolean().optional().describe('Whether visitors can upload files through the link.'),
		hideFiles: z
			.boolean()
			.optional()
			.describe('Whether the album contents are hidden and only the visitor uploads are shown.'),
		viewMode: z.enum(['list', 'thumbs']).nullable().optional().describe('The view mode of the link.'),
		serveWebsite: z
			.boolean()
			.optional()
			.describe('Whether the link serves the album as a static website instead of a gallery.'),
		expiresAt: z.coerce.date().nullable().optional().describe('The expiration date of the link.')
	}),
	response: {
		200: z.object({
			message: responseMessageSchema
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:uuid/link/:linkUuid/edit',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid, linkUuid } = req.params as { linkUuid: string; uuid: string };

	const { enabled, enableDownload, expiresAt, allowUploads, hideFiles, viewMode, serveWebsite } = req.body as {
		allowUploads?: boolean;
		enableDownload?: boolean;
		enabled?: boolean;
		expiresAt?: Date | null;
		hideFiles?: boolean;
		serveWebsite?: boolean;
		viewMode?: string | null;
	};

	if (viewMode !== undefined && viewMode !== null && !isValidViewMode(viewMode)) {
		void res.badRequest('Invalid view mode. Valid options: list, thumbs');
		return;
	}

	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		}
	});

	if (!album) {
		void res.badRequest("Album doesn't exist or doesn't belong to the user");
		return;
	}

	const link = await prisma.links.findFirst({
		where: {
			userId: req.user.id,
			albumId: album.id,
			uuid: linkUuid
		}
	});

	if (!link) {
		void res.notFound('No link found');
		return;
	}

	let nextServeWebsite = serveWebsite === true ? true : serveWebsite === false ? false : link.serveWebsite;
	const nextHideFiles = hideFiles === true ? true : hideFiles === false ? false : link.hideFiles;

	if (nextServeWebsite && nextHideFiles) {
		if (serveWebsite === true) {
			void res.badRequest('A website link cannot hide its files');
			return;
		}

		/*
			Turning the link into a drop-only link while it still carries the website
			flag (for example after hosting was disabled and the switch is hidden):
			the two modes are exclusive, so the explicit drop-only wins.
		*/
		nextServeWebsite = false;
	}

	/*
		The checks only run when the request turns website mode on. A link that
		still has the flag while hosting is disabled keeps it untouched, so the
		owner can keep editing it and the flag resumes working when hosting is
		enabled again.
	*/
	if (serveWebsite === true) {
		if (!SETTINGS.websiteHostingEnabled) {
			void res.badRequest('Static website hosting is disabled on this instance');
			return;
		}

		if (!album.isWebsite) {
			void res.badRequest('Enable website mode on the album before serving it as a website');
			return;
		}

		/*
			The identifier of an existing link cannot be changed, so a link created
			before the album became a website may still have an underscore or an
			uppercase letter in it and cannot become a site subdomain.
		*/
		if (!isDnsSafeIdentifier(link.identifier)) {
			void res.badRequest(
				'This link identifier cannot be used as a website address: it can only contain lowercase letters, digits and dashes'
			);
			return;
		}
	}

	const updateObj = {
		enabled: enabled === true ? true : enabled === false ? false : link.enabled,
		enableDownload: enableDownload === true ? true : enableDownload === false ? false : link.enableDownload,
		allowUploads: allowUploads === true ? true : allowUploads === false ? false : link.allowUploads,
		hideFiles: nextHideFiles,
		serveWebsite: nextServeWebsite,
		viewMode: viewMode === undefined ? link.viewMode : viewMode,
		expiresAt: expiresAt === undefined ? link.expiresAt : expiresAt
	};

	await prisma.links.update({
		where: {
			uuid: linkUuid
		},
		data: {
			...updateObj
		}
	});

	return res.send({
		message: 'Successfully edited link'
	});
};
