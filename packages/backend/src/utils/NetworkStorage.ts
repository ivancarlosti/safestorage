import path from 'node:path';
import { URL } from 'node:url';
import { SETTINGS } from '@/structures/settings.js';
import { isValidSiteStorageKey } from '@/utils/AlbumWebsite.js';
import { tmpUploadPath } from '@/utils/File.js';

/*
	Files stored on network storage (S3, Backblaze, Wasabi…) are addressed by the
	object key the backend generated when it handed out the upload URL, but that
	key travels through the client and comes back in `/upload/process`, so it is
	validated again here: it has to be a single file name, without directory
	separators, without leading dots or whitespace (which is how `..` and hidden
	files are written) and without the characters that give an URL a different
	meaning (`%`, `?`, `#`, `:`, `@`).
*/
const fileIdentifierRegex = /^[^\p{Cc}\p{Cf}\s./\\%?#:@][^\p{Cc}\p{Cf}/\\%?#:@]{0,999}$/u;

export const isValidFileIdentifier = (identifier: unknown): identifier is string =>
	typeof identifier === 'string' && fileIdentifierRegex.test(identifier);

/*
	A stored key is either a flat gallery identifier or the nested key of a
	website file (`site/{albumIdentifier}/{sitePath}`), which is validated with
	the same rules the website server uses.
*/
export const isValidStorageKey = (identifier: unknown): identifier is string =>
	typeof identifier === 'string' && (isValidFileIdentifier(identifier) || isValidSiteStorageKey(identifier));

/*
	Every segment is encoded on its own: encoding the whole key would turn the
	folder separators into `%2F` and ask the storage for a single object named
	`site%2F…` instead of for the file inside the website folder.
*/
const encodeStorageKey = (key: string) =>
	key
		.split('/')
		.map(segment => encodeURIComponent(segment))
		.join('/');

/**
 * Builds the URL a file stored on network storage is fetched from.
 *
 * The host always comes from the configured storage settings and the identifier
 * is percent-encoded, so neither the host nor the path of the request can be
 * chosen by the caller.
 */
export const constructNetworkStorageUrl = (identifier: string) => {
	if (!isValidStorageKey(identifier)) {
		throw new Error('Invalid network storage file identifier');
	}

	const configuredUrl = SETTINGS.S3PublicUrl || SETTINGS.S3Endpoint;
	if (!configuredUrl) {
		throw new Error('Network storage is not configured');
	}

	// Throws if the operator configured an URL that cannot be parsed
	const baseUrl = new URL(configuredUrl);
	const bucketUrl = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, '')}/`;
	const fileUrl = new URL(encodeStorageKey(identifier), bucketUrl);

	if (fileUrl.origin !== baseUrl.origin) {
		throw new Error('Refusing to fetch a file outside of the configured network storage');
	}

	return fileUrl;
};

/**
 * Fetches a file from network storage. Redirects are treated as errors so a
 * stored object can not bounce the request towards another host.
 */
export const fetchNetworkStorageFile = async (identifier: string) =>
	fetch(constructNetworkStorageUrl(identifier), { redirect: 'error' });

/**
 * The local path a file fetched from network storage is temporarily written to
 * while its thumbnails are generated. Directory separators and relative path
 * segments are stripped so the identifier can not escape the tmp folder.
 */
export const getNetworkStorageTmpPath = (identifier: string) => {
	if (!isValidStorageKey(identifier)) {
		throw new Error('Invalid network storage file identifier');
	}

	return path.join(tmpUploadPath, path.basename(identifier));
};
