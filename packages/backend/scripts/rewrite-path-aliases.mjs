#!/usr/bin/env node
/**
 * Rewrites the path aliases defined in `tsconfig.json#paths` (`@/*` and `~/*`, both
 * mapped to `src/*`) into relative specifiers, because `tsc` copies the alias
 * specifiers verbatim into `dist/`.
 *
 * This replaces two dependencies:
 *
 * - `tsc-alias` (a build step), and
 * - `tsconfig-paths/register` (loaded at runtime with `node -r`), which only hooks
 *   the CommonJS `Module._resolveFilename`; the ESM loader ignores it, so it never
 *   resolved an alias for this ESM package.
 *
 * Rewriting at build time keeps `node dist/main.js` free of loaders. Aliases that
 * do not map to an emitted file fail the build instead of breaking at runtime.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist', import.meta.url));

/**
 * Alias specifiers are only recognized where they are actually imported from, the
 * same places `tsc-alias` rewrites: `from '@/x.js'`, `import '@/x.js'`,
 * `import('@/x.js')` and `require('@/x.js')`.
 */
const aliasSpecifier = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([~@]\/[^'"]*)\2/g;

const collectFiles = async directory => {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async entry => {
			const entryPath = path.join(directory, entry.name);
			return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
		})
	);

	return nested.flat();
};

const toPosix = value => value.split(path.sep).join('/');

const rewriteAliases = async () => {
	const files = await collectFiles(distDirectory);
	// Every path `tsc` emitted, so each alias is proven to resolve to a real file.
	const emitted = new Set(files.map(file => toPosix(path.relative(distDirectory, file))));
	const failures = [];
	let rewritten = 0;
	let touched = 0;

	for (const file of files.filter(file => file.endsWith('.js'))) {
		const content = await readFile(file, 'utf8');
		if (!/['"][~@]\//.test(content)) {
			continue;
		}

		let count = 0;
		const output = content.replace(aliasSpecifier, (match, prefix, quote, specifier) => {
			// `tsc` mirrors `src/` into `dist/`, so `@/utils/File.js` is emitted as
			// `dist/utils/File.js`.
			const target = path.resolve(distDirectory, specifier.slice(2));
			const relativeToDist = toPosix(path.relative(distDirectory, target));
			if (!emitted.has(relativeToDist)) {
				failures.push(
					`${toPosix(path.relative(process.cwd(), file))}: ${specifier} -> ${relativeToDist} was not emitted`
				);
				return match;
			}

			count += 1;

			// Import specifiers keep the explicit `.js` extension: Node's ESM
			// resolver requires it.
			const relative = toPosix(path.relative(path.dirname(file), target));

			return `${prefix}${quote}${relative.startsWith('.') ? relative : `./${relative}`}${quote}`;
		});

		if (count === 0) {
			continue;
		}

		await writeFile(file, output, 'utf8');
		rewritten += count;
		touched += 1;
		console.log(`→ ${toPosix(path.relative(process.cwd(), file))} (${count})`);
	}

	if (failures.length > 0) {
		console.error(`\n${failures.length} path alias(es) could not be rewritten:`);
		for (const failure of failures) {
			console.error(`  ${failure}`);
		}

		process.exitCode = 1;
		return;
	}

	console.log(`Rewrote ${rewritten} path alias(es) in ${touched} file(s).`);
};

await rewriteAliases();
