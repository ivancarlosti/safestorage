import bcrypt from 'bcryptjs';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { isKeycloakMethod, isValidEmail, normalizeEmail } from '@/structures/auth.js';
import prisma from '@/structures/database.js';
import type { RouteOptions } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { SETTINGS } from '@/structures/settings.js';
import { logError } from '@/utils/Logger.js';

export const schema = {
	summary: 'Register',
	description: 'Create a new user account',
	tags: ['Auth'],
	headers: z.object({
		invite: z.string().optional().describe('The invite code to use.')
	}),
	body: z.object({
		email: z.string().describe('The email of the user, which is also the login.'),
		username: z.string().optional().describe('Deprecated alias of `email`.'),
		password: z.string().describe('The password of the user.')
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
	url: '/auth/register',
	method: 'post',
	options: {
		rateLimit: {
			max: 10, // Ten rquests
			timeWindow: 1000 * 60 // Per minute
		}
	}
} as RouteOptions;

export const run = async (req: FastifyRequest, res: FastifyReply) => {
	if (isKeycloakMethod) {
		void res.forbidden(
			'The account registration is disabled on this instance, use the configured single sign-on provider'
		);
		return;
	}

	let foundInvite = null;

	const invite = req.headers.invite as string;

	// If new account creation is deactivated then check for an invite
	if (!SETTINGS.userAccounts && !invite) {
		void res.unauthorized('Creation of new accounts is currently disabled without an invite');
		return;
	}

	if (invite) {
		// Check if the invite is valid has not been used yet
		foundInvite = await prisma.invites.findFirst({
			where: {
				code: invite,
				used: false
			}
		});

		// If no invite was found then reject the call
		if (!foundInvite) {
			void res.unauthorized('Invalid invite code');
			return;
		}
	}

	const body = req.body as { email?: string; password?: string; username?: string };
	// `username` is kept as an alias for older clients; both are the user's email.
	const email = normalizeEmail(body.email ?? body.username ?? '');
	const { password } = body;

	if (!email || !password) {
		void res.badRequest('No username or password provided');
		return;
	}

	if (!isValidEmail(email)) {
		void res.badRequest('A valid email address is required');
		return;
	}

	if (password.length < 6 || password.length > 64) {
		void res.badRequest('Password must have 6-64 characters');
		return;
	}

	const exists = await prisma.users.findFirst({
		where: {
			username: email
		}
	});

	if (exists) {
		void res.badRequest('An account with that email already exists');
		return;
	}

	let hash;
	try {
		hash = await bcrypt.hash(password, 10);
	} catch (error) {
		logError(res.log, 'Could not hash the password', error);
		void res.internalServerError('There was a problem processing your account');
		return;
	}

	// Create the user in the database
	const userUuid = uuidv4();
	await prisma.users.create({
		data: {
			uuid: userUuid,
			username: email,
			password: hash,
			roles: {
				connect: {
					name: 'user'
				}
			}
		}
	});

	// Update the invite to mark it as used
	if (foundInvite) {
		await prisma.invites.update({
			where: {
				code: invite
			},
			data: {
				used: true,
				usedBy: userUuid,
				editedAt: new Date()
			}
		});
	}

	return res.send({ message: 'The account was created successfully' });
};
