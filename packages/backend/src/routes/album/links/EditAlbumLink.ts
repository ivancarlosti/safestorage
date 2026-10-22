import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
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

	const { enabled, enableDownload, expiresAt, allowUploads, hideFiles, viewMode } = req.body as {
		allowUploads?: boolean;
		enableDownload?: boolean;
		enabled?: boolean;
		expiresAt?: Date | null;
		hideFiles?: boolean;
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

	const updateObj = {
		enabled: enabled === true ? true : enabled === false ? false : link.enabled,
		enableDownload: enableDownload === true ? true : enableDownload === false ? false : link.enableDownload,
		allowUploads: allowUploads === true ? true : allowUploads === false ? false : link.allowUploads,
		hideFiles: hideFiles === true ? true : hideFiles === false ? false : link.hideFiles,
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
