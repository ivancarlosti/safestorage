import path from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import * as FileStreamRotator from 'file-stream-rotator';
import pino from 'pino';
import pretty from 'pino-pretty';
import { redactPaths, redactSecrets, redactStack, scrubSensitiveValues } from './Sanitizer.js';

/*
	Credentials are stripped from every record, in every environment.

	`formatters.log` walks the whole record (nested request/settings objects
	included) and replaces any value stored under a credential-looking key,
	while `redact` is a second, path based net for the header names Fastify
	hands to the logger directly.
*/
const scrubLogRecord = (record: Record<string, unknown>): Record<string, unknown> => scrubSensitiveValues(record);

const redact = {
	paths: [
		'hostname',
		'headers.authorization',
		'headers.cookie',
		'headers["x-api-key"]',
		'req.headers.authorization',
		'req.headers.cookie',
		'req.headers["x-api-key"]',
		'request.headers.authorization',
		'request.headers.cookie',
		'request.headers["x-api-key"]',
		'reply.headers["set-cookie"]',
		'res.headers["set-cookie"]'
	],
	remove: true
};

/*
	pino copies every own enumerable property of an error, and Prisma (`meta`)
	as well as zod (`issues`, `received`) errors embed the offending values
	(request bodies, the settings payload holding the JWT/S3 secrets, ...).
	Only the fields that are safe to keep are serialised here, and stack traces
	lose the absolute paths they are built from.
*/
const errorSerializer = (error: unknown) => {
	// A thrown non Error (a plain object from an SDK, a zod issue list, ...) can
	// hold anything, so only its shape survives
	if (!(error instanceof Error)) {
		if (typeof error === 'string') return { type: 'string', message: redactPaths(redactSecrets(error)) };

		return { type: typeof error };
	}

	const serialized: Record<string, unknown> = {
		type: error.name,
		message: redactPaths(redactSecrets(error.message))
	};

	const code = (error as NodeJS.ErrnoException).code;
	if (code) serialized.code = code;

	if (error.stack) {
		// `redactStack` first (it needs the directories to recognise a frame),
		// then the credential and path nets
		serialized.stack =
			process.env.NODE_ENV === 'production'
				? redactPaths(redactSecrets(redactStack(error.stack)))
				: redactSecrets(error.stack);
	}

	return serialized;
};

const logger = {
	development: {
		transport: {
			target: 'pino-pretty',
			options: {
				translateTime: 'HH:MM:ss Z',
				ignore: 'pid,hostname',
				singleLine: true
			}
		},
		level: 'debug',
		sync: true,
		redact,
		serializers: { err: errorSerializer },
		formatters: { log: scrubLogRecord }
	},
	production: {
		redact,
		serializers: { err: errorSerializer },
		formatters: { log: scrubLogRecord }
	}
};

const loggerDestination = pino.multistream([
	{
		stream: pretty({
			hideObject: true,
			messageFormat: (log, messageKey) => {
				const message = log[messageKey] as string;

				if (log.method) {
					// eslint-disable-next-line @typescript-eslint/no-base-to-string
					return `${log.method} ${log.url} ${log.statusCode} ${log.responseTime}ms ${log.ip} ${
						message || ''
					}`;
				}

				return message;
			}
		})
	},
	{
		stream: FileStreamRotator.getStream({
			filename: path.join(fileURLToPath(new URL('../../../../logs', import.meta.url)), 'safestorage-%DATE%'),
			extension: '.log',
			date_format: 'YYYY-MM-DD',
			frequency: 'daily',
			audit_file: fileURLToPath(new URL('../../../../logs/safestorage-audit.json', import.meta.url))
		})
	}
]);

export const log =
	process.env.NODE_ENV === 'production'
		? pino.default(logger.production, loggerDestination)
		: pino.default(logger.development);

/*
	Log a caught error along with a stable, human readable context.

	Only `Error` instances are forwarded - they go through the `err` serializer,
	which keeps the type/message/stack and nothing else. Anything else that gets
	thrown (a string, a zod `issues` array, a raw SDK response object, ...) could
	hold credentials and is dropped in favour of the context message.
*/
// `req.log`/`server.log` are `FastifyBaseLogger`s, which are only structurally
// close to pino's `Logger`: the overloaded `error` is all that is needed here
type ErrorLogger = {
	error(obj: unknown, msg?: string, ...args: unknown[]): void;
};

export const logError = (loggerInstance: ErrorLogger, context: string, error: unknown) => {
	if (error instanceof Error) {
		loggerInstance.error({ err: error }, context);
		return;
	}

	if (['string', 'number', 'boolean'].includes(typeof error)) {
		loggerInstance.error(`${context}: ${redactPaths(redactSecrets(String(error)))}`);
		return;
	}

	loggerInstance.error(context);
};
