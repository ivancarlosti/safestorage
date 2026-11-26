import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SETTINGS } from '@/structures/settings.js';

/*
	`/site/{identifier}` has no trailing slash, so it does not match the wildcard
	route. Redirecting to `/site/{identifier}/` keeps relative links inside the
	page pointing at the website instead of at the parent of the identifier.
*/
export const schema = {
	summary: 'Album website root',
	description: 'Redirects to the canonical trailing-slash form of a hosted album website',
	tags: ['Albums'],
	params: z
		.object({
			identifier: z.string().describe('The identifier of the link used to access the website.')
		})
		.required()
};

export const options = {
	url: '/site/:identifier',
	method: 'get',
	ignoreRoutePrefix: true,
	options: {
		rateLimit: {
			max: SETTINGS.rateLimitMax * 20,
			timeWindow: SETTINGS.rateLimitWindow
		}
	}
};

export const run = async (req: FastifyRequest, res: FastifyReply) => {
	const { identifier } = req.params as { identifier: string };
	const queryIndex = req.url.indexOf('?');
	const query = queryIndex === -1 ? '' : req.url.slice(queryIndex);

	res.header('Cache-Control', 'no-store');
	res.code(308).header('Location', `/site/${encodeURIComponent(identifier)}/${query}`);

	return res.send();
};
