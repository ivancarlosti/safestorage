import { z } from 'zod';
import { SETTINGS } from '@/structures/settings.js';
import { log } from '@/utils/Logger.js';

/*
	Short URLs are delegated to a YOURLS instance (https://yourls.org). The API
	accepts either a username/password pair or the `signature` token shown under
	Tools → Secure passwordless API call; only the token is stored, so no user
	credentials have to sit in the database.

	Requests are form encoded and answered as JSON:
	{ status: 'success', code: 200, shorturl, url, keyword, title, message }
	{ status: 'fail', code: 'error:keyword', message, errorCode }
*/
const YOURLS_TIMEOUT = 10_000;

const successSchema = z.object({
	status: z.literal('success'),
	code: z.union([z.number(), z.string()]).optional(),
	message: z.string().optional(),
	shorturl: z.string(),
	keyword: z.string(),
	title: z.string().optional()
});

const failureSchema = z.object({
	status: z.literal('fail'),
	code: z.union([z.number(), z.string()]).optional(),
	message: z.string().optional(),
	errorCode: z.string().optional()
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

/*
	Deliberately returns a result instead of throwing: every failure has a
	meaningful HTTP status for the API (`501` when the instance is not set up,
	`400` for a bad destination, `409` for a taken keyword, `502`/`504` when
	YOURLS itself is unreachable), and the message YOURLS sends is the most
	useful thing to show to the user.
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

	if (!response.ok) {
		log.error(`The YOURLS instance answered with HTTP ${response.status}`);
		return {
			ok: false,
			status: 502,
			message: `The YOURLS instance answered with HTTP ${response.status}`
		};
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		log.error('The YOURLS instance did not answer with JSON, check the API URL');
		return {
			ok: false,
			status: 502,
			message: 'The YOURLS instance did not answer with JSON, check the API URL'
		};
	}

	const parsed = responseSchema.safeParse(payload);
	if (!parsed.success) {
		log.error(`Unexpected answer from the YOURLS instance: ${JSON.stringify(payload)}`);
		return { ok: false, status: 502, message: 'Unexpected answer from the YOURLS instance' };
	}

	const result = parsed.data;
	if (result.status === 'fail') {
		const message = result.message || 'The YOURLS instance refused the link';
		log.error(`The YOURLS instance refused the link: ${message}`);

		// The only failure a user can fix from the form: the keyword is taken.
		return { ok: false, status: result.code === 'error:keyword' ? 409 : 502, message };
	}

	return {
		ok: true,
		destination: trimmedDestination,
		identifier: result.keyword,
		link: result.shorturl
	};
};
