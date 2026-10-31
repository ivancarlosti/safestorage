import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';

export const schema = {
	summary: 'Revoke album invite',
	description: 'Deletes a pending invite of an album so the code can not be used anymore',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.'),
			code: z.string().describe('The code of the invite to revoke.')
		})
		.required(),
	response: {
		200: z.object({
			message: responseMessageSchema
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:uuid/invite/:code',
	method: 'delete',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid, code } = req.params as { code: string; uuid: string };

	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		},
		select: {
			id: true
		}
	});

	if (!album) {
		void res.notFound("The album doesn't exist or doesn't belong to the user");
		return;
	}

	const { count } = await prisma.invites.deleteMany({
		where: {
			albumId: album.id,
			code
		}
	});

	if (!count) {
		void res.notFound('The invite could not be found');
		return;
	}

	return res.send({
		message: 'Successfully revoked the invite'
	});
};
