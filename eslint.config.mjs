import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import importX from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import promise from 'eslint-plugin-promise';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat-config base for every workspace.
 *
 * ESLint resolves exactly one config file per run (the closest `eslint.config.*`
 * to the files being linted, walking up from the current directory), so each
 * workspace imports this array and appends its own layers:
 * `packages/backend/eslint.config.mjs` and `packages/next/eslint.config.mjs`.
 *
 * This replaces the `eslint-config-neon` preset chain (`neon/common`,
 * `neon/browser`, `neon/node`, `neon/typescript`, `neon/prettier`, plus
 * `neon/react`/`neon/next`/`neon/edge` in the frontend) and the Next.js ESLint
 * plugin; both pulled `braces` into the dependency tree. The rule set below is
 * calibrated against the resolved legacy config (413 backend / 481 frontend
 * rules, dumped with `eslint --print-config` on the neon chain): every `off`
 * below is a rule the legacy preset also had disabled, or a rule that newer
 * plugin versions turned on/sharpen and the current code does not satisfy.
 *
 * See plans/2026-10-13-eslint-9-flat-config-and-tailwind-4.md.
 */
export default [
	{
		name: 'safestorage/ignores',
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/lib/**',
			'**/.next/**',
			'**/.turbo/**',
			'**/src/generated/**',
			'**/coverage/**'
		]
	},
	{
		name: 'safestorage/language-options',
		files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			// The backend runs on Node, the frontend renders in the browser and on
			// the Node server; both sets are declared exactly like the legacy
			// `neon/browser` + `neon/node` presets did.
			globals: { ...globals.browser, ...globals.node }
		},
		// Unused `eslint-disable` comments mean the rule they silence is either
		// gone or was never enabled: fail instead of leaving dead suppressions
		// behind (`eslint --fix --fix-type directive` removes them).
		linterOptions: { reportUnusedDisableDirectives: 'error' }
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	n.configs['flat/recommended-module'],
	promise.configs['flat/recommended'],
	unicorn.configs.recommended,
	{
		name: 'safestorage/import-x',
		plugins: { 'import-x': importX },
		// Only the import rules the legacy `import/*` set enforced. `no-unresolved`,
		// `no-cycle`, `named`, `default`, `namespace` and `no-extraneous-dependencies`
		// were all disabled, so the plugin runs without a resolver (and without
		// that dependency tree).
		rules: {
			'import-x/first': 'error',
			'import-x/no-absolute-path': 'error',
			'import-x/no-duplicates': 'error',
			'import-x/no-mutable-exports': 'error',
			'import-x/no-self-import': 'error',
			'import-x/no-useless-path-segments': 'error',
			// Import order is enforced on the backend (`newlines-between: never`,
			// alphabetical, grouped) and deliberately off in the frontend, which
			// does not enforce import order. Options copied from the resolved
			// legacy config.
			'import-x/order': [
				'error',
				{
					alphabetize: { caseInsensitive: false, order: 'asc', orderImportKind: 'ignore' },
					distinctGroup: true,
					groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
					'newlines-between': 'never',
					// `@/` and `~/` resolve through tsconfig `paths`, so they are mapped
					// onto the `internal` group explicitly: after npm packages and
					// before relative imports, which is how every file here is written.
					// (Without this, import-x sorts unresolvable bare specifiers after
					// relative imports because it does not locate them on disk.)
					pathGroups: [
						{ pattern: '@/**', group: 'internal', position: 'before' },
						{ pattern: '~/**', group: 'internal', position: 'before' }
					],
					pathGroupsExcludedImportTypes: ['builtin', 'object'],
					warnOnUnassignedImports: false
				}
			]
		}
	},
	{
		name: 'safestorage/rules',
		rules: {
			// ── Carried over verbatim from the legacy root `.eslintrc.json` ───────
			'id-length': 'off',
			'no-use-before-define': 'off',
			// TODO/FIXME markers are triaged in the issue tracker, not by lint.
			'no-warning-comments': 'off',
			'@typescript-eslint/consistent-type-assertions': 'off',
			'@typescript-eslint/consistent-type-definitions': 'off',
			'@typescript-eslint/no-use-before-define': 'off',
			// The `no-unsafe-*` family is noisy on the Prisma/zod JSON boundaries.
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			// 27 pre-existing `@ts-ignore`s predate the rule; convert separately.
			'@typescript-eslint/prefer-ts-expect-error': 'off',
			'unicorn/numeric-separators-style': 'off',
			'unicorn/prefer-math-trunc': 'off',

			// ── Kept at the legacy severity and options ──────────────────────────
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					minimumDescriptionLength: 3,
					'ts-check': true,
					'ts-expect-error': 'allow-with-description',
					'ts-ignore': false,
					'ts-nocheck': false
				}
			],
			'@typescript-eslint/no-misused-promises': ['error', { checksConditionals: true, checksVoidReturn: false }],
			'@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
			'@typescript-eslint/no-floating-promises': ['error', { ignoreIIFE: true, ignoreVoid: true }],
			'@typescript-eslint/promise-function-async': 'error',
			'no-empty': ['error', { allowEmptyCatch: true }],
			'eqeqeq': 'error',
			'guard-for-in': 'error',
			'n/no-sync': ['error', { allowAtRootLevel: true }],
			'no-alert': 'error',
			'no-negated-condition': 'error',
			'no-param-reassign': ['error', { props: false }],
			'prefer-named-capture-group': 'error',
			'promise/prefer-await-to-callbacks': 'error',
			'promise/prefer-await-to-then': 'error',
			'require-atomic-updates': 'error',

			// ── Disabled: newer plugin versions enable these, the legacy preset
			//    had them off and the current code does not satisfy them ─────────
			// Core rules (all off in the legacy preset):
			'no-await-in-loop': 'off',
			'no-bitwise': 'off',
			'no-mixed-operators': 'off',
			// Type-aware rules (~75 findings), all off in the legacy preset:
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-redundant-type-constituents': 'off',
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-wrapper-object-types': 'off',
			'@typescript-eslint/require-await': 'off',
			'@typescript-eslint/restrict-template-expressions': 'off',
			// Kept at `{ ignoreStatic: true }` in v7; v8 additionally reports 11
			// method references (react-hook-form handlers, `JWT.verify`) that were
			// accepted before.
			'@typescript-eslint/unbound-method': 'off',
			// Node rules (all off in the legacy preset). `no-missing-import` reports
			// every `@/` alias import and needs a resolver configured:
			'n/no-missing-import': 'off',
			'n/no-process-exit': 'off',
			'n/no-unsupported-features/node-builtins': 'off',
			'n/no-unpublished-import': 'off',
			// `promise/always-return` only ships with the plugin's recommended set.
			'promise/always-return': 'off',
			// unicorn: new in unicorn 66+/78 or disabled in the legacy preset, which
			// enabled a 99-rule subset of the 380-rule recommended set.
			'unicorn/explicit-length-check': 'off',
			'unicorn/filename-case': 'off',
			'unicorn/import-style': 'off',
			'unicorn/no-anonymous-default-export': 'off',
			'unicorn/no-array-callback-reference': 'off',
			'unicorn/no-array-sort': 'off',
			'unicorn/no-await-expression-member': 'off',
			'unicorn/no-negated-condition': 'off',
			'unicorn/no-null': 'off',
			'unicorn/no-process-exit': 'off',
			'unicorn/no-unnecessary-nested-ternary': 'off',
			'unicorn/no-useless-undefined': 'off',
			'unicorn/prefer-at': 'off',
			'unicorn/prefer-global-this': 'off',
			'unicorn/prefer-logical-operator-over-ternary': 'off',
			'unicorn/prefer-math-min-max': 'off',
			'unicorn/prefer-set-has': 'off',
			'unicorn/prefer-split-limit': 'off',
			'unicorn/prefer-string-raw': 'off',
			'unicorn/prefer-string-replace-all': 'off',
			'unicorn/prefer-top-level-await': 'off',
			'unicorn/prevent-abbreviations': 'off',
			'unicorn/switch-case-braces': 'off'
		}
	},
	prettier
];
