/*
	Security headers for albums served as static websites.

	Path mode serves untrusted HTML from the application origin, so the document
	has to live in an opaque origin: `sandbox` without `allow-same-origin` keeps
	scripts working (websites need them) while denying access to the application
	cookies, storage and /api session. This mirrors the upload sandbox in
	UploadSecurity.ts, relaxed just enough for a real website to run.

	Domain mode serves the site from its own origin, so a sandbox would only break
	localStorage, service workers and history routing. The document there is the
	top-level site and cannot reach the application origin's cookies anyway, as
	long as those cookies stay host-only; only framing and MIME sniffing are
	restricted.

	Keep the path-mode policy in sync with the `/site/` location in
	container/nginx.conf.
*/
export const WEBSITE_PATH_CONTENT_SECURITY_POLICY =
	"sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export const WEBSITE_DOMAIN_CONTENT_SECURITY_POLICY = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

export const WEBSITE_PERMISSIONS_POLICY =
	'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

export const WEBSITE_PATH_SECURITY_HEADERS = {
	'Content-Security-Policy': WEBSITE_PATH_CONTENT_SECURITY_POLICY,
	'X-Content-Type-Options': 'nosniff',
	'Cross-Origin-Resource-Policy': 'cross-origin',
	'Access-Control-Allow-Origin': '*',
	'Referrer-Policy': 'no-referrer',
	'Permissions-Policy': WEBSITE_PERMISSIONS_POLICY
} as const;

export const WEBSITE_DOMAIN_SECURITY_HEADERS = {
	'Content-Security-Policy': WEBSITE_DOMAIN_CONTENT_SECURITY_POLICY,
	'X-Content-Type-Options': 'nosniff',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Referrer-Policy': 'no-referrer',
	'Permissions-Policy': WEBSITE_PERMISSIONS_POLICY
} as const;

export type WebsiteSecurityMode = 'domain' | 'path';

export interface WebsiteHeaderWriter {
	header: (name: string, value: string) => unknown;
}

export const applyWebsiteSecurityHeaders = (target: WebsiteHeaderWriter, mode: WebsiteSecurityMode) => {
	const headers = mode === 'domain' ? WEBSITE_DOMAIN_SECURITY_HEADERS : WEBSITE_PATH_SECURITY_HEADERS;
	for (const [name, value] of Object.entries(headers)) {
		target.header(name, value);
	}
};
