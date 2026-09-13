import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

/**
 * Sets one version number in the three places that have to agree.
 *
 * `manifest.json` is what Obsidian reads, `versions.json` is what the community
 * registry reads to decide which build to offer an older app, and
 * `package.json` is what anybody looking at the repository reads. They drifted:
 * the manifest reached 0.3.0 while `package.json` still said 0.1.0, because
 * nothing kept them together.
 *
 * It also refuses a release that has nothing to say for itself. `CHANGELOG` in
 * `src/core/release.ts` is what the plugin shows on the first start after an
 * update, and a version missing from it updates people in silence — which is the
 * failure this whole feature exists to end. Add the entry first.
 *
 *   node version-bump.mjs 0.4.0
 *
 * Whether the version needs a newer Obsidian is a separate decision, so
 * `minAppVersion` is carried over from the manifest rather than invented here.
 * Change it there first if a release needs one.
 */

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	fail(`Usage: node version-bump.mjs <major.minor.patch>\nGot: ${version ?? '(nothing)'}`);
}

const manifest = readJson('manifest.json');
const versions = readJson('versions.json');
const pkg = readJson('package.json');

if (versions[version] !== undefined && manifest.version !== version) {
	fail(`${version} has been released before. Pick a number that has not.`);
}

const changelog = readFileSync('src/core/release.ts', 'utf8');
if (!changelog.includes(`version: '${version}'`)) {
	fail(
		`CHANGELOG in src/core/release.ts has no entry for ${version}.\n` +
			'Add one before releasing: it is what the plugin shows people after they update.'
	);
}

const { minAppVersion } = manifest;
if (typeof minAppVersion !== 'string') {
	fail('manifest.json has no minAppVersion.');
}

manifest.version = version;
versions[version] = minAppVersion;
pkg.version = version;

writeJson('manifest.json', manifest);
writeJson('versions.json', versions);
writeJson('package.json', pkg);

console.log(`Set to ${version} (needs Obsidian ${minAppVersion}).`);

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/** Tabs and a trailing newline, which is how these three files are already written. */
function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function fail(message) {
	console.error(message);
	process.exit(1);
}
