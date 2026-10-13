import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
	build: {
		lib: {
			entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
			formats: ['es'],
			name: 'index',
			fileName: () => 'index.js'
		},
		outDir: 'lib'
	},
	plugins: [
		dts({
			insertTypesEntry: true
		})
	]
});
