import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildSiteIndex,
	decodeSiteRequestPath,
	getSiteStorageDirectory,
	getSiteStorageKey,
	isDnsSafeIdentifier,
	isForbiddenCorsOrigin,
	isSiteStorageKey,
	isValidHostingDomain,
	isValidSiteStorageKey,
	normalizeHostingDomain,
	normalizeSitePath,
	parseSiteHost,
	parseSiteStorageKey,
	resolveSiteRequest,
	stripCommonRootPaths,
	type SiteFileEntry
} from '../src/utils/AlbumWebsite.js';
import { WEBSITE_PATH_CONTENT_SECURITY_POLICY, applyWebsiteSecurityHeaders } from '../src/utils/WebsiteSecurity.js';

const nginxConfigPath = fileURLToPath(new URL('../../../container/nginx.conf', import.meta.url));

const entry = (overrides: Partial<SiteFileEntry> = {}): SiteFileEntry => ({
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	hash: 'hash',
	isS3: false,
	isWatched: false,
	name: 'abc.html',
	original: 'index.html',
	sitePath: 'index.html',
	size: '10',
	type: 'text/html',
	uuid: 'uuid',
	...overrides
});

describe('normalizeSitePath accepts only safe relative paths', () => {
	it('keeps nested relative paths and normalises separators', () => {
		assert.equal(normalizeSitePath('index.html'), 'index.html');
		assert.equal(normalizeSitePath('site/index.html'), 'site/index.html');
		assert.equal(normalizeSitePath('site\\css\\style.css'), 'site/css/style.css');
		assert.equal(normalizeSitePath('./site//index.html'), 'site/index.html');
	});

	it('refuses traversal, absolute paths, control characters and oversized paths', () => {
		assert.equal(normalizeSitePath('../etc/passwd'), null);
		assert.equal(normalizeSitePath('site/../../etc/passwd'), null);
		assert.equal(normalizeSitePath('/etc/passwd'), null);
		assert.equal(normalizeSitePath('C:/Windows/system32'), null);
		assert.equal(normalizeSitePath('index.html\u0000.png'), null);
		assert.equal(normalizeSitePath('a'.repeat(256)), null);
		assert.equal(normalizeSitePath(`${'a/'.repeat(600)}index.html`), null);
		assert.equal(normalizeSitePath(''), null);
		assert.equal(normalizeSitePath('.'), null);
		assert.equal(normalizeSitePath(null), null);
	});
});

describe('buildSiteIndex maps site paths to files', () => {
	it('falls back to the sanitised original name', () => {
		const index = buildSiteIndex([entry({ original: 'photo.jpg', sitePath: null, name: 'x.jpg' })]);

		assert.equal(index.files.get('photo.jpg')?.name, 'x.jpg');
		assert.deepEqual(index.warnings, []);
	});

	it('keeps the oldest file when two files claim the same path and reports it', () => {
		const index = buildSiteIndex([
			entry({
				createdAt: new Date('2026-02-01T00:00:00.000Z'),
				name: 'new.html',
				original: 'index.html',
				sitePath: 'index.html',
				uuid: 'new'
			}),
			entry({
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				name: 'old.html',
				original: 'index.html',
				sitePath: 'index.html',
				uuid: 'old'
			})
		]);

		assert.equal(index.files.get('index.html')?.uuid, 'old');
		assert.equal(index.warnings.length, 1);
		assert.match(index.warnings[0]!, /index\.html/);
	});

	it('keeps files with an unsafe path out of the index and warns', () => {
		const index = buildSiteIndex([entry({ original: '../secret.html', sitePath: '../secret.html' })]);

		assert.equal(index.files.size, 0);
		assert.equal(index.warnings.length, 1);
	});
});

describe('a website file lives in the folder of its album', () => {
	it('builds site/{albumIdentifier}/{sitePath} and keeps the file name as it is', () => {
		assert.equal(getSiteStorageKey('abc123', 'index.html'), 'site/abc123/index.html');
		assert.equal(getSiteStorageKey('abc123', 'css/app.css'), 'site/abc123/css/app.css');
		assert.equal(
			getSiteStorageKey('abc123', 'Café Menu/index.html'),
			'site/abc123/Café Menu/index.html',
			'case and unicode are part of the path and must not be normalised'
		);
		assert.equal(getSiteStorageKey('abc123', 'CNAME'), 'site/abc123/CNAME');
	});

	it('refuses an album folder that is not a DNS-safe identifier', () => {
		assert.equal(getSiteStorageKey('ABC123', 'index.html'), null);
		assert.equal(getSiteStorageKey('../etc', 'index.html'), null);
		assert.equal(getSiteStorageKey('abc/def', 'index.html'), null);
		assert.equal(getSiteStorageKey('', 'index.html'), null);
	});

	it('refuses paths that would escape the folder', () => {
		assert.equal(getSiteStorageKey('abc123', '../index.html'), null);
		assert.equal(getSiteStorageKey('abc123', '/etc/passwd'), null);
		assert.equal(getSiteStorageKey('abc123', 'a'.repeat(300)), null);
		assert.equal(getSiteStorageKey('abc123', `${'a/'.repeat(1000)}index.html`), null);
	});

	it('parses its own keys back into the album and the path', () => {
		assert.deepEqual(parseSiteStorageKey('site/abc123/css/app.css'), {
			albumIdentifier: 'abc123',
			sitePath: 'css/app.css'
		});
		assert.deepEqual(parseSiteStorageKey('site/abc123/Café Menu/index.html'), {
			albumIdentifier: 'abc123',
			sitePath: 'Café Menu/index.html'
		});
	});

	it('refuses anything that is not a website key', () => {
		assert.equal(parseSiteStorageKey('abcd1234.png'), null);
		assert.equal(parseSiteStorageKey('site/abc123'), null);
		assert.equal(parseSiteStorageKey('site/abc123/'), null);
		assert.equal(parseSiteStorageKey('site/ABC123/index.html'), null);
		assert.equal(parseSiteStorageKey('site/abc123/../index.html'), null);
		assert.equal(parseSiteStorageKey('sites/abc123/index.html'), null);

		assert.equal(isSiteStorageKey('site/abc123/index.html'), true);
		assert.equal(isSiteStorageKey('abcd1234.png'), false);
		assert.equal(isValidSiteStorageKey('site/abc123/index.html'), true);
		assert.equal(isValidSiteStorageKey('abcd1234.png'), false);
	});

	it('knows the folder a key lives in', () => {
		assert.equal(getSiteStorageDirectory('site/abc123/css/app.css'), 'site/abc123/css');
		assert.equal(getSiteStorageDirectory('site/abc123/index.html'), 'site/abc123');
		assert.equal(getSiteStorageDirectory('abcd1234.png'), '');
	});
});

describe('stripCommonRootPaths removes the folder that was picked, not the site', () => {
	it('strips a root every path shares', () => {
		assert.deepEqual(stripCommonRootPaths(['dist/index.html', 'dist/css/app.css']), ['index.html', 'css/app.css']);
	});

	it('keeps the paths when they do not share a root', () => {
		assert.deepEqual(stripCommonRootPaths(['index.html', 'css/app.css']), ['index.html', 'css/app.css']);
		assert.deepEqual(stripCommonRootPaths(['dist/index.html', 'other/app.css']), [
			'dist/index.html',
			'other/app.css'
		]);
	});

	it('keeps the name of a single loose file', () => {
		assert.deepEqual(stripCommonRootPaths(['index.html']), ['index.html']);
		assert.deepEqual(stripCommonRootPaths([]), []);
	});
});

describe('resolveSiteRequest implements the static hosting rules', () => {
	const siteIndex = buildSiteIndex([
		entry({ name: 'root.html', original: 'index.html', sitePath: 'index.html', uuid: 'root' }),
		entry({
			createdAt: new Date('2026-01-02T00:00:00.000Z'),
			name: 'docs.html',
			original: 'docs/index.html',
			sitePath: 'docs/index.html',
			uuid: 'docs'
		}),
		entry({
			createdAt: new Date('2026-01-03T00:00:00.000Z'),
			name: 'app.js',
			original: 'assets/app.js',
			sitePath: 'assets/app.js',
			type: 'text/javascript',
			uuid: 'app'
		}),
		entry({
			createdAt: new Date('2026-01-04T00:00:00.000Z'),
			name: '404.html',
			original: '404.html',
			sitePath: '404.html',
			uuid: 'notfound'
		}),
		entry({
			createdAt: new Date('2026-01-05T00:00:00.000Z'),
			name: 'cafe.html',
			original: 'café.html',
			sitePath: 'café.html',
			uuid: 'cafe'
		}),
		entry({
			createdAt: new Date('2026-01-06T00:00:00.000Z'),
			name: 'cname.txt',
			original: 'CNAME',
			sitePath: 'CNAME',
			uuid: 'cname'
		})
	]);

	it('serves index.html for the root', () => {
		const resolution = resolveSiteRequest(siteIndex, '/');

		assert.equal(resolution.status, 200);
		assert.equal(resolution.status === 200 && resolution.path, 'index.html');
	});

	it('serves the directory index for a trailing slash', () => {
		const resolution = resolveSiteRequest(siteIndex, '/docs/');

		assert.equal(resolution.status, 200);
		assert.equal(resolution.status === 200 && resolution.path, 'docs/index.html');
	});

	it('redirects an extension-less directory to its trailing slash form', () => {
		assert.deepEqual(resolveSiteRequest(siteIndex, '/docs'), { status: 301, location: '/docs/' });
	});

	it('serves assets and percent-encoded names', () => {
		assert.equal(resolveSiteRequest(siteIndex, '/assets/app.js').status, 200);
		assert.equal(resolveSiteRequest(siteIndex, '/caf%C3%A9.html').status, 200);
		// A file without an extension is still a file, not a directory
		assert.equal(resolveSiteRequest(siteIndex, '/CNAME').status, 200);
	});

	it('serves the 404 page with a 404 status for anything missing', () => {
		const resolution = resolveSiteRequest(siteIndex, '/nope.html');

		assert.equal(resolution.status, 404);
		assert.equal(resolution.status === 404 && resolution.fallback?.uuid, 'notfound');
	});

	describe('request paths are decoded exactly once and cannot escape the index', () => {
		it('rejects encoded and double encoded traversal', () => {
			assert.equal(decodeSiteRequestPath('/%2e%2e/secret'), null);
			assert.equal(decodeSiteRequestPath('/..%2fsecret'), null);
			assert.equal(decodeSiteRequestPath('/%00/index.html'), null);
			assert.equal(decodeSiteRequestPath('relative.html'), null);
			assert.equal(decodeSiteRequestPath('/%zz'), null);
		});

		it('keeps a double encoded traversal as a literal file name', () => {
			// `%252e%252e` decodes to `%2e%2e`, which is a file name, never `..`
			assert.equal(decodeSiteRequestPath('/%252e%252e/x'), '/%2e%2e/x');
		});

		it('collapses redundant segments but keeps the trailing slash', () => {
			assert.equal(decodeSiteRequestPath('//docs//'), '/docs/');
			assert.equal(decodeSiteRequestPath('/./docs/index.html'), '/docs/index.html');
		});

		it('does not match the forbidden paths against a real index', () => {
			const siteIndex = buildSiteIndex([entry({ sitePath: 'index.html' })]);

			assert.equal(resolveSiteRequest(siteIndex, '/../index.html').status, 404);
			assert.equal(resolveSiteRequest(siteIndex, '/%2e%2e/index.html').status, 404);
		});
	});

	describe('site hosts and hosting domains', () => {
		it('parses {identifier}.{domain} and strips the port and a trailing dot', () => {
			assert.equal(parseSiteHost('site1.sites.example.com', 'sites.example.com'), 'site1');
			assert.equal(parseSiteHost('site1.sites.example.com:8080', 'sites.example.com'), 'site1');
			assert.equal(parseSiteHost('Site1.Sites.Example.com.', 'sites.example.com'), 'site1');
		});

		it('refuses the bare domain, nested labels and other domains', () => {
			assert.equal(parseSiteHost('sites.example.com', 'sites.example.com'), null);
			assert.equal(parseSiteHost('a.b.sites.example.com', 'sites.example.com'), null);
			assert.equal(parseSiteHost('site1.example.org', 'sites.example.com'), null);
			assert.equal(parseSiteHost('site_1.sites.example.com', 'sites.example.com'), null);
			assert.equal(parseSiteHost(undefined, 'sites.example.com'), null);
			assert.equal(parseSiteHost('site1.sites.example.com', ''), null);
		});

		it('normalises and validates the configured domain', () => {
			assert.equal(normalizeHostingDomain(' Sites.Example.com. '), 'sites.example.com');
			assert.equal(isValidHostingDomain('sites.example.com'), true);
			assert.equal(isValidHostingDomain('localhost'), false);
			assert.equal(isValidHostingDomain('https://sites.example.com'), false);
			assert.equal(isValidHostingDomain('sites.example.com/path'), false);
		});

		it('requires DNS-safe identifiers for website links', () => {
			assert.equal(isDnsSafeIdentifier('my-site'), true);
			assert.equal(isDnsSafeIdentifier('site1'), true);
			assert.equal(isDnsSafeIdentifier('My_Site'), false);
			assert.equal(isDnsSafeIdentifier('-site'), false);
			assert.equal(isDnsSafeIdentifier('site-'), false);
			assert.equal(isDnsSafeIdentifier('a'.repeat(64)), false);
		});
	});
	describe('sandboxed documents and site subdomains get no credentialed CORS grant', () => {
		it('refuses the opaque origin of a sandboxed document', () => {
			assert.equal(isForbiddenCorsOrigin('null', 'sites.example.com'), true);
			assert.equal(isForbiddenCorsOrigin('null', ''), true);
		});

		it('refuses a site subdomain but keeps the instance origin usable', () => {
			assert.equal(isForbiddenCorsOrigin('https://site1.sites.example.com', 'sites.example.com'), true);
			assert.equal(isForbiddenCorsOrigin('https://sites.example.com', 'sites.example.com'), false);
			assert.equal(isForbiddenCorsOrigin('https://files.example.com', 'sites.example.com'), false);
		});

		it('keeps requests without an Origin working and refuses a malformed one', () => {
			assert.equal(isForbiddenCorsOrigin(undefined, 'sites.example.com'), false);
			assert.equal(isForbiddenCorsOrigin('not a url', 'sites.example.com'), true);
		});
	});

	describe('path mode never gives a website the application origin', () => {
		it('sandboxes the document and keeps scripts working', () => {
			// Regression test: `allow-same-origin` would let the site reach the
			// cookies and /api of the instance, defeating the whole sandbox.
			assert.match(WEBSITE_PATH_CONTENT_SECURITY_POLICY, /(?:^|;\s*)sandbox\b/);
			assert.match(WEBSITE_PATH_CONTENT_SECURITY_POLICY, /allow-scripts/);
			assert.doesNotMatch(WEBSITE_PATH_CONTENT_SECURITY_POLICY, /allow-same-origin/);
		});

		it('applies the header set through the shared writer', () => {
			const headers: Record<string, string> = {};
			const writer = {
				header: (name: string, value: string) => {
					headers[name.toLowerCase()] = value;
				}
			};

			applyWebsiteSecurityHeaders(writer, 'path');

			assert.equal(headers['content-security-policy'], WEBSITE_PATH_CONTENT_SECURITY_POLICY);
			assert.equal(headers['x-content-type-options'], 'nosniff');
			assert.equal(headers['cross-origin-resource-policy'], 'cross-origin');
			assert.equal(headers['access-control-allow-origin'], '*');
			assert.equal(headers['referrer-policy'], 'no-referrer');
		});

		it('serves domain mode without the opaque-origin sandbox', () => {
			const headers: Record<string, string> = {};
			const writer = {
				header: (name: string, value: string) => {
					headers[name.toLowerCase()] = value;
				}
			};

			applyWebsiteSecurityHeaders(writer, 'domain');

			assert.doesNotMatch(headers['content-security-policy'] ?? '', /sandbox/);
			assert.match(headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
			assert.equal(headers['x-content-type-options'], 'nosniff');
		});
	});

	describe('the container exposes the website entry points', () => {
		const config = readFileSync(nginxConfigPath, 'utf8');

		it('proxies /site/ to the backend on the main port', () => {
			const start = config.indexOf('location /site/ {');
			assert.notEqual(start, -1, 'container/nginx.conf has no /site/ location');
			const block = config.slice(start, config.indexOf('}', start));

			assert.ok(block.includes('proxy_pass http://safestorage_backend;'));
		});

		it('has a dedicated listener for the site subdomains', () => {
			const start = config.indexOf('listen 8080;');
			assert.notEqual(start, -1, 'container/nginx.conf has no 8080 listener');
			const serverBlock = config.slice(start, config.indexOf('location / {', start));

			assert.ok(serverBlock.includes('server_name _;'));
		});

		it('never serves the storage folder of the website albums', () => {
			// `/site` is `uploads/site`, the folder the albums are stored in. Without
			// the exact match nginx would answer it as a directory of `/app/uploads`
			// and expose the storage layout.
			assert.ok(config.includes('location = /site {'));
			const start = config.indexOf('location = /site {');
			const block = config.slice(start, config.indexOf('}', start));

			assert.ok(block.includes('return 404;'));
		});
	});

	it('answers without a fallback when the album has no 404.html', () => {
		const bareIndex = buildSiteIndex([entry({ sitePath: 'index.html' })]);

		assert.deepEqual(resolveSiteRequest(bareIndex, '/missing'), { status: 404, fallback: undefined });
	});
});
