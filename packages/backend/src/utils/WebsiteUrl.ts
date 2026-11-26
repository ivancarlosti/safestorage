import type { FastifyRequest } from 'fastify';
import { SETTINGS } from '@/structures/settings.js';
import { normalizeHostingDomain } from '@/utils/AlbumWebsite.js';

/*
	Public URL of a hosted website, built from the instance settings: a subdomain
	when a hosting domain is configured, `/site/{identifier}` otherwise.
*/
export const getWebsiteUrl = (req: FastifyRequest, identifier: string) => {
	const domain = normalizeHostingDomain(SETTINGS.websiteHostingDomain);
	if (domain) return `${req.protocol}://${identifier}.${domain}`;

	return `${req.protocol}://${req.headers.host}/site/${identifier}`;
};
