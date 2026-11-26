import type { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SETTINGS } from '@/structures/settings.js';
import { parseSiteHost } from '@/utils/AlbumWebsite.js';
import { handleWebsiteRequest, type WebsiteResponse } from '@/utils/AlbumWebsiteServer.js';
import { logError } from '@/utils/Logger.js';

/*
	Only the hook registration is needed, and typing the parameter that way keeps
	the plugin usable with the logger-typed instance that main.ts builds.
*/
interface WebsiteHostingServer {
	addHook: (
		name: 'onRequest',
		hook: (request: FastifyRequest, reply: FastifyReply, done: () => void) => void
	) => unknown;
}

/*
	Domain mode: `{identifier}.{hostingDomain}` is served as the website itself.

	This is an `onRequest` hook instead of a wildcard route on purpose: a `/*` route
	would take over every path of the instance, colliding with the dev static
	server (uploads) and with the client routes, while the hook only answers when
	the Host header matches a site subdomain.

	A hijacked reply cannot be used with `reply.send()` (Fastify treats a hijacked
	reply as already sent), so this adapter writes the website response straight to
	the socket.
*/
const createRawWebsiteResponse = (res: FastifyReply): WebsiteResponse => {
	const headers: Record<string, string> = {};
	let status = 200;

	const writeHead = () => {
		if (!res.raw.headersSent) res.raw.writeHead(status, headers);
	};

	const responder: WebsiteResponse = {
		code(code) {
			status = code;
			return responder;
		},
		header(name, value) {
			headers[name.toLowerCase()] = value;
			return responder;
		},
		send(payload) {
			if (payload === undefined || payload === null) {
				writeHead();
				res.raw.end();
				return;
			}

			if (typeof (payload as Readable).pipe === 'function') {
				const stream = payload as Readable;
				stream.on('error', () => res.raw.destroy());
				writeHead();
				stream.pipe(res.raw);
				return;
			}

			if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
				headers['content-length'] ??= String(Buffer.byteLength(payload));
				writeHead();
				res.raw.end(payload);
				return;
			}

			const body = JSON.stringify(payload);
			headers['content-type'] ??= 'application/json; charset=utf-8';
			headers['content-length'] = String(Buffer.byteLength(body));
			writeHead();
			res.raw.end(body);
		}
	};

	return responder;
};

/*
	Answers one request of a site subdomain. Errors cannot go through Fastify any
	more (the reply is hijacked), so they are turned into a plain 500 here.
*/
const serveDomainWebsite = async (req: FastifyRequest, res: FastifyReply, identifier: string) => {
	try {
		await handleWebsiteRequest({
			identifier,
			mode: 'domain',
			requestPath: req.url,
			req,
			res: createRawWebsiteResponse(res)
		});
	} catch (error) {
		logError(req.log, `Failed to serve the website ${identifier}`, error);

		if (!res.raw.writableEnded) {
			res.raw.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
			res.raw.end('Something went wrong');
		}
	}
};

export const registerWebsiteHosting = (server: WebsiteHostingServer) => {
	server.addHook('onRequest', (req, res, done) => {
		if (!SETTINGS.websiteHostingEnabled || !SETTINGS.websiteHostingDomain) {
			done();
			return;
		}

		const identifier = parseSiteHost(req.headers.host, SETTINGS.websiteHostingDomain);
		if (!identifier) {
			done();
			return;
		}

		res.hijack();

		void serveDomainWebsite(req, res, identifier);
	});
};
