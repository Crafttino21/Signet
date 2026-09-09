import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// `obsidian` only exists inside the Obsidian app at runtime. Tests get a
			// hand-written stub instead — see src/test/obsidian.stub.ts.
			obsidian: path.resolve(import.meta.dirname, 'src/test/obsidian.stub.ts'),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
	},
});
