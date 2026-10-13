import { Buffer } from 'node:buffer';
import { URL, fileURLToPath } from 'node:url';

/*
	Shared log sanitisation helpers.

	Two data classes must never be written in clear text:

	 * credentials - they reach the logger through request headers, settings
	   payloads and third party error objects (Prisma, zod, AWS SDK, ...);
	 * absolute filesystem paths - they disclose the installation layout
	   (`<repo>/uploads/<file>`, `<repo>/logs/...`) and the dependency tree.

	`Logger.ts` applies them to every log record, and the admin diagnostic
	export (`LogSanitizer.ts`) applies them again before anything leaves the
	host.
*/

// `<repo>/` (or `/app/` inside the container) - the directory the backend lives in
export const APP_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export const REDACTED = '<redacted>';

const WINDOWS_ABSOLUTE_PATH = /[A-Za-z]:\\[^\s"'),;]*/g;
// A path needs at least two segments so that single slashes (and URLs, which are
// preceded by ':') are left alone
const POSIX_ABSOLUTE_PATH = /(?<=[^\w./:\\-]|^)(?:\/[\w+.@~-]+){2,}\/?/g;
// `file:///app/uploads/x.png` reaches the logger through ESM stack traces and
// through error messages that embed an import meta URL
const FILE_URL = /file:\/\/[^\s"'),;\]}]*/g;

/*
	Key names that hold a credential. Matching is done on a normalised key
	(lower case, separators removed): exactly (`apiKey`), by suffix (`jwtSecret`,
	`botToken`) and by substring (`S3SecretKey`).
*/
const SENSITIVE_KEYS = new Set(['authorization', 'proxyauthorization', 'cookie', 'setcookie', 'xapikey', 'apikey']);

const SENSITIVE_SUFFIXES = [
	'password',
	'passwd',
	'passphrase',
	'secret',
	'token',
	'apikey',
	'credential',
	'credentials',
	'privatekey'
];

const SENSITIVE_PARTS = ['secret', 'password', 'passwd'];

const isSensitiveKey = (key: string) => {
	const normalized = key.toLowerCase().replaceAll(/[\s_-]/g, '');

	return (
		SENSITIVE_KEYS.has(normalized) ||
		SENSITIVE_SUFFIXES.some(suffix => normalized.endsWith(suffix)) ||
		SENSITIVE_PARTS.some(part => normalized.includes(part))
	);
};

// Credential values that are pasted into free text (error messages, stack
// traces, request dumps) rather than stored under a known key
const CREDENTIAL_PAIR =
	/[\w-]*(?:authorization|cookie|password|passwd|passphrase|api[_-]?key|secret|token|credential)s?\w*["']?\s*[:=]\s*["']?(?:(?:bearer|basic|digest)\s+[^\s"'),;\]}]{6,}|[^\s"'),;\]}]+["']?)/gi;
const AUTHORIZATION_HEADER = /\b(?:bearer|basic|digest)\s+[^\s"'),;\]}]{6,}/gi;
const JWT = /\beyJ(?:[\w-]{8,}\.){2}[\w-]{4,}\b/g;

// `password: hunter2` keeps its key so the line still says what was dropped
const keepKeyName = (match: string) => {
	const separator = match.search(/[:=]/);

	return separator === -1 ? REDACTED : `${match.slice(0, separator)}: ${REDACTED}`;
};

const keepScheme = (match: string) => `${match.split(/\s+/)[0]} ${REDACTED}`;

export const redactSecrets = (text: string) =>
	text
		.replaceAll(CREDENTIAL_PAIR, keepKeyName)
		.replaceAll(AUTHORIZATION_HEADER, keepScheme)
		.replaceAll(JWT, REDACTED);

export const redactPaths = (text: string) =>
	text
		.replaceAll(APP_ROOT, '<app>')
		.replaceAll(FILE_URL, '<path>')
		.replaceAll(WINDOWS_ABSOLUTE_PATH, '<path>')
		.replaceAll(POSIX_ABSOLUTE_PATH, '<path>');

// A stack frame in a log line: `at fn (/app/x/y.js:1:1)` or `at /app/x/y.js:1:1`
const STACK_FRAME = /(?<=\(|\sat\s)(?:file:\/\/)?(?:[A-Za-z]:\\|\/)[^\s()]*[/\\][^\s()/\\]+:\d+:\d+/g;

const keepFileName = (frame: string) => {
	const separator = Math.max(frame.lastIndexOf('/'), frame.lastIndexOf('\\'));

	return separator === -1 ? frame : frame.slice(separator + 1);
};

// Keep the file/line of every stack frame, drop the directories in front of it
export const redactStack = (stack: string) => stack.replaceAll(STACK_FRAME, keepFileName);

const MAX_DEPTH = 6;

/*
	Deep walk of a value, replacing every credential with a placeholder.
	Used as pino's `formatters.log`, so it runs on every record and does not
	depend on the shape of the object being logged.
*/
export const scrubSensitiveValues = <T>(value: T, depth = 0): T => {
	if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

	// Errors are handled by the `err` serializer, which only keeps safe fields
	if (value instanceof Error || value instanceof Date || value instanceof RegExp || Buffer.isBuffer(value))
		return value;

	if (Array.isArray(value)) return value.map(entry => scrubSensitiveValues(entry, depth + 1)) as unknown as T;

	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		result[key] = isSensitiveKey(key) ? REDACTED : scrubSensitiveValues(entry, depth + 1);
	}

	return result as T;
};
