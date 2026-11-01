import { z } from 'zod';
import { SETTINGS } from '@/structures/settings.js';
import { log } from '@/utils/Logger.js';

/*
	Short URLs are delegated to a YOURLS instance (https://yourls.org). The API
	accepts either a username/password pair or the `signature` token shown under
	Tools → Secure passwordless API call; only the token is stored, so no user
	credentials have to sit in the database.

	Requests are form encoded and answered with the array returned by
	`yourls_add_new_link()` (includes/functions-shorturls.php):

	{ status: 'success', code: '', message, errorCode: '', statusCode: '200',
	  url: { keyword, url, title, date, ip }, title, shorturl }
	{ status: 'fail', code: 'error:url', message, errorCode: '409', statusCode: '409',
	  url: { keyword, ... }, title, shorturl }
	{ status: 'fail', code: 'error:keyword', message, errorCode: '400', statusCode: '400' }

	Two details shape the parsing below:

	- The keyword is never a top level field, it only lives in `url.keyword`
	  (`shorturl` is the only top level link field), so requiring `keyword` next
	  to `shorturl` rejected every successful answer.
	- `yourls_api_output()` mirrors `statusCode` (falling back to `errorCode`)
	  into the HTTP status, so a refusal arrives as a 4xx/5xx answer that still
	  carries a usable JSON body. Only that body tells "destination already
	  shortened" (`error:url`) from "custom keyword taken" (`error:keyword`), and
	  older releases answer both with a plain 200, so the body is parsed first
	  and the HTTP status is only used to describe non YOURLS answers.
*/
const YOURLS_TIMEOUT = 10_000;

const codeSchema = z.union([z.number(), z.string()]).nullish();
const urlSchema = z
	.object({
		keyword: z.string().nullish(),
		url: z.string().nullish(),
		title: z.string().nullish()
	})
	.nullish();

const successSchema = z.object({
	status: z.literal('success'),
	code: codeSchema,
	errorCode: codeSchema,
	message: z.string().nullish(),
	statusCode: codeSchema,
	shorturl: z.string().min(1),
	// Not sent by core YOURLS; kept so forks and plugins that add it still work
	keyword: z.string().nullish(),
	title: z.string().nullish(),
	url: urlSchema
});

const failureSchema = z.object({
	status: z.literal('fail'),
	code: codeSchema,
	errorCode: codeSchema,
	message: z.string().nullish(),
	statusCode: codeSchema,
	// `error:url` carries the short URL that already points at the destination
	shorturl: z.string().nullish(),
	url: urlSchema
});

const responseSchema = z.union([successSchema, failureSchema]);

export type ShortenResult =
	| { destination: string; identifier: string; link: string; ok: true }
	| { message: string; ok: false; status: number };

export const isShortenerConfigured = () => Boolean(SETTINGS.yourlsApiUrl && SETTINGS.yourlsSignature);

const isHttpUrl = (value: string) => {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
};

const firstValue = (...values: (string | null | undefined)[]): string | undefined => {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}

	return undefined;
};

/*
	YOURLS refuses the link with `error:keyword` without echoing the keyword, so
	the value the caller sent is the only way to name it in the message.
*/
const keywordTakenMessage = (keyword?: string) => {
	const suffix = 'on the YOURLS instance. Pick another one or leave the field empty to get a random one.';

	return keyword
		? `The custom URL "${keyword}" is already taken ${suffix}`
		: `The custom URL is already taken ${suffix}`;
};

const destinationTakenMessage = (existingLink?: string) =>
	existingLink
		? `This URL has already been shortened on the YOURLS instance: ${existingLink}`
		: 'This URL has already been shortened on the YOURLS instance';

/*
	Deliberately returns a result instead of throwing: every failure has a
	meaningful HTTP status for the API (`501` when the instance is not set up,
	`400` for a bad destination, `409` for a destination or keyword that is
	already in YOURLS, `502`/`504` when YOURLS itself refuses or is unreachable),
	and the message is the most useful thing to show to the user.
*/
export const shortenUrl = async ({
	destination,
	keyword
}: {
	destination: string;
	keyword?: string | undefined;
}): Promise<ShortenResult> => {
	if (!SETTINGS.useUrlShortener) {
		return { ok: false, status: 501, message: 'URL shortener is disabled' };
	}

	if (!isShortenerConfigured()) {
		return { ok: false, status: 501, message: 'URL shortener is not configured' };
	}

	const trimmedDestination = destination.trim();
	if (!isHttpUrl(trimmedDestination)) {
		return { ok: false, status: 400, message: 'The destination has to be a full http(s) URL' };
	}

	const body = new URLSearchParams({
		action: 'shorturl',
		format: 'json',
		signature: SETTINGS.yourlsSignature,
		url: trimmedDestination
	});

	if (keyword) body.set('keyword', keyword);

	let response: Response;
	try {
		response = await fetch(SETTINGS.yourlsApiUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
			signal: AbortSignal.timeout(YOURLS_TIMEOUT)
		});
	} catch (error) {
		const name = error instanceof Error ? error.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') {
			log.error('The YOURLS instance did not answer in time');
			return { ok: false, status: 504, message: 'The YOURLS instance did not answer in time' };
		}

		log.error(`Could not reach the YOURLS instance: ${(error as Error).message}`);
		return { ok: false, status: 502, message: 'Could not reach the YOURLS instance' };
	}

	/*
		YOURLS answers failures with the HTTP status taken from the JSON body
		(`yourls_api_output()`), so the body is read before looking at
		`response.ok`: it is the only place carrying `code`, the existing
		`shorturl` and the message that explains the refusal.
	*/
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		if (!response.ok) {
			log.error(`The YOURLS instance answered with HTTP ${response.status}`);
			return {
				ok: false,
				status: 502,
				message: `The YOURLS instance answered with HTTP ${response.status}`
			};
		}

		log.error('The YOURLS instance did not answer with JSON, check the API URL');
		return {
			ok: false,
			status: 502,
			message: 'The YOURLS instance did not answer with JSON, check the API URL'
		};
	}

	const parsed = responseSchema.safeParse(payload);
	if (!parsed.success) {
		log.error(`Unexpected answer from the YOURLS instance (HTTP ${response.status}): ${JSON.stringify(payload)}`);
		return { ok: false, status: 502, message: 'Unexpected answer from the YOURLS instance' };
	}

	const result = parsed.data;
	if (result.status === 'fail') {
		const failureCode = typeof result.code === 'string' ? result.code.trim() : '';
		const upstreamMessage = firstValue(result.message) ?? 'The YOURLS instance refused the link';
		log.error(`The YOURLS instance refused the link${failureCode ? ` (${failureCode})` : ''}: ${upstreamMessage}`);

		switch (failureCode) {
			// The destination is already stored and duplicates are disabled (the
			// YOURLS default). Newer releases answer 409 and 1.10 or older 400, and
			// the body carries the short URL that already redirects there.
			case 'error:url': {
				return {
					ok: false,
					status: 409,
					message: destinationTakenMessage(firstValue(result.shorturl))
				};
			}

			// The requested keyword is taken or reserved. YOURLS answers 400, but
			// for the caller it is a conflict with an existing short URL, and
			// nothing was created.
			case 'error:keyword': {
				return {
					ok: false,
					status: 409,
					message: keywordTakenMessage(firstValue(keyword, result.url?.keyword))
				};
			}

			// Malformed destination, or the destination is itself a short URL of
			// this instance: retrying changes nothing, the request is invalid.
			case 'error:nourl':
			case 'error:noloop': {
				return { ok: false, status: 400, message: upstreamMessage };
			}

			// `error:db`, `error:concurrency` and anything a plugin adds: the
			// instance could not create the link, so there is nothing to retry and
			// YOURLS' own wording is the most useful explanation.
			default: {
				return { ok: false, status: 502, message: upstreamMessage };
			}
		}
	}

	const link = result.shorturl.trim();
	const identifier =
		firstValue(result.url?.keyword, result.keyword) ?? link.split('/').findLast(segment => segment !== '') ?? '';

	return {
		ok: true,
		destination: trimmedDestination,
		identifier,
		link
	};
};
