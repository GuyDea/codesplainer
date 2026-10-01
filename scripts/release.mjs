/**
 * `npm run release-new [-- patch|minor|major|<x.y.z>]` (default: patch): bumps the version in
 * every package (`npm version`, see scripts/sync-version.mjs), commits, tags vX.Y.Z and pushes
 * both, which starts the release workflow. Only from a clean `main` that matches origin/main.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const bump = process.argv[2] ?? 'patch';
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const read = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  fail(`Unknown version "${bump}": use patch, minor, major or x.y.z.`);
}
if (read('git branch --show-current') !== 'main') fail('Release from the main branch.');
if (read('git status --porcelain')) fail('Commit or stash your changes first.');
run('git fetch --quiet origin main');
if (read('git rev-parse HEAD') !== read('git rev-parse origin/main')) {
  fail('main is not in sync with origin/main: pull or push first.');
}

run(`npm version ${bump} --message "Release %s"`);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
run(`git push --atomic origin main v${version}`);

console.log(`\n✓ Pushed v${version}. Follow the release in GitHub → Actions → Release.`);
