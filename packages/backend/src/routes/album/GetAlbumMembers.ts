import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';

export const schema = {
	summary: 'Get album members',
	description: 'Gets the members that have access to an album and the invites that are still pending',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.')
		})
		.required(),
	response: {
		200: z.object({
			message: responseMessageSchema,
			members: z.array(
				z.object({
					uuid: z.string().describe('The uuid of the user.'),
					username: z.string().describe('The email of the user.'),
					isOwner: z.boolean().describe('Whether the user owns the album.'),
					createdAt: z.date().describe('The date and time the user got access.')
				})
			),
			invites: z.array(
				z.object({
					code: z.string().describe('The invite code.'),
					email: z.string().nullable().describe('The email the invite was created for.'),
					createdAt: z.date().describe('The date and time the invite was created.')
				})
			)
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:uuid/members',
	method: 'get',
	middlewares: ['apiKey', 'auth']
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };

	// Members can not see who else has access, that is the owner's business.
	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		},
		select: {
			createdAt: true,
			members: {
				select: {
					createdAt: true,
					user: {
						select: {
							uuid: true,
							username: true
						}
					}
				},
				orderBy: {
					createdAt: 'asc'
				}
			},
			invites: {
				where: {
					used: false
				},
				select: {
					code: true,
					email: true,
					createdAt: true
				},
				orderBy: {
					createdAt: 'desc'
				}
			}
		}
	});

	if (!album) {
		void res.notFound("The album doesn't exist or doesn't belong to the user");
		return;
	}

	// The album query above is already scoped to the owner, so the requester is the owner
	return res.send({
		message: 'Successfully retrieved the album members',
		members: [
			{
				uuid: req.user.uuid,
				username: req.user.username,
				isOwner: true,
				createdAt: album.createdAt
			},
			...album.members
				.filter(member => member.user.uuid !== req.user.uuid)
				.map(member => ({
					uuid: member.user.uuid,
					username: member.user.username,
					isOwner: false,
					createdAt: member.createdAt
				}))
		],
		invites: album.invites
	});
};
