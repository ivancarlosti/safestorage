import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import fstatic from '@fastify/static';
import fastify, { type FastifyInstance } from 'fastify';
import { UPLOAD_CONTENT_SECURITY_POLICY, applyUploadSecurityHeaders } from '../src/utils/UploadSecurity.js';

const nginxConfigPath = fileURLToPath(new URL('../../../container/nginx.conf', import.meta.url));
const uploadedHtml = '<!doctype html><script>fetch("/api/user/me", { credentials: "include" })</script>';
const uploadedSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>';

/*
	Returns the body of the first block that starts with `header`, counting
	braces so nested blocks (there are none today) would not cut it short.
*/
const extractBlock = (source: string, header: string) => {
	const start = source.indexOf(header);
	assert.notEqual(start, -1, `container/nginx.conf has no "${header}" block`);

	const open = source.indexOf('{', start);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(open + 1, index);
		}
	}

	throw new Error(`Unbalanced "${header}" block in container/nginx.conf`);
};

describe('a file uploaded with the .html/.svg extension cannot run scripts on the application origin', () => {
	let root: string;
	let app: FastifyInstance;

	before(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'safestorage-uploads-'));
		await writeFile(path.join(root, 'poc.html'), uploadedHtml);
		await writeFile(path.join(root, 'poc.svg'), uploadedSvg);
		await writeFile(path.join(root, 'cat.png'), 'not-really-a-png');

		app = fastify();
		// Mirrors the dev static server registered in src/main.ts.
		await app.register(fstatic, {
			root,
			setHeaders: reply => applyUploadSecurityHeaders(reply)
		});
		await app.ready();
	});

	after(async () => {
		await app.close();
		await rm(root, { recursive: true, force: true });
	});

	it('serves an uploaded .html as a sandboxed document', async () => {
		const res = await app.inject({ method: 'GET', url: '/poc.html' });

		assert.equal(res.statusCode, 200);
		// The upload keeps its extension, so the browser does parse it as a page...
		assert.match(String(res.headers['content-type']), /^text\/html/);
		assert.equal(res.body, uploadedHtml);
		// ...but it lands in an opaque origin, with scripts turned off, so it
		// cannot reach /api with the token cookie of whoever opened the link.
		assert.equal(res.headers['content-security-policy'], UPLOAD_CONTENT_SECURITY_POLICY);
		assert.match(UPLOAD_CONTENT_SECURITY_POLICY, /(?:^|;\s*)sandbox(?:;|$)/);
		assert.match(UPLOAD_CONTENT_SECURITY_POLICY, /script-src 'none'/);
		assert.equal(res.headers['x-content-type-options'], 'nosniff');
		assert.equal(res.headers['access-control-allow-origin'], '*');
	});

	it('serves an uploaded .svg with the same policy', async () => {
		const res = await app.inject({ method: 'GET', url: '/poc.svg' });

		assert.equal(res.statusCode, 200);
		assert.match(String(res.headers['content-type']), /^image\/svg\+xml/);
		assert.equal(res.headers['content-security-policy'], UPLOAD_CONTENT_SECURITY_POLICY);
		assert.equal(res.headers['x-content-type-options'], 'nosniff');
	});

	it('keeps serving ordinary media inline', async () => {
		const res = await app.inject({ method: 'GET', url: '/cat.png' });

		assert.equal(res.statusCode, 200);
		assert.match(String(res.headers['content-type']), /^image\/png/);
		assert.equal(res.headers['content-security-policy'], UPLOAD_CONTENT_SECURITY_POLICY);
	});

	it('answers a file that does not exist without the upload headers', async () => {
		const res = await app.inject({ method: 'GET', url: '/missing.html' });

		assert.equal(res.statusCode, 404);
		assert.equal(res.headers['access-control-allow-origin'], undefined);
	});
});

describe('the container nginx applies the same policy to /app/uploads', () => {
	const config = readFileSync(nginxConfigPath, 'utf8');

	it('sets the sandbox, nosniff and CORS headers on the uploads location', () => {
		const uploads = extractBlock(config, 'location / {\n');

		assert.ok(uploads.includes('root /app/uploads;'), 'the uploads root must stay /app/uploads');
		assert.ok(uploads.includes('try_files $uri @frontend;'), 'missing files must still fall through to Next.js');
		assert.ok(
			uploads.includes(`add_header Content-Security-Policy "${UPLOAD_CONTENT_SECURITY_POLICY}" always;`),
			'the nginx policy must be identical to UPLOAD_CONTENT_SECURITY_POLICY'
		);
		assert.ok(uploads.includes('add_header X-Content-Type-Options "nosniff" always;'));
		assert.ok(uploads.includes('add_header Access-Control-Allow-Origin "*" always;'));
	});

	it('does not sandbox or open the Next.js fallback to other origins', () => {
		const frontend = extractBlock(config, 'location @frontend {\n');

		assert.ok(!frontend.includes('Content-Security-Policy'));
		assert.ok(!frontend.includes('Access-Control-Allow-Origin'));
		// Only the uploads location answers with the CORS header.
		assert.equal(config.match(/Access-Control-Allow-Origin/g)?.length, 1);
	});
});
