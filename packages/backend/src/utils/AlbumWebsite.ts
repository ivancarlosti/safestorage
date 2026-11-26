/*
	Static website hosting helpers.

	Everything in this file is pure, so the path sanitisation, the resolution
	rules and the host parsing can be unit tested without a database, a logger or
	the loaded instance settings.
*/

export const SITE_PATH_MAX_LENGTH = 1024;
export const SITE_SEGMENT_MAX_LENGTH = 255;
export const SITE_INDEX_FILE = 'index.html';
export const SITE_NOT_FOUND_FILE = '404.html';

// DNS label: lowercase, digits and dashes, no leading/trailing dash, max 63 chars.
const DNS_SAFE_IDENTIFIER = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// A bare FQDN: no scheme, no port, no path, at least one dot.
const HOSTING_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// NUL and the other C0 controls (plus DEL) never belong in a path or a host.
const hasControlCharacter = (value: string) => {
	for (const character of value) {
		const code = character.codePointAt(0)!;
		if (code < 0x20 || code === 0x7f) return true;
	}

	return false;
};

export const isDnsSafeIdentifier = (identifier: string) => DNS_SAFE_IDENTIFIER.test(identifier);

export const normalizeHostingDomain = (domain?: string | null) =>
	(domain ?? '').trim().toLowerCase().replace(/\.$/, '');

export const isValidHostingDomain = (domain?: string | null) => HOSTING_DOMAIN.test(normalizeHostingDomain(domain));

/*
	Turns a browser-provided path (`webkitRelativePath`, which already contains the
	directory the user picked, or the plain file name) into a relative site path.
	`null` means "this file cannot be served on the website" and the caller keeps
	the file out of the index instead of guessing a name for it.
*/
export const normalizeSitePath = (rawPath?: string | null): string | null => {
	if (!rawPath) return null;

	// Windows separators and absolute paths (POSIX or Windows drive) never belong
	// in a site path, and neither do control characters.
	const path = rawPath.replace(/\\/g, '/');
	if (hasControlCharacter(path)) return null;
	if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;

	const segments: string[] = [];
	for (const segment of path.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') return null;
		if (segment.length > SITE_SEGMENT_MAX_LENGTH) return null;
		segments.push(segment);
	}

	if (!segments.length) return null;

	const normalized = segments.join('/');
	if (normalized.length > SITE_PATH_MAX_LENGTH) return null;

	return normalized;
};

export interface SiteFileEntry {
	createdAt: Date;
	hash: string;
	isS3: boolean;
	isWatched: boolean;
	name: string;
	original: string;
	sitePath: string | null;
	size: string;
	type: string;
	uuid: string;
}

export interface SiteIndex {
	files: Map<string, SiteFileEntry>;
	warnings: string[];
}

/*
	The path the file is reachable at inside the website. Files uploaded before the
	feature existed (or without a relative path) fall back to their sanitised
	original name, so a flat album still works as a website.
*/
export const getSitePathForFile = (file: Pick<SiteFileEntry, 'original' | 'sitePath'>) =>
	normalizeSitePath(file.sitePath) ?? normalizeSitePath(file.original);

/*
	Builds the path -> file map of a website.

	Two files can claim the same path (the same `index.html` in two folders that
	were uploaded separately). There is no safe automatic answer, so the oldest
	file wins and the collision is reported back to the album owner.
*/
export const buildSiteIndex = (files: SiteFileEntry[]): SiteIndex => {
	const index = new Map<string, SiteFileEntry>();
	const warnings: string[] = [];

	const ordered = [...files].sort(
		(fileA, fileB) => fileA.createdAt.getTime() - fileB.createdAt.getTime() || fileA.name.localeCompare(fileB.name)
	);

	for (const file of ordered) {
		const sitePath = getSitePathForFile(file);
		if (!sitePath) {
			warnings.push(
				`"${file.original}" cannot be served as a website file because its path is not a safe relative path.`
			);
			continue;
		}

		if (index.has(sitePath)) {
			warnings.push(`"${sitePath}" is used by more than one file; the oldest one is served.`);
			continue;
		}

		index.set(sitePath, { ...file, sitePath });
	}

	return { files: index, warnings };
};

/*
	Percent-decodes the request path exactly once. A second decoding pass would
	turn `%252e%252e` into `..`, which is how encoded traversal bugs happen.
*/
export const decodeSiteRequestPath = (requestPath: string): string | null => {
	let decoded: string;
	try {
		decoded = decodeURIComponent(requestPath);
	} catch {
		return null;
	}

	if (hasControlCharacter(decoded)) return null;
	if (!decoded.startsWith('/')) return null;

	// Backslashes are treated as separators by some clients; normalise them so a
	// `..\..` cannot slip through as a single file name.
	const path = decoded.replace(/\\/g, '/');
	const rawSegments = path.split('/').slice(1);
	const trailingSlash = rawSegments.length > 0 && rawSegments[rawSegments.length - 1] === '';

	const segments: string[] = [];
	for (const segment of rawSegments) {
		if (!segment || segment === '.') continue;
		if (segment === '..') return null;
		if (segment.length > SITE_SEGMENT_MAX_LENGTH) return null;
		segments.push(segment);
	}

	const joined = segments.join('/');
	if (joined.length > SITE_PATH_MAX_LENGTH) return null;
	if (!joined) return '/';

	return trailingSlash ? `/${joined}/` : `/${joined}`;
};

export type SiteResolution =
	| { entry: SiteFileEntry; path: string; status: 200 }
	| { location: string; status: 301 }
	| { fallback: SiteFileEntry | undefined; status: 404 };

export const resolveSiteRequest = (siteIndex: SiteIndex, requestPath: string): SiteResolution => {
	const notFound = (): SiteResolution => ({
		status: 404,
		fallback: siteIndex.files.get(SITE_NOT_FOUND_FILE)
	});

	const normalized = decodeSiteRequestPath(requestPath);
	if (!normalized) return notFound();

	if (normalized === '/') {
		const entry = siteIndex.files.get(SITE_INDEX_FILE);
		return entry ? { status: 200, entry, path: SITE_INDEX_FILE } : notFound();
	}

	const relative = normalized.slice(1);

	// `/dir/` -> `dir/index.html`
	if (normalized.endsWith('/')) {
		const candidate = `${relative}${SITE_INDEX_FILE}`;
		const entry = siteIndex.files.get(candidate);
		return entry ? { status: 200, entry, path: candidate } : notFound();
	}

	const direct = siteIndex.files.get(relative);
	if (direct) return { status: 200, entry: direct, path: relative };

	/*
		An extension-less path that names a directory is missing its trailing slash:
		redirect to the canonical `/dir/` so relative links inside the page resolve
		against the directory instead of its parent.
	*/
	const lastSegment = relative.slice(relative.lastIndexOf('/') + 1);
	if (lastSegment && !lastSegment.includes('.') && siteIndex.files.has(`${relative}/${SITE_INDEX_FILE}`)) {
		return { status: 301, location: `${normalized}/` };
	}

	return notFound();
};

export const isDocumentSitePath = (sitePath: string) => /\.html?$/i.test(sitePath);

/*
	Matches `{identifier}.{hostingDomain}` (and only that: nested labels such as
	`a.b.example.com` are not valid site hosts). The port and a trailing dot, both
	allowed in a Host header, are stripped first.
*/
export const parseSiteHost = (hostHeader: string | undefined | null, hostingDomain: string): string | null => {
	const domain = normalizeHostingDomain(hostingDomain);
	if (!hostHeader || !domain) return null;

	const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

	const suffix = `.${domain}`;
	if (!host.endsWith(suffix)) return null;

	const identifier = host.slice(0, -suffix.length);
	if (!identifier || identifier.includes('.')) return null;

	return isDnsSafeIdentifier(identifier) ? identifier : null;
};

/*
	Origins that must never receive a credentialed CORS grant to the instance.

	`null` is the origin of a sandboxed document (an uploaded file, or an album
	served as a website in path mode). Its requests still carry the application
	cookies of the visitor because the cookie belongs to the URL host, so a grant
	would let a hosted website read `/api/user/me` with the session of whoever
	opens it. A site subdomain is refused for the same reason.
*/
export const isForbiddenCorsOrigin = (origin: string | undefined, hostingDomain: string) => {
	if (!origin) return false;
	if (origin === 'null') return true;

	try {
		return parseSiteHost(new URL(origin).hostname, hostingDomain) !== null;
	} catch {
		return true;
	}
};
