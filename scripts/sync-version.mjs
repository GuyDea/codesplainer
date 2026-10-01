/**
 * The root package.json version is the app version. This copies it to the workspace packages,
 * package-lock.json and APP_VERSION (packages/shared/src/version.ts). It runs as the root
 * `version` script, so `npm version <x.y.z>` bumps everything in one commit and tag.
 * `--check` only reports what is out of sync (exit code 1), for CI.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');

const { version, workspaces } = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const stale = [];

/** Rewrites `file` with `update(text)` when it differs; in check mode only records it. */
async function sync(file, update) {
  const before = await readFile(`${root}${file}`, 'utf8');
  const after = update(before);
  if (after === before) return;
  stale.push(file);
  if (!check) await writeFile(`${root}${file}`, after);
}

// Replace only the top-level "version" line so the manifests keep their formatting.
const setManifestVersion = (text) =>
  text.replace(/^( {2}"version": )"[^"]*"/m, `$1${JSON.stringify(version)}`);

for (const dir of workspaces) await sync(`${dir}/package.json`, setManifestVersion);

await sync('package-lock.json', (text) => {
  const lock = JSON.parse(text);
  lock.version = version;
  for (const path of ['', ...workspaces]) lock.packages[path].version = version;
  return `${JSON.stringify(lock, null, 2)}\n`;
});

await sync('packages/shared/src/version.ts', (text) =>
  text.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${version}'`),
);

if (check && stale.length > 0) {
  console.error(`Not at version ${version} (the root package.json): ${stale.join(', ')}.`);
  console.error('Run `node scripts/sync-version.mjs`, or release with `npm version <x.y.z>`.');
  process.exit(1);
}
if (!check) {
  console.log(
    stale.length > 0 ? `Set ${version} in ${stale.join(', ')}.` : `All at version ${version}.`,
  );
}
