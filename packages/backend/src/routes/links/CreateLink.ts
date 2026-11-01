import slugify from '@sindresorhus/slugify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RequestWithUser } from '@/structures/interfaces.js';
import { http4xxErrorSchema } from '@/structures/schemas/HTTP4xxError.js';
import { http5xxErrorSchema } from '@/structures/schemas/HTTP5xxError.js';
import { responseMessageSchema } from '@/structures/schemas/ResponseMessage.js';
import { shortenUrl } from '@/utils/Shortener.js';

export const schema = {
	summary: 'Create link',
	description: 'Create a new shortened link on the YOURLS instance configured in the settings',
	tags: ['Links'],
	body: z.object({
		url: z.string().describe('The destination url.'),
		vanity: z.string().optional().describe('The vanity url to use.')
	}),
	response: {
		200: z.object({
			message: responseMessageSchema,
			link: z.object({
				destination: z.string().describe('The destination of the link.'),
				identifier: z.string().describe('The keyword of the link on the YOURLS instance.'),
				link: z.string().describe('The shortened link.')
			})
		}),
		'4xx': http4xxErrorSchema,
		'5xx': http5xxErrorSchema
	}
};

export const options = {
	url: '/link/create',
	method: 'post',
	middlewares: [
		{
			name: 'apiKey'
		},
		{
			name: 'auth'
		}
	]
};

export const run = async (req: RequestWithUser, res: FastifyReply) => {
	const { url, vanity } = req.body as { url: string; vanity?: string | undefined };

	// YOURLS only takes alphanumeric keywords, so the vanity is normalized the
	// same way the built-in shortener used to do it. When nothing usable is left
	// the parameter is dropped and YOURLS generates the keyword itself.
	const keyword = vanity ? slugify(vanity, { separator: '_', decamelize: false, lowercase: false }) : undefined;

	const result = await shortenUrl({ destination: url, keyword: keyword || undefined });

	if (!result.ok) {
		switch (result.status) {
			case 400: {
				void res.badRequest(result.message);
				break;
			}

			case 409: {
				void res.conflict(result.message);
				break;
			}

			case 501: {
				void res.notImplemented(result.message);
				break;
			}

			case 504: {
				void res.gatewayTimeout(result.message);
				break;
			}

			default: {
				void res.badGateway(result.message);
			}
		}

		return;
	}

	return res.send({
		message: 'Successfully created link',
		link: {
			destination: result.destination,
			identifier: result.identifier,
			link: result.link
		}
	});
};
