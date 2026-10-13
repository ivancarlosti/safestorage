import base from '../../eslint.config.mjs';

/**
 * Backend (Fastify, Node ESM) lint configuration.
 *
 * The Prisma client is generated into `src/generated` and `src/prisma/generated`
 * (both ignored in the shared base), so only hand-written sources are linted.
 */
export default [
	...base,
	{
		name: 'safestorage/backend',
		files: ['**/*.ts'],
		languageOptions: {
			// Type-aware linting: replaces the legacy `parserOptions.project` +
			// `import/resolver` typescript setup with the typescript-eslint project
			// service, which discovers the nearest tsconfig per file.
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
		}
	}
];
