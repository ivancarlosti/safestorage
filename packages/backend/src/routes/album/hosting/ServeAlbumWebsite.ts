import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SETTINGS } from '@/structures/settings.js';
import { handleWebsiteRequest } from '@/utils/AlbumWebsiteServer.js';

/*
	Path mode: `/site/{identifier}/…`.

	The route deliberately lives outside `/api` (`ignoreRoutePrefix`) so the URLs
	inside an uploaded website keep working: a relative `css/style.css` has to
	resolve to `/site/{identifier}/css/style.css`, not `/api/site/...`.

	Every file of a page is a separate request, so the rate limit is raised far
	above the regular API limit. The global switch, the album flag and the link
	flag are still checked on every request.
*/
export const schema = {
	summary: 'Serve album website',
	description: 'Serves an album that is published as a static website (path mode)',
	tags: ['Albums'],
	params: z
		.object({
			identifier: z.string().describe('The identifier of the link used to access the website.'),
			/*
				The wildcard is declared so the Zod validator (which strips unknown
				keys) keeps it on `req.params`: it is the rest of the site path.
			*/
			'*': z.string().optional().describe('The path of the file inside the website.')
		})
		.required()
};

export const options = {
	url: '/site/:identifier/*',
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
	const wildcard = (req.params as Record<string, string>)['*'] ?? '';

	return handleWebsiteRequest({
		identifier,
		mode: 'path',
		/*
			`*` is empty for `/site/{identifier}/`. The query string never reaches it:
			Fastify strips it before matching.
		*/
		requestPath: `/${wildcard}`,
		req,
		res
	});
};
