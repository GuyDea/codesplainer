#!/usr/bin/env node
/**
 * Assembles the GitHub Pages site in site-dist/: the download page (site/) plus the graph
 * playground as a live demo under demo/. Run it through `npm run build:pages`, which builds the
 * playground first (`vite build --mode pages` in packages/web).
 */
import { access, cp, rename, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site-dist');
const DEMO = join(ROOT, 'packages', 'web', 'dist-pages');

try {
  await access(join(DEMO, 'playground.html'));
} catch {
  console.error(
    'packages/web/dist-pages/playground.html is missing. Run "npm run build:pages" (it builds the playground first).',
  );
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await cp(join(ROOT, 'site'), OUT, { recursive: true });
await cp(join(ROOT, 'packages', 'web', 'public', 'favicon.svg'), join(OUT, 'favicon.svg'));
await cp(DEMO, join(OUT, 'demo'), { recursive: true });
// Serve the demo at demo/ (its asset paths are relative, so the file can be renamed).
await rename(join(OUT, 'demo', 'playground.html'), join(OUT, 'demo', 'index.html'));
console.log(`Pages site ready in ${relative(process.cwd(), OUT) || '.'}/`);
