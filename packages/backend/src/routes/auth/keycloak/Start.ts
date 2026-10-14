import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isKeycloakConfigured, isKeycloakMethod } from '@/structures/auth.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { createAuthorizationUrl } from '@/utils/Keycloak.js';

export const schema = {
	summary: 'Keycloak login',
	description: 'Redirects the browser to the configured keycloak realm to start a single sign-on login',
	tags: ['Auth'],
	response: {
		200: z.any().describe('A redirect to the keycloak authorization endpoint.'),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/auth/keycloak/login',
	method: 'get',
	options: {
		rateLimit: {
			max: 20,
			timeWindow: 1000 * 60
		}
	}
};

export const run = (_: FastifyRequest, res: FastifyReply) => {
	if (!isKeycloakMethod || !isKeycloakConfigured) {
		void res.badRequest('The keycloak authentication method is not enabled on this instance');
		return;
	}

	return res.redirect(createAuthorizationUrl());
};
