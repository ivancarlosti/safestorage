import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';

export const schema = {
	summary: 'Remove album member',
	description: 'Removes a member from an album. The files they uploaded stay in the album.',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.'),
			userUuid: z.string().describe('The uuid of the user to remove.')
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
	url: '/album/:uuid/member/:userUuid',
	method: 'delete',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid, userUuid } = req.params as { userUuid: string; uuid: string };

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

	const user = await prisma.users.findFirst({
		where: {
			uuid: userUuid
		},
		select: {
			id: true
		}
	});

	if (!user) {
		void res.notFound('The user could not be found');
		return;
	}

	const { count } = await prisma.albumMembers.deleteMany({
		where: {
			albumId: album.id,
			userId: user.id
		}
	});

	if (!count) {
		void res.notFound('That user is not a member of this album');
		return;
	}

	return res.send({
		message: 'Successfully removed the member from the album'
	});
};
