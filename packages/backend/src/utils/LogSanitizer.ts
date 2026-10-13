import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import { redactPaths, redactSecrets } from './Sanitizer.js';

/*
	Sanitiser for the log tail that the admin diagnostic endpoint hands out.

	The on-disk log is meant for whoever runs the instance, but the diagnostic
	export leaves the host (it ends up in bug reports), so the absolute paths,
	the client addresses and any credential that slipped through are removed
	and only the tail of the file is exposed.
*/

const MAX_LINES = 500;
const MAX_BYTES = 512 * 1024;

// Client addresses are kept in the on-disk log - they are needed to investigate
// abuse - but they are of no use to whoever reads the export
const CLIENT_ADDRESS = /"(?:ip|hostname|remoteAddress|remoteIp|clientIp)"\s*:\s*"[^"]*"/g;
const LOGGED_USER = /Request from user:? [^\s"]+/g;

const keepAddressKey = (match: string) => `${match.slice(0, match.indexOf(':'))}:"<redacted>"`;

const sanitizeLine = (line: string) =>
	redactSecrets(redactPaths(line))
		.replaceAll(CLIENT_ADDRESS, keepAddressKey)
		.replaceAll(LOGGED_USER, 'Request from user <redacted>');

export const sanitizeLogs = (logs: string, maxLines = MAX_LINES) => {
	const lines = logs.split('\n');

	if (lines.length <= maxLines) return lines.map(sanitizeLine).join('\n');

	const tail = lines.slice(-maxLines);
	return [`[truncated to the last ${maxLines} of ${lines.length} lines]`, ...tail.map(sanitizeLine)].join('\n');
};

/*
	Read only the end of a log file: a rotated daily log can grow well past what
	the endpoint needs, and the whole file does not have to be buffered just to
	report its last few hundred lines.
*/
export const readLogTail = async (filePath: string, maxBytes = MAX_BYTES) => {
	const handle = await open(filePath, 'r');

	try {
		const { size } = await handle.stat();
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);

		await handle.read(buffer, 0, length, size - length);
		return buffer.toString('utf8');
	} finally {
		await handle.close();
	}
};
