import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
	KEYCLOAK_REDIRECT_URI,
	isKeycloakConfigured,
	isKeycloakEmailAllowed,
	isKeycloakMethod
} from '@/structures/auth.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { AUTH_TOKEN_MAX_AGE, signAuthToken } from '@/utils/Auth.js';
import {
	consumePendingAuthorization,
	exchangeCode,
	findOrCreateKeycloakUser,
	verifyIdToken
} from '@/utils/Keycloak.js';
import { logError } from '@/utils/Logger.js';

export const schema = {
	summary: 'Keycloak callback',
	description: 'Handles the redirect back from keycloak, provisions the user when needed and signs them in',
	tags: ['Auth'],
	querystring: z.object({
		code: z.string().optional().describe('The authorization code, returned by keycloak on success.'),
		error: z.string().optional().describe('The error code, returned by keycloak on failure.'),
		error_description: z.string().optional().describe('The human readable reason of the error.'),
		state: z.string().optional().describe('The state that was sent to keycloak when the login started.')
	}),
	response: {
		200: z.any().describe('A redirect back to the frontend, with the authentication cookie set.'),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/auth/keycloak/callback',
	method: 'get',
	options: {
		rateLimit: {
			max: 20,
			timeWindow: 1000 * 60
		}
	}
};

/*
	The callback is reached by a browser navigation, so a JSON body would be the
	page the user sees. Every outcome is therefore a redirect: failures land on the
	login page with a `?error=` code the frontend translates.

	The target origin is derived from the redirect URI (which the browser is
	already known to reach) instead of being a second variable to keep in sync.
*/
const frontendUrl = (path: string) => {
	try {
		return new URL(path, KEYCLOAK_REDIRECT_URI).toString();
	} catch {
		return path;
	}
};

const fail = (res: FastifyReply, reason: string) =>
	res.redirect(frontendUrl(`/login?error=${encodeURIComponent(reason)}`));

export const run = async (req: FastifyRequest, res: FastifyReply) => {
	if (!isKeycloakMethod || !isKeycloakConfigured) {
		void res.badRequest('The keycloak authentication method is not enabled on this instance');
		return;
	}

	const query = req.query as { code?: string; error?: string; state?: string };

	if (query.error) {
		req.log.warn(`The keycloak login was refused by the identity provider (${query.error})`);
		return fail(res, query.error);
	}

	if (!query.code || !query.state) return fail(res, 'invalid_request');

	// Single use, so a replayed state (or an injected one) can never pass.
	const pending = consumePendingAuthorization(query.state);
	if (!pending) return fail(res, 'invalid_state');

	try {
		const tokens = await exchangeCode(query.code, pending.codeVerifier);
		if (!tokens.id_token) return fail(res, 'invalid_token');

		const identity = await verifyIdToken(tokens.id_token, pending.nonce);

		if (!identity.emailVerified) return fail(res, 'email_not_verified');

		if (!isKeycloakEmailAllowed(identity.email)) {
			// The email itself is PII and is deliberately left out of the log.
			req.log.warn('The keycloak login was refused because the email is not on the allow list');
			return fail(res, 'not_allowed');
		}

		const user = await findOrCreateKeycloakUser(identity.email);
		if (!user.enabled) return fail(res, 'user_disabled');

		const token = signAuthToken(user.id);

		return res
			.setCookie('token', token, {
				expires: new Date(Date.now() + AUTH_TOKEN_MAX_AGE),
				httpOnly: true,
				path: '/',
				sameSite: 'lax'
			})
			.redirect(frontendUrl('/dashboard'));
	} catch (error) {
		logError(req.log, 'The keycloak login failed', error);
		return fail(res, 'server_error');
	}
};
