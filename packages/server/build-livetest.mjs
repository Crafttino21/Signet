import esbuild from 'esbuild';

/** Bundles the live test with the protocol package so it runs anywhere Node does. */
await esbuild.build({
	entryPoints: ['livetest.mjs'],
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	outfile: 'dist/livetest.js',
	logLevel: 'info',
});
