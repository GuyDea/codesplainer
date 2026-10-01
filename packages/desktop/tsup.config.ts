import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const webDist = fileURLToPath(new URL('../web/dist', import.meta.url));
const publicDir = fileURLToPath(new URL('./dist/public', import.meta.url));

/**
 * One self-contained ESM bundle for the Electron main process: the server, the shared package and
 * all their npm dependencies are bundled in, so the packaged app needs no node_modules. Only
 * `electron` stays external (it is provided by the runtime).
 */
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // __dirname / __filename for bundled CommonJS dependencies.
  shims: true,
  noExternal: [/^(?!electron$)/],
  external: ['electron'],
  // Bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __csCreateRequire } from 'node:module';\nconst require = __csCreateRequire(import.meta.url);",
  },
  async onSuccess() {
    // The server serves the UI from ./public next to the bundle (see server/src/config.ts).
    if (!existsSync(webDist)) {
      throw new Error(
        'packages/web/dist not found: build the web UI first (npm run build -w @codesplainer/web).',
      );
    }
    await rm(publicDir, { recursive: true, force: true });
    await cp(webDist, publicDir, { recursive: true });
  },
});
