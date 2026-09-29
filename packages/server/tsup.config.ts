import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const webDist = fileURLToPath(new URL('../web/dist', import.meta.url));
const publicDir = fileURLToPath(new URL('./dist/public', import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript sources, so it must be bundled in.
  noExternal: ['@codesplainer/shared'],
  banner: { js: '#!/usr/bin/env node' },
  async onSuccess() {
    // Ship the built web UI next to the server bundle so `node dist/index.js` is self-contained.
    if (existsSync(webDist)) {
      await rm(publicDir, { recursive: true, force: true });
      await cp(webDist, publicDir, { recursive: true });
    } else {
      console.warn(
        '[tsup] packages/web/dist not found - build the web package first to embed the UI.',
      );
    }
  },
});
