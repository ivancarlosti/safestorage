import type { FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { SETTINGS } from '@/structures/settings.js';

export const schema = {
	summary: 'Create album',
	description: 'Creates a new album',
	tags: ['Albums'],
	body: z
		.object({
			name: z.string().describe('The name of the album.'),
			isWebsite: z
				.boolean()
				.optional()
				.describe('Whether the album is served as a static website (requires website hosting to be enabled).')
		})
		.required(),
	response: {
		200: z.object({
			message: responseMessageSchema,
			album: z.object({
				uuid: z.string().describe('The uuid of the album.'),
				name: z.string().describe('The name of the album.'),
				isWebsite: z.boolean().describe('Whether the album is served as a static website.'),
				createdAt: z.date().describe('The date the album was created.')
			})
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/create',
	method: 'post',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { name, isWebsite } = req.body as { isWebsite?: boolean; name: string };

	if (isWebsite === true && !SETTINGS.websiteHostingEnabled) {
		void res.badRequest('Static website hosting is disabled on this instance');
		return;
	}

	const exists = await prisma.albums.findFirst({
		where: {
			name,
			userId: req.user.id
		}
	});

	if (exists) {
		void res.badRequest("There's already an album with that name");
		return;
	}

	const now = new Date();

	const newAlbum = await prisma.albums.create({
		data: {
			name,
			userId: req.user.id,
			uuid: uuidv4(),
			isWebsite: isWebsite === true,
			createdAt: now,
			editedAt: now
		}
	});

	return res.send({
		message: 'Successfully created album',
		album: {
			uuid: newAlbum.uuid,
			name: newAlbum.name,
			isWebsite: newAlbum.isWebsite,
			createdAt: newAlbum.createdAt
		}
	});
};
