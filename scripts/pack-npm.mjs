/**
 * Assembles the `codesplainer` npm package (the CLI, run with `npx codesplainer`) in npm-dist/.
 * Run `npm run build` first: the package is the server bundle with the web UI in dist/public.
 * The manifest is generated from packages/server/package.json, without the workspace-only
 * packages (@codesplainer/shared is bundled into dist/index.js by tsup).
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverDir = `${root}packages/server/`;
const outDir = `${root}npm-dist/`;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const rootPkg = await readJson(`${root}package.json`);
const serverPkg = await readJson(`${serverDir}package.json`);
const { version } = await readJson(`${root}packages/desktop/package.json`);

if (!existsSync(`${serverDir}dist/index.js`) || !existsSync(`${serverDir}dist/public/index.html`)) {
  console.error('packages/server/dist is missing or has no UI: run `npm run build` first.');
  process.exit(1);
}

const dependencies = Object.fromEntries(
  Object.entries(serverPkg.dependencies).filter(([name]) => !name.startsWith('@codesplainer/')),
);

const manifest = {
  name: 'codesplainer',
  version,
  description: rootPkg.description,
  keywords: ['codebase', 'diagrams', 'architecture', 'ai', 'claude-code', 'codex', 'kiro', 'acp'],
  homepage: 'https://guydea.github.io/codesplainer/',
  bugs: 'https://github.com/GuyDea/codesplainer/issues',
  repository: { type: 'git', url: 'git+https://github.com/GuyDea/codesplainer.git' },
  license: rootPkg.license,
  type: 'module',
  bin: { codesplainer: 'dist/index.js' },
  files: ['dist', '!**/*.map'],
  engines: rootPkg.engines,
  dependencies,
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(`${serverDir}dist`, `${outDir}dist`, { recursive: true });
await cp(`${root}README.md`, `${outDir}README.md`);
await writeFile(`${outDir}package.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`npm-dist/: codesplainer@${version}`);
