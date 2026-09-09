import esbuild from 'esbuild';

/**
 * Bundles the server into a single file so the container needs no node_modules.
 * The protocol package is source TypeScript shared with the plugin; bundling it
 * is what guarantees both sides speak the identical wire format.
 */
await esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	outfile: 'dist/server.js',
	banner: {
		js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
	},
	logLevel: 'info',
});
