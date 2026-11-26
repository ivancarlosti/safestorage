import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { SETTINGS } from '@/structures/settings.js';
import { isValidSortOrder } from '@/utils/SortOrder.js';
import { getUniqueAlbumIdentifier } from '@/utils/Util.js';
import { isValidViewMode } from '@/utils/ViewMode.js';

export const schema = {
	summary: 'Update album',
	description: 'Updates an album',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.')
		})
		.required(),
	body: z.object({
		name: z.string().optional().describe('The name of the album.'),
		description: z.string().optional().describe('The description of the album.'),
		nsfw: z.boolean().optional().describe('Whether the album is nsfw or not.'),
		sortOrder: z.string().optional().nullable().describe('The sort order for files in this album.'),
		viewMode: z.enum(['list', 'thumbs']).optional().describe('The default view mode for this album.'),
		notifyOnPublicUpload: z
			.boolean()
			.optional()
			.describe('Whether to email the album owners when someone uploads through a public link.'),
		isWebsite: z
			.boolean()
			.optional()
			.describe(
				'Whether the album is served as a static website. Disabling it turns off website mode on its links.'
			)
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
	url: '/album/:uuid/edit',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };

	const { name, nsfw, description, sortOrder, viewMode, notifyOnPublicUpload, isWebsite } = req.body as {
		description?: string;
		isWebsite?: boolean;
		name?: string;
		nsfw?: boolean;
		notifyOnPublicUpload?: boolean;
		sortOrder?: string | null;
		viewMode?: string;
	};
	if (
		!name &&
		nsfw === undefined &&
		!description &&
		sortOrder === undefined &&
		viewMode === undefined &&
		notifyOnPublicUpload === undefined &&
		isWebsite === undefined
	) {
		void res.badRequest('No data supplied');
		return;
	}

	if (isWebsite === true && !SETTINGS.websiteHostingEnabled) {
		void res.badRequest('Static website hosting is disabled on this instance');
		return;
	}

	if (sortOrder !== undefined && sortOrder !== null && !isValidSortOrder(sortOrder)) {
		void res.badRequest(
			'Invalid sort order. Valid options: createdAt:asc, createdAt:desc, name:asc, name:desc, id:desc'
		);
		return;
	}

	if (viewMode !== undefined && !isValidViewMode(viewMode)) {
		void res.badRequest('Invalid view mode. Valid options: list, thumbs');
		return;
	}

	// Make sure the album exists and belongs to the user
	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		}
	});

	if (!album) {
		void res.notFound("The album doesn't exist or doesn't belong to the user");
		return;
	}

	/*
		Enabling website mode gives the album its own folder
		(`site/{identifier}/`). An album that already has one keeps it: renaming
		the folder would orphan every file stored inside it.
	*/
	const isNowWebsite = isWebsite ?? album.isWebsite;
	let identifier = album.identifier;
	if (isNowWebsite && !identifier) {
		identifier = await getUniqueAlbumIdentifier();
		if (!identifier) {
			void res.internalServerError('Could not generate an identifier for the album');
			return;
		}
	}

	const updateObj = {
		name: name ?? album.name,
		nsfw: nsfw === true ? true : nsfw === false ? false : album.nsfw,
		description: description ?? album.description,
		sortOrder: sortOrder === undefined ? album.sortOrder : sortOrder,
		viewMode: viewMode ?? album.viewMode,
		notifyOnPublicUpload: notifyOnPublicUpload ?? album.notifyOnPublicUpload,
		isWebsite: isWebsite ?? album.isWebsite,
		identifier
	};

	/*
		Turning website mode off has to turn it off on every link of the album as
		well: a link left with `serveWebsite` would otherwise keep trying to serve an
		album that is no longer a website, and re-enabling the album later would
		silently republish every one of those links.
	*/
	await prisma.$transaction(async transaction => {
		await transaction.albums.update({
			where: {
				uuid
			},
			data: {
				...updateObj
			}
		});

		if (updateObj.isWebsite === false && album.isWebsite) {
			await transaction.links.updateMany({
				where: {
					albumId: album.id
				},
				data: {
					serveWebsite: false
				}
			});
		}
	});

	return res.send({
		message: 'Successfully edited the album'
	});
};
