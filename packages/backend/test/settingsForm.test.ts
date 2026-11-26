import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
	The admin settings form validates with zod, and zod strips the keys that are
	not part of its schema. A setting that the API serves but the form schema does
	not declare therefore keeps its stored value on screen and is silently dropped
	when the form is submitted, so the change never reaches the database (that is
	how "Static Website Hosting" used to flip back to off after a reload).

	The settings themselves are declared in `structures/settings.ts` and the
	columns live on the `settings` table, so neither side can import the other
	without dragging Prisma (or React) into a unit test. The files are read as
	text instead, in the same spirit as the nginx assertions of the website tests.
*/
const settingsMetaPath = fileURLToPath(new URL('../src/structures/settings.ts', import.meta.url));
const settingsRoutePath = fileURLToPath(new URL('../src/routes/admin/service/Settings.ts', import.meta.url));
const settingsFormPath = fileURLToPath(new URL('../../next/src/components/forms/SettingsForm.tsx', import.meta.url));

// Returns the top level keys of an object literal that starts at `startMarker`.
const objectKeys = (source: string, startMarker: string, endMarker: string) => {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `could not find ${startMarker}`);

	const end = source.indexOf(endMarker, start);
	assert.notEqual(end, -1, `could not find the end of ${startMarker}`);

	const body = source.slice(start + startMarker.length, end);
	const keys = new Set<string>();
	// Keys of a nested object are indented one more level, so require a single tab.
	body.replace(/^\t(\w+)\s*:/gm, (_, key: string) => keys.add(key));

	return keys;
};

const servedSettingKeys = () => {
	const meta = readFileSync(settingsMetaPath, 'utf8');
	const route = readFileSync(settingsRoutePath, 'utf8');

	const keys = objectKeys(meta, 'const SETTINGS_META = {', '\n};');

	// `GetSettings` removes the settings that must not be edited from the panel.
	for (const [, key] of route.matchAll(/delete settings\.(\w+);/g)) keys.delete(key);

	return keys;
};

const formSchemaKeys = () => {
	const form = readFileSync(settingsFormPath, 'utf8');

	return objectKeys(form, 'const formSchema = z.object({', '\n});');
};

describe('admin settings form schema covers every editable setting', () => {
	const served = servedSettingKeys();
	const schema = formSchemaKeys();

	it('finds the settings of this instance', () => {
		assert.ok(served.has('serviceName'), 'the settings meta could not be read');
		assert.ok(schema.has('serviceName'), 'the settings form schema could not be read');
	});

	it('declares the static website hosting settings', () => {
		assert.ok(served.has('websiteHostingEnabled'));
		assert.ok(served.has('websiteHostingDomain'));
		assert.ok(schema.has('websiteHostingEnabled'));
		assert.ok(schema.has('websiteHostingDomain'));
	});

	it('declares every setting that the admin API returns', () => {
		const missing = [...served].filter(key => !schema.has(key));

		assert.deepEqual(missing, [], `these settings would never be saved: ${missing.join(', ')}`);
	});
});
