import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAppWindow } from '../src/window';
import { removeDir, tempDir } from './support';

/**
 * Fake `electron` binaries: node scripts called as `<fake> <script> --url=<url> [--no-sandbox]`.
 * They record their arguments in FAKE_ARGS and behave according to their name.
 */
const FAKES: Record<string, string> = {
  // Opens the window, then runs until it is closed (killed) by the CLI.
  ok: `process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`,
  // The user closes the window right after it opened.
  closes: `process.stdout.write('ready\\n'); setTimeout(() => process.exit(0), 50);`,
  // Ubuntu 24.04+: Chromium's sandbox cannot start from node_modules without --no-sandbox.
  sandbox: `if (!process.argv.includes('--no-sandbox')) {
      process.stderr.write('[1:ERROR] The SUID sandbox helper binary was found, but is not configured correctly.\\n');
      process.exit(133);
    }
    process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`,
  crash: `process.stderr.write('libnss3.so: cannot open shared object file\\n'); process.exit(127);`,
  // Never says ready (slow machine): treated as open after the timeout.
  silent: `setInterval(() => {}, 1000);`,
};

let dir: string;
const fake = (name: string) => join(dir, name);
const argsOf = async (name: string): Promise<string[][]> =>
  (await readFile(join(dir, `${name}.args`), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);

beforeAll(async () => {
  dir = await tempDir('cs-window-');
  await writeFile(join(dir, 'cli-window.js'), '');
  for (const [name, body] of Object.entries(FAKES)) {
    const record = `require('fs').appendFileSync(${JSON.stringify(join(dir, `${name}.args`))}, JSON.stringify(process.argv.slice(2)) + '\\n');`;
    await writeFile(fake(name), `#!/usr/bin/env node\n${record}\n${body}\n`);
    await chmod(fake(name), 0o755);
  }
});

afterAll(async () => {
  await removeDir(dir);
});

const URL = 'http://127.0.0.1:4777/#/w/abc';
const open = (name: string, extra: Parameters<typeof openAppWindow>[1] = {}) =>
  openAppWindow(URL, {
    resolveElectron: () => fake(name),
    scripts: [join(dir, 'cli-window.js')],
    platform: 'linux',
    ...extra,
  });

describe('openAppWindow', () => {
  it('starts Electron with the window script and closes it on request', async () => {
    const result = await open('ok');
    if (!result.ok) throw new Error(result.reason);
    expect(await argsOf('ok')).toEqual([
      [join(dir, 'cli-window.js'), `--url=${URL}`, '--class=Codesplainer'],
    ]);
    result.window.close();
    await result.window.closed;
  });

  it('reports when the user closes the window', async () => {
    const result = await open('closes');
    if (!result.ok) throw new Error(result.reason);
    await result.window.closed;
  });

  it('retries without the Chromium sandbox on Linux when it cannot start', async () => {
    const result = await open('sandbox');
    if (!result.ok) throw new Error(result.reason);
    expect((await argsOf('sandbox')).map((a) => a.includes('--no-sandbox'))).toEqual([false, true]);
    result.window.close();
    await result.window.closed;
  });

  it('does not retry on other platforms or for other failures', async () => {
    const mac = await open('sandbox', {
      platform: 'darwin',
      resolveElectron: () => fake('sandbox'),
    });
    expect(mac).toMatchObject({ ok: false, reason: expect.stringContaining('SUID sandbox') });
    const crash = await open('crash');
    expect(crash).toEqual({ ok: false, reason: 'libnss3.so: cannot open shared object file' });
    expect(await argsOf('crash')).toHaveLength(1);
  });

  it('treats a window that never reports ready as open after the timeout', async () => {
    const result = await open('silent', { readyTimeoutMs: 300 });
    if (!result.ok) throw new Error(result.reason);
    result.window.close();
    await result.window.closed;
  });

  it('explains why there is no window', async () => {
    const missing = Object.assign(new Error("Cannot find module 'electron'"), {
      code: 'MODULE_NOT_FOUND',
    });
    expect(
      await open('ok', {
        resolveElectron: () => {
          throw missing;
        },
      }),
    ).toEqual({ ok: false, reason: 'Electron is not installed' });
    expect(
      await open('ok', {
        resolveElectron: () => {
          throw new Error(
            'Electron failed to install correctly, please delete node_modules/electron',
          );
        },
      }),
    ).toEqual({ ok: false, reason: 'Electron could not be downloaded' });
    expect(await open('ok', { scripts: [join(dir, 'missing.js')] })).toEqual({
      ok: false,
      reason: 'the window script is not built',
    });
    expect(await open('ok', { resolveElectron: () => join(dir, 'no-such-binary') })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('ENOENT'),
    });
  });
});
