import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import base from '../../eslint.config.mjs';

/**
 * Frontend (Next.js App Router, React 19) lint configuration.
 *
 * `next lint` is not used: it is removed in Next.js 16 and it loaded
 * `@next/eslint-plugin-next` (and therefore `braces`) into the toolchain. The
 * `@next/next/*` rules were either disabled in the legacy config
 * (`no-img-element` was off) or are covered by TypeScript and the Next.js build.
 *
 * The legacy `packages/next/.eslintignore` (dist, .cache, public, node_modules,
 * *.esm.js) becomes the `ignores` below, because flat config has no separate
 * ignore file. `packages/next/.eslintrc.json` also extended `neon/jsx-a11y`, but
 * that config was never applied (`neon/jsx-a11y` was not in the `extends` list),
 * so no accessibility plugin is installed here.
 */
export default [
	...base,
	{
		name: 'safestorage/next/ignores',
		ignores: ['.cache/**', 'public/**', '*.esm.js']
	},
	{
		...react.configs.flat.recommended,
		name: 'safestorage/next/react',
		files: ['**/*.{jsx,tsx}'],
		// Carried over from the legacy `.eslintrc.json` `settings.react` block.
		settings: { react: { version: 'detect' } },
		rules: {
			...react.configs.flat.recommended.rules,
			// `dangerouslySetInnerHTML` renders shiki's highlighted markup; every
			// call site is audited and suppresses the rule.
			'react/no-danger': 'error',
			// Not part of eslint-plugin-react 7.37's `recommended` set anymore, but
			// it was enabled by the legacy preset and it caught a dead prop here.
			'react/no-unused-prop-types': 'error',
			// Off in the legacy preset (9 findings; the JSX uses raw apostrophes).
			'react/no-unescaped-entities': 'off',
			// Off in the legacy preset (3 anonymous `forwardRef` components).
			'react/display-name': 'off'
		}
	},
	{
		// React 17+ automatic JSX runtime: replaces `react/react-in-jsx-scope: 0`.
		...react.configs.flat['jsx-runtime'],
		name: 'safestorage/next/jsx-runtime',
		files: ['**/*.{jsx,tsx}']
	},
	{
		name: 'safestorage/next/react-hooks',
		files: ['**/*.{jsx,tsx}'],
		// eslint-plugin-react-hooks 7 ships eslintrc-shaped configs (a `plugins`
		// array), so the plugin and its rules are registered explicitly. Only the
		// two rules the legacy preset enforced are enabled; the React Compiler rule
		// set that ships with 7.x (`static-components`, `immutability`, `purity`,
		// …) needs its own adoption pass.
		plugins: { 'react-hooks': reactHooks },
		rules: {
			'react-hooks/exhaustive-deps': 'error',
			'react-hooks/rules-of-hooks': 'error'
		}
	},
	{
		name: 'safestorage/next',
		files: ['**/*.{js,mjs,jsx,ts,tsx}'],
		languageOptions: {
			// Type-aware linting through the typescript-eslint project service.
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
		},
		rules: {
			// The frontend does not enforce import order. The legacy config relied
			// on `@ianvs/prettier-plugin-sort-imports`, which is no longer
			// installed.
			'import-x/order': 'off',
			// `process.env.NEXT_PUBLIC_*` is inlined by the Next.js compiler, so it
			// must not be replaced by a `node:process` import.
			'n/prefer-global/process': 'off'
		}
	}
];
