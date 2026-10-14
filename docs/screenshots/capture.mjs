/**
 * SafeStorage screenshot generator.
 *
 * Logs into a running SafeStorage instance as the admin user, seeds it with
 * synthetic demo content (albums, tags, snippets, short links and generated
 * images uploaded through the real UI uploader) and then captures the pages
 * referenced from the root README into `docs/screenshots`.
 *
 * Configuration (all optional):
 *   BASE_URL        Base URL of the account instance (default http://localhost:24424)
 *   KEYCLOAK_URL    Base URL of an instance booted with AUTH_METHOD=keycloak, used
 *                   to capture the single sign-on login screen (skipped when unset)
 *   ADMIN_USERNAME  Login username (default `admin`)
 *   ADMIN_PASSWORD  Login password (default `admin`)
 *   OUTPUT_DIR      Where the PNGs are written (default this folder)
 *   PW_CHANNEL      Force a Playwright browser channel (e.g. `chrome`)
 *   ASSET_DIR       Where the demo images are generated (default ./.assets)
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { generateDemoImages } from './placeholders.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// None of the values below are ever interpolated into log output: CodeQL's
// `js/clear-text-logging` query treats every `process.env` read as a potential
// secret (and `*user*name` / `*id` names such as ADMIN_USERNAME as sensitive
// outright), so this script logs static messages only.
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:24424').replace(/\/+$/, '');
// `authMethod` is resolved server-side from the environment, so the single
// sign-on login screen can only be photographed on an instance booted with
// `AUTH_METHOD=keycloak`. That instance is booted separately (see generate.sh).
const KEYCLOAK_URL = (process.env.KEYCLOAK_URL ?? '').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';
const OUTPUT_DIR = process.env.OUTPUT_DIR ? path.resolve(process.env.OUTPUT_DIR) : here;
const ASSET_DIR = process.env.ASSET_DIR ? path.resolve(process.env.ASSET_DIR) : path.join(here, '.assets');
const VIEWPORT = { width: 1440, height: 900 };

const DEMO_ALBUMS = ['Team offsite', 'Wallpapers', 'Design references'];
const DEMO_TAGS = ['team', 'wallpaper', 'design', 'holiday'];
const DEMO_IMAGES = 9;

let token = '';

const log = message => console.log(`[screenshots] ${message}`);

/** Small JSON helper around the SafeStorage API. */
const api = async (endpoint, { method = 'GET', body, auth = true } = {}) => {
	const headers = {};
	if (body !== undefined) headers['content-type'] = 'application/json';
	if (auth && token) headers.authorization = `Bearer ${token}`;

	const response = await fetch(`${BASE_URL}/api${endpoint}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	const text = await response.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = text;
	}

	if (!response.ok) {
		throw new Error(`${method} /api${endpoint} -> ${response.status} ${text.slice(0, 300)}`);
	}

	return data;
};

const waitForInstance = async (timeoutMs = 180_000) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
			if (response.ok) return;
		} catch {
			// Not up yet.
		}

		if (Date.now() > deadline) throw new Error('SafeStorage did not become healthy in time');
		await new Promise(resolve => setTimeout(resolve, 2000));
	}
};

/**
 * Thumbnails are generated asynchronously by the backend right after an upload,
 * so a freshly uploaded image can briefly 404 on its own thumb. Wait (bounded)
 * for the first few to be served, otherwise the grid screenshots fall back to
 * generic file icons.
 */
const waitForThumbnails = async (files, timeoutMs = 20_000) => {
	const urls = files
		.map(file => file.thumb)
		.filter(Boolean)
		.slice(0, 4);
	if (!urls.length) return;

	const deadline = Date.now() + timeoutMs;
	for (const url of urls) {
		for (;;) {
			try {
				const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
				if (response.ok) break;
			} catch {
				// Not generated yet.
			}

			if (Date.now() > deadline) {
				log(`warning: ${url} did not become available, capturing anyway`);
				return;
			}

			await new Promise(resolve => setTimeout(resolve, 500));
		}
	}

	log(`thumbnails available (${urls.length} checked)`);
};

/** Tries the bundled Chromium first, then whatever Chrome is on the machine. */
const launchBrowser = async () => {
	const base = {
		args: [
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--force-color-profile=srgb',
			'--hide-scrollbars',
			'--font-render-hinting=none'
		]
	};

	const candidates = process.env.PW_CHANNEL
		? [{ channel: process.env.PW_CHANNEL, label: 'PW_CHANNEL' }]
		: [
				{ label: 'bundled chromium' },
				{ channel: 'chrome', label: 'chrome' },
				{ channel: 'chromium', label: 'chromium' }
			];

	for (const { label, ...launchOptions } of candidates) {
		try {
			return await chromium.launch({ ...base, ...launchOptions });
		} catch (error) {
			log(`browser ${label} unavailable (${String(error.message).split('\n')[0]})`);
		}
	}

	throw new Error(
		'No usable Chromium/Chrome found. Install one, set PW_CHANNEL, or use the Playwright Docker image.'
	);
};

const seedDemoContent = async () => {
	log('seeding demo content through the API');

	// - the shortener is off by default, and the "Short URLs" screen needs it on;
	// - without `serveUploadsFrom` the backend builds thumbnail URLs from the Host
	//   header nginx passes on, which has no port, so every thumbnail 404s.
	await api('/admin/service/settings', {
		method: 'POST',
		body: {
			settings: [
				{ key: 'useUrlShortener', value: 'true', type: 'boolean' },
				{ key: 'serviceName', value: 'SafeStorage', type: 'string' },
				{ key: 'serveUploadsFrom', value: BASE_URL, type: 'string' }
			]
		}
	});

	const albums = [];
	for (const name of DEMO_ALBUMS) {
		const { album } = await api('/album/create', { method: 'POST', body: { name } });
		albums.push(album);
		log(`album "${name}" -> ${album.uuid}`);
	}

	for (const name of DEMO_TAGS) {
		await api('/tag/create', { method: 'POST', body: { name } });
	}

	const composeSnippet = await api('/snippet/create', {
		method: 'POST',
		body: {
			name: 'docker-compose.yml',
			language: 'yaml',
			content: [
				'services:',
				'  safestorage:',
				'    image: ghcr.io/ivancarlosti/safestorage:latest',
				'    restart: unless-stopped',
				'    ports:',
				"      - '24424:80'",
				'    environment:',
				'      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-admin}',
				'      DATABASE_URL: mysql://safestorage:secret@mariadb:3306/safestorage',
				'    volumes:',
				'      - ./uploads:/app/uploads',
				'      - ./logs:/app/logs',
				'',
				'  mariadb:',
				'    image: mariadb:11.4',
				'    environment:',
				'      MARIADB_DATABASE: safestorage',
				'      MARIADB_USER: safestorage',
				'      MARIADB_PASSWORD: secret',
				'      MARIADB_ROOT_PASSWORD: secret-root',
				'    volumes:',
				'      - mariadb:/var/lib/mysql'
			].join('\n')
		}
	});

	const uploadSnippet = await api('/snippet/create', {
		method: 'POST',
		body: {
			name: 'upload.ts',
			language: 'typescript',
			content: [
				"import { safeStorageUploader } from '@safestorage/uploader-client';",
				'',
				'// Files are split into chunks, so multi-gigabyte uploads',
				'// stream straight through nginx without buffering.',
				'await safeStorageUploader({',
				"\tendpoint: '/api/upload',",
				'\tfile,',
				'\tonProgress: (_uuid, progress) => console.log(progress),',
				'\tonFinish: (_uuid, response) => console.log(response.url)',
				'});'
			].join('\n')
		}
	});

	// Plain short links, so the "Short URLs" page is populated.
	for (const url of [
		'https://docs.safestorage.example.com/configuration',
		'https://github.com/ivancarlosti/safestorage'
	]) {
		await api('/link/create', { method: 'POST', body: { url } });
	}

	// A public link for the first album, so the shared album view can be captured.
	const albumLink = await api(`/album/${albums[0].uuid}/link`, { method: 'POST', body: {} });

	return {
		albums,
		snippets: [composeSnippet.snippet, uploadSnippet.snippet],
		albumIdentifier: albumLink.data.identifier
	};
};

/** Uploads the generated demo images through the dashboard's real uploader. */
const seedDemoUploads = async page => {
	log(`generating ${DEMO_IMAGES} demo images`);
	const files = generateDemoImages(ASSET_DIR, DEMO_IMAGES);

	const before = await api('/files?page=1&limit=1');
	await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 60_000 });

	// The dashboard's "Upload file" button is a react-aria FileTrigger: a plain
	// (visually hidden) <input type="file"> that we can feed directly.
	await page.locator('input[type="file"]').first().setInputFiles(files);

	const expected = (before.count ?? 0) + files.length;
	const deadline = Date.now() + 120_000;
	for (;;) {
		const current = await api('/files?page=1&limit=1');
		if ((current.count ?? 0) >= expected) break;
		if (Date.now() > deadline) throw new Error(`Timed out waiting for uploads (${current.count ?? 0}/${expected})`);
		await page.waitForTimeout(1500);
	}

	log(`${files.length} files uploaded`);
	const { files: uploaded } = await api('/files?page=1&limit=100');
	await waitForThumbnails(uploaded);
	return uploaded;
};

const main = async () => {
	await mkdir(OUTPUT_DIR, { recursive: true });

	log('waiting for the instance to become healthy');
	await waitForInstance();

	log('logging in as the configured admin user');
	const session = await api('/auth/login', {
		method: 'POST',
		body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
		auth: false
	});
	token = session.token;

	const seed = await seedDemoContent();

	const browser = await launchBrowser();
	const contextOptions = {
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		colorScheme: 'dark',
		locale: 'en-US',
		timezoneId: 'UTC'
	};

	// Hide the TanStack Query devtools bubble, in case the build ships it.
	const hardening = () => {
		document.addEventListener(
			'DOMContentLoaded',
			() => {
				const style = document.createElement('style');
				style.textContent = '[class*="tsqd"]{display:none !important}';
				document.head.append(style);
			},
			{ once: true }
		);
	};

	const context = await browser.newContext(contextOptions);
	await context.addInitScript(hardening);
	await context.addCookies([{ name: 'token', value: token, url: BASE_URL }]);
	const page = await context.newPage();

	// Public pages get a clean, logged-out context, otherwise `/login` just
	// redirects an authenticated visitor straight back to the dashboard.
	const anonymousContext = await browser.newContext(contextOptions);
	await anonymousContext.addInitScript(hardening);
	const anonymousPage = await anonymousContext.newPage();

	const uploaded = await seedDemoUploads(page);

	// Attach files to the album and tag them, so the detail views are not empty.
	const album = seed.albums[0];
	for (const file of uploaded.slice(0, 4)) {
		await api(`/file/${file.uuid}/album/${album.uuid}`, { method: 'POST' });
	}

	const { tags } = await api('/tags?page=1&limit=100');
	for (const [index, file] of uploaded.slice(0, 5).entries()) {
		const tag = tags[index % tags.length];
		if (tag) await api(`/file/${file.uuid}/tag/${tag.uuid}`, { method: 'POST' });
	}

	/** Waits until every <img> on the page has settled (loaded or errored). */
	const waitForImages = async target => {
		await target.evaluate(
			() =>
				new Promise(resolve => {
					const pending = [...document.images].filter(image => !image.complete);
					if (!pending.length) return resolve();
					let remaining = pending.length;
					const done = () => {
						remaining -= 1;
						if (remaining === 0) resolve();
					};

					for (const image of pending) {
						image.addEventListener('load', done, { once: true });
						image.addEventListener('error', done, { once: true });
					}

					setTimeout(resolve, 5000);
				})
		);
	};

	const shot = async (
		name,
		url,
		{ fullPage = false, waitFor, settle = 1200, target = page, base = BASE_URL } = {}
	) => {
		// `networkidle` is the nicest signal for these pages, but it can be slow or
		// never settle; falling back to `load` keeps the whole run moving.
		try {
			await target.goto(`${base}${url}`, { waitUntil: 'networkidle', timeout: 20_000 });
		} catch {
			await target.goto(`${base}${url}`, { waitUntil: 'load', timeout: 30_000 });
		}

		if (waitFor) {
			try {
				await target.waitForSelector(waitFor, { timeout: 15_000 });
			} catch {
				log(`warning: ${waitFor} did not appear on ${url}`);
			}
		}

		await waitForImages(target);
		await target.waitForTimeout(settle);
		await target.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage });
		log(`captured ${name}.png`);
	};

	log('capturing pages');
	await shot('home', '/', { fullPage: true, target: anonymousPage });
	await shot('login', '/login', { waitFor: 'input', target: anonymousPage });
	if (KEYCLOAK_URL) {
		// The button is the only interactive element on this variant, so it is what
		// we wait for instead of the account form's <input>.
		await shot('login-keycloak', '/login', {
			base: KEYCLOAK_URL,
			waitFor: 'a[href="/api/auth/keycloak/login"]',
			target: anonymousPage
		});
	} else {
		log('KEYCLOAK_URL not set, skipping the single sign-on login capture');
	}

	await shot('dashboard', '/dashboard', { waitFor: 'img' });
	await shot('albums', '/dashboard/albums');
	await shot('album', `/dashboard/albums/${album.uuid}`, { waitFor: 'img' });
	await shot('tags', '/dashboard/tags');
	await shot('snippets', '/dashboard/snippets');
	await shot('snippet', `/dashboard/snippets/${seed.snippets[0].uuid}`);
	await shot('public-album', `/a/${seed.albumIdentifier}`, { waitFor: 'img', target: anonymousPage });
	await shot('short-urls', '/dashboard/links');
	await shot('admin-settings', '/dashboard/admin/settings');
	await shot('admin-statistics', '/dashboard/admin/statistics', { fullPage: true });
	await shot('api-docs', '/docs', { target: anonymousPage });

	await browser.close();

	// The synthetic uploads only exist to be photographed.
	await rm(ASSET_DIR, { recursive: true, force: true });

	log('screenshots captured');
};

main().catch(error => {
	console.error(`[screenshots] failed: ${error.message}`);
	process.exitCode = 1;
});
