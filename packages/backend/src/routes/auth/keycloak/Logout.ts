import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isKeycloakConfigured, isKeycloakMethod } from '@/structures/auth.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { createLogoutUrl, getFrontendUrl } from '@/utils/Keycloak.js';

export const schema = {
	summary: 'Keycloak logout',
	description: 'Clears the authentication cookie and ends the session at keycloak, so another account can be used',
	tags: ['Auth'],
	response: {
		200: z.any().describe('A redirect to the keycloak end-session endpoint.'),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/auth/keycloak/logout',
	method: 'get',
	options: {
		rateLimit: {
			max: 20,
			timeWindow: 1000 * 60
		}
	}
};

/*
	Reached by a browser navigation and deliberately unauthenticated: the login
	page offers this button precisely when the app has no session (the sign-in was
	refused), while the session that has to be ended lives at the provider.

	The local cookie is cleared first, so the button still logs the user out of
	this instance when single sign-on is not configured or the provider cannot be
	reached; the provider redirect is what allows the next sign-in to ask for
	credentials again.
*/
export const run = (_: FastifyRequest, res: FastifyReply) => {
	res.clearCookie('token', { path: '/' });

	if (!isKeycloakMethod || !isKeycloakConfigured) return res.redirect(getFrontendUrl('/login'));

	return res.redirect(createLogoutUrl());
};
