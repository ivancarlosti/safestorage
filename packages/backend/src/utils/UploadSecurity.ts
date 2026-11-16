/*
	Uploaded files are untrusted content: they keep the extension the uploader
	chose, so a stored `.html` (or `.svg`) is a document as soon as somebody
	opens its link. The uploads share this origin with the application and the
	API also accepts the `token` cookie, which means a script inside an uploaded
	file could call `/api` with the session of whoever opens it — including an
	admin (GHSA-7hmq-gf2f-c9c9).

	`sandbox` gives the document an opaque origin and turns off scripts, plugins
	and forms; `nosniff` stops a file from being re-interpreted as another type.
	The CORS header is there because native media viewers fetch the file from
	that opaque origin.

	Keep these values in sync with the uploads `location` in
	container/nginx.conf, which serves the same folder in production.
*/
export const UPLOAD_CONTENT_SECURITY_POLICY =
	"sandbox; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const UPLOAD_SECURITY_HEADERS = {
	'Content-Security-Policy': UPLOAD_CONTENT_SECURITY_POLICY,
	'X-Content-Type-Options': 'nosniff',
	'Access-Control-Allow-Origin': '*'
} as const;

/*
	Accepts anything with a Fastify-style `header()` so both the dev static
	server and the tests can apply the headers without a full reply object.
*/
export interface UploadSecurityHeaderWriter {
	header: (name: string, value: string) => unknown;
}

export const applyUploadSecurityHeaders = (target: UploadSecurityHeaderWriter) => {
	for (const [name, value] of Object.entries(UPLOAD_SECURITY_HEADERS)) {
		target.header(name, value);
	}
};
