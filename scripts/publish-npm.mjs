/**
 * `npm run publish:npm [-- <npm publish options>]`: publishes the `codesplainer` CLI to npm from
 * this machine, so npm can ask for your one-time password (or open the browser to log in).
 * Publishes the released version only: the tag v<version> must exist and the packages must not
 * have changed since. Builds npm-dist/ first (scripts/pack-npm.mjs).
 * Extra options go to `npm publish`, e.g. `-- --dry-run` or `-- --otp 123456`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const extra = process.argv.slice(2);
const dryRun = extra.includes('--dry-run');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });
const read = (cmd) => {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const tag = `v${version}`;

if (read('git status --porcelain')) fail('Commit or stash your changes first.');
if (!read(`git rev-parse --verify --quiet refs/tags/${tag}`)) {
  fail(
    `Tag ${tag} not found: release with \`npm run release-new\` first (or \`git fetch --tags\`).`,
  );
}
if (read(`git diff --name-only ${tag} HEAD -- packages package-lock.json`)) {
  fail(`The packages changed since ${tag}: check out ${tag} to publish that release.`);
}
if (read(`npm view codesplainer@${version} version`) === version) {
  fail(`codesplainer@${version} is already on npm.`);
}
if (!dryRun) {
  const user = read('npm whoami');
  if (!user) fail('Not logged in to npm: run `npm login` first.');
  console.log(`Publishing codesplainer@${version} as ${user}.`);
}

run('npm run pack:npm');
// The extra options are npm flags typed by the user, passed through as they are.
run(`npm publish --access public ${extra.join(' ')}`.trim(), `${root}npm-dist`);

if (!dryRun) {
  console.log(`\n✓ Published codesplainer@${version}. Try it: npx codesplainer@${version}`);
}
