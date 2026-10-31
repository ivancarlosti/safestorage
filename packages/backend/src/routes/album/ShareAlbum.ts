import bcrypt from 'bcryptjs';
import type { FastifyReply } from 'fastify';
import randomstring from 'randomstring';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
	getKeycloakRestriction,
	isKeycloakEmailAllowed,
	isKeycloakMethod,
	isValidEmail,
	normalizeEmail
} from '@/structures/auth.js';
import prisma from '@/structures/database.js';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { logError } from '@/utils/Logger.js';
import { buildInstanceLink, sendAlbumShareMail } from '@/utils/Mailer.js';

export const schema = {
	summary: 'Share album',
	description:
		'Gives another user access to an album. Existing accounts are added as members, unknown emails get an invite (account auth) or a just in time provisioned account (keycloak auth).',
	tags: ['Albums'],
	params: z
		.object({
			uuid: z.string().describe('The uuid of the album.')
		})
		.required(),
	body: z.object({
		email: z.string().describe('The email of the person the album is shared with.')
	}),
	response: {
		200: z.object({
			message: responseMessageSchema,
			type: z
				.enum(['invite', 'member'])
				.describe('Whether an account was shared with directly or an invite was created.'),
			emailSent: z.boolean().describe('Whether the notification email was accepted by the SMTP server.'),
			code: z.string().optional().describe('The invite code, when an invite was created.'),
			inviteUrl: z
				.string()
				.optional()
				.describe('The invite path, relative to the instance root, when an invite was created.')
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/album/:uuid/share',
	method: 'post',
	middlewares: ['apiKey', 'auth'],
	options: {
		rateLimit: {
			max: 30,
			timeWindow: 1000 * 60
		}
	}
};

const invitePath = (code: string) => `/invite/${code}`;

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { uuid } = req.params as { uuid: string };
	const { email: rawEmail } = req.body as z.infer<typeof schema.body>;
	const email = normalizeEmail(rawEmail ?? '');

	if (!email || !isValidEmail(email)) {
		void res.badRequest('A valid email address is required');
		return;
	}

	// Only the owner hands out access: members can not reshare the album.
	const album = await prisma.albums.findFirst({
		where: {
			uuid,
			userId: req.user.id
		},
		select: {
			id: true,
			name: true,
			uuid: true
		}
	});

	if (!album) {
		void res.notFound("The album doesn't exist or doesn't belong to the user");
		return;
	}

	if (email === req.user.username) {
		void res.badRequest('You already have access to this album');
		return;
	}

	/*
		Links inside the emails need an absolute URL. The instance URL setting wins,
		the origin of this request is the fallback, and the invite code is always
		returned so the link can be copied even when neither is available.
	*/
	const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';

	const existingUser = await prisma.users.findFirst({
		where: {
			username: email
		},
		select: {
			id: true,
			uuid: true,
			username: true
		}
	});

	try {
		if (existingUser) {
			await prisma.albumMembers.upsert({
				where: {
					albumId_userId: {
						albumId: album.id,
						userId: existingUser.id
					}
				},
				create: {
					albumId: album.id,
					userId: existingUser.id
				},
				update: {}
			});

			const mail = await sendAlbumShareMail({
				to: email,
				inviter: req.user.username,
				albumName: album.name,
				kind: 'member',
				albumUrl: buildInstanceLink(`/dashboard/albums/${album.uuid}`, origin)
			});

			return res.send({
				message: 'The album was shared',
				type: 'member' as const,
				emailSent: mail.sent
			});
		}
	} catch (error) {
		logError(req.log, 'Could not share the album', error);
		void res.internalServerError('There was a problem sharing the album');
		return;
	}

	/*
		Registration is disabled under keycloak, so an invite would be dead on
		arrival. The account is provisioned here instead: the email is the
		identity, so the row is picked up by the next single sign-on login.
	*/
	if (isKeycloakMethod) {
		if (!isKeycloakEmailAllowed(email)) {
			const allowed = getKeycloakRestriction().join(', ');
			void res.badRequest(
				allowed
					? `This instance only accepts accounts from: ${allowed}`
					: 'This instance does not accept new accounts right now'
			);
			return;
		}

		try {
			const password = await bcrypt.hash(randomstring.generate(48), 10);
			const user = await prisma.users.create({
				data: {
					uuid: uuidv4(),
					username: email,
					password,
					roles: {
						connect: {
							name: 'user'
						}
					}
				},
				select: {
					id: true
				}
			});

			await prisma.albumMembers.create({
				data: {
					albumId: album.id,
					userId: user.id
				}
			});

			const mail = await sendAlbumShareMail({
				to: email,
				inviter: req.user.username,
				albumName: album.name,
				kind: 'onboard',
				albumUrl: buildInstanceLink('/login', origin)
			});

			return res.send({
				message: 'The album was shared',
				type: 'member' as const,
				emailSent: mail.sent
			});
		} catch (error) {
			logError(req.log, 'Could not provision the account of the invited user', error);
			void res.internalServerError('There was a problem sharing the album');
			return;
		}
	}

	// Account auth: an invite is the only way to create the account.
	try {
		const existingInvite = await prisma.invites.findFirst({
			where: {
				albumId: album.id,
				email,
				used: false
			},
			select: {
				code: true
			}
		});

		const code = existingInvite?.code ?? uuidv4();
		if (!existingInvite) {
			await prisma.invites.create({
				data: {
					code,
					createdBy: req.user.uuid,
					email,
					albumId: album.id
				}
			});
		}

		const mail = await sendAlbumShareMail({
			to: email,
			inviter: req.user.username,
			albumName: album.name,
			kind: 'invite',
			inviteCode: code,
			inviteUrl: buildInstanceLink(invitePath(code), origin)
		});

		return res.send({
			message: 'An invite was created',
			type: 'invite' as const,
			emailSent: mail.sent,
			code,
			inviteUrl: invitePath(code)
		});
	} catch (error) {
		logError(req.log, 'Could not create the album invite', error);
		void res.internalServerError('There was a problem sharing the album');
	}
};
