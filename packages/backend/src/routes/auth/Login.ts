import bcrypt from 'bcryptjs';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { isAccountMethod, isKeycloakMethod, normalizeEmail, verifyAccountPassword } from '@/structures/auth.js';
import prisma from '@/structures/database.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { requestUserSchema } from '@/structures/schemas/RequestUser.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { AUTH_TOKEN_MAX_AGE, signAuthToken, verifyRecaptcha } from '@/utils/Auth.js';

export const schema = {
	summary: 'Login',
	description: 'Login to an existing account with the email and password of the user',
	tags: ['Auth'],
	headers: z.object({
		invite: z.string().optional().describe('The invite code to use.')
	}),
	body: z.object({
		email: z.string().optional().describe('The email of the user.'),
		username: z.string().optional().describe('Deprecated alias of `email`.'),
		password: z.string().describe('The password of the user.'),
		recaptchaToken: z
			.string()
			.optional()
			.describe('The reCAPTCHA response token, required when reCAPTCHA is configured.')
	}),
	response: {
		200: z.object({
			message: responseMessageSchema,
			user: requestUserSchema,
			token: z.string().describe('The JWT token.')
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/auth/login',
	method: 'post',
	options: {
		rateLimit: {
			max: 10, // Ten rquests
			timeWindow: 1000 * 60 // Per minute
		}
	}
};

export const run = async (req: FastifyRequest, res: FastifyReply) => {
	if (isKeycloakMethod) {
		void res.forbidden(
			'The password login is disabled on this instance, use the configured single sign-on provider'
		);
		return;
	}

	const body = req.body as { email?: string; password?: string; recaptchaToken?: string; username?: string };
	// `username` is kept as an alias for older clients; both are the user's email.
	const email = normalizeEmail(body.email ?? body.username ?? '');
	const { password } = body;

	if (!email || !password) {
		void res.unauthorized('No username or password provided');
		return;
	}

	if (!(await verifyRecaptcha(body.recaptchaToken))) {
		void res.badRequest('The reCAPTCHA validation failed');
		return;
	}

	const user = await prisma.users.findFirst({
		where: {
			username: email
		},
		include: {
			roles: {
				select: {
					name: true
				}
			}
		}
	});

	if (!user) {
		void res.unauthorized('Wrong Username or Password');
		return;
	}

	const comparePassword = await bcrypt.compare(password, user.password);

	/*
		The password stored in the database is the one the UI can rotate, but the
		value from `ACCOUNT_PASSWORD` keeps working as a recovery credential for
		the accounts the deployment declares in its environment.
	*/
	const environmentPassword =
		!comparePassword && isAccountMethod ? await verifyAccountPassword(email, password) : false;

	if (!comparePassword && !environmentPassword) {
		void res.unauthorized('Wrong Username or Password');
		return;
	}

	const jwt = signAuthToken(user.id);

	const response = {
		message: 'Successfully logged in.',
		user: {
			id: user.id,
			uuid: user.uuid,
			username: user.username,
			roles: user.roles,
			apiKey: user.apiKey,
			passwordEditedAt: user.passwordEditedAt
		},
		token: jwt,
		expiresAt: Date.now() + AUTH_TOKEN_MAX_AGE
	};

	// Support both JSON response and cookies
	return res
		.setCookie('token', jwt, {
			expires: new Date(Date.now() + AUTH_TOKEN_MAX_AGE),
			httpOnly: true,
			path: '/'
		})
		.send(response);
};
