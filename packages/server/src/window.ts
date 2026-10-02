/**
 * The CLI's app window: starts Electron with the desktop package's window script
 * (packages/desktop/src/cli-window.ts), which shows the UI of this server in its own window. The
 * server stays in this process. Electron comes from the npm package's optional dependency, or
 * from the monorepo's node_modules; without it (or when it cannot start) the caller falls back to
 * the browser.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface AppWindow {
  /** Resolves when the window process has exited (the user closed the window, or close()). */
  closed: Promise<void>;
  close(): void;
}

export type AppWindowResult = { ok: true; window: AppWindow } | { ok: false; reason: string };

export interface AppWindowOptions {
  /** Path of the Electron binary (default: what the `electron` package resolves to). */
  resolveElectron?: () => string;
  /** Window script candidates; the first that exists is used. */
  scripts?: string[];
  platform?: NodeJS.Platform;
  /** Assume the window is open when it has not said "ready" by then (a slow first start). */
  readyTimeoutMs?: number;
  spawn?: typeof nodeSpawn;
}

/** Next to the bundle in the npm package; the desktop build in the monorepo. */
const DEFAULT_SCRIPTS = [
  fileURLToPath(new URL('./cli-window.js', import.meta.url)),
  fileURLToPath(new URL('../../desktop/dist/cli-window.js', import.meta.url)),
];

/** The `electron` package exports the path of its binary (and throws when it is missing). */
function defaultElectron(): string {
  const path: unknown = createRequire(import.meta.url)('electron');
  if (typeof path !== 'string') throw new Error('The electron package did not return a binary.');
  return path;
}

const lastLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);

type Launch =
  { status: 'ready'; window: AppWindow } | { status: 'failed'; reason: string; stderr: string };

/** Open the UI at `url` in an Electron window. Never throws. */
export async function openAppWindow(
  url: string,
  options: AppWindowOptions = {},
): Promise<AppWindowResult> {
  let electron: string;
  try {
    electron = (options.resolveElectron ?? defaultElectron)();
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
    return {
      ok: false,
      reason: missing
        ? 'Electron is not installed'
        : (lastLine(String((e as Error).message)) ?? 'Electron is unusable'),
    };
  }
  const script = (options.scripts ?? DEFAULT_SCRIPTS).find((p) => existsSync(p));
  if (!script) return { ok: false, reason: 'the window script is not built' };

  const spawn = options.spawn ?? nodeSpawn;
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  // Electron would run as plain Node with this set (e.g. when started from another Electron app).
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const launch = (extra: string[]) =>
    new Promise<Launch>((resolve) => {
      const child = spawn(electron, [script, `--url=${url}`, ...extra], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      let settled = false;
      const closed = new Promise<void>((done) => child.once('close', () => done()));
      const window: AppWindow = {
        closed,
        close: () => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        },
      };
      const settle = (result: Launch) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      // Chromium is chatty on stderr (GPU, fonts): keep only the start for error messages.
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 8_000) stderr += chunk.toString();
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('ready')) settle({ status: 'ready', window });
      });
      child.once('error', (e) => settle({ status: 'failed', reason: e.message, stderr }));
      child.once('close', (code, signal) =>
        settle({
          status: 'failed',
          reason: lastLine(stderr) ?? `Electron exited (${signal ?? `code ${code}`})`,
          stderr,
        }),
      );
      const timer = setTimeout(() => settle({ status: 'ready', window }), readyTimeoutMs);
    });

  const linux = (options.platform ?? process.platform) === 'linux';
  // Linux: the window class groups and names the taskbar entry (Electron's is "Electron").
  let result = await launch(linux ? ['--class=Codesplainer'] : []);
  if (result.status === 'failed' && linux && /sandbox/i.test(result.stderr)) {
    // Ubuntu 23.10+ blocks Chromium's sandbox for binaries outside the system (AppArmor), and
    // npm cannot install chrome-sandbox setuid root. The window only shows this local server's
    // UI and opens every other link in the browser.
    result = await launch(['--class=Codesplainer', '--no-sandbox']);
  }
  return result.status === 'ready'
    ? { ok: true, window: result.window }
    : { ok: false, reason: result.reason };
}
