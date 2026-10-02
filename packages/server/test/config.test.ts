import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PORT } from '@codesplainer/shared';
import { isLoopbackHost, resolveConfig, type ServerConfig } from '../src/config';
import { removeDir, tempDir } from './support';

const opts = { cwd: '/work/project', home: '/home/me', webDistCandidates: [] };

function run(argv: string[], env: NodeJS.ProcessEnv = {}): ServerConfig {
  const result = resolveConfig(argv, env, opts);
  if (result.action !== 'run') throw new Error(`expected run, got ${result.action}`);
  return result.config;
}

let dir: string;
beforeAll(async () => {
  dir = await tempDir('cs-config-');
});
afterAll(async () => {
  await removeDir(dir);
});

describe('resolveConfig', () => {
  it('uses sensible defaults', () => {
    const config = run([]);
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: DEFAULT_PORT,
      dataDir: '/home/me/.codesplainer',
      open: true,
      browser: false,
      folders: [],
      cwd: '/work/project',
      warnings: [],
    });
    expect(config.webDist).toBeUndefined();
  });

  it('parses flags and folder arguments', () => {
    const config = run([
      '.',
      '../other',
      '~/code/x',
      '--port',
      '5000',
      '--host=localhost',
      '--data-dir',
      '~/data',
      '--no-open',
    ]);
    expect(config.port).toBe(5000);
    expect(config.host).toBe('localhost');
    expect(config.dataDir).toBe('/home/me/data');
    expect(config.open).toBe(false);
    expect(run(['--browser']).browser).toBe(true);
    expect(config.folders).toEqual(['/work/project', '/work/other', '/home/me/code/x']);
    expect(run(['--port=0']).port).toBe(0);
    expect(run(['--', '--weird-folder']).folders).toEqual(['/work/project/--weird-folder']);
  });

  it('reads the environment, flags win', () => {
    const env = {
      CODESPLAINER_PORT: '4800',
      CODESPLAINER_HOST: '::1',
      CODESPLAINER_HOME: '/var/cs',
      CODESPLAINER_NO_OPEN: '1',
      CODESPLAINER_BROWSER: 'yes',
    };
    expect(run([], env)).toMatchObject({
      port: 4800,
      host: '::1',
      dataDir: '/var/cs',
      open: false,
      browser: true,
    });
    expect(run(['--port', '4900', '--data-dir', 'rel/data'], env)).toMatchObject({
      port: 4900,
      dataDir: '/work/project/rel/data',
    });
  });

  it('handles help, version and errors', () => {
    const help = resolveConfig(['--help'], {}, opts);
    expect(help.action).toBe('help');
    if (help.action === 'help') expect(help.text).toContain('--data-dir');
    expect(resolveConfig(['-v'], {}, opts).action).toBe('version');
    expect(resolveConfig(['--port', 'abc'], {}, opts)).toMatchObject({ action: 'error' });
    expect(resolveConfig(['--port', '70000'], {}, opts)).toMatchObject({ action: 'error' });
    expect(resolveConfig(['--port'], {}, opts)).toMatchObject({ action: 'error' });
    expect(resolveConfig(['--frobnicate'], {}, opts)).toMatchObject({ action: 'error' });
    expect(resolveConfig([], { CODESPLAINER_PORT: 'x' }, opts)).toMatchObject({ action: 'error' });
  });

  it('warns loudly about non-loopback hosts', () => {
    expect(run(['--host', '0.0.0.0']).warnings[0]).toMatch(/no login/);
    expect(run(['--host', '127.0.0.2']).warnings).toEqual([]);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('finds the built web UI', async () => {
    const ui = join(dir, 'public');
    await mkdir(ui, { recursive: true });
    await writeFile(join(ui, 'index.html'), '<!doctype html>');
    const found = resolveConfig([], {}, { ...opts, webDistCandidates: [join(dir, 'missing'), ui] });
    expect(found.action === 'run' && found.config.webDist).toBe(ui);
    const fromEnv = resolveConfig([], { CODESPLAINER_WEB_DIST: ui }, opts);
    expect(fromEnv.action === 'run' && fromEnv.config.webDist).toBe(ui);
    const missing = resolveConfig([], { CODESPLAINER_WEB_DIST: join(dir, 'nope') }, opts);
    expect(missing.action === 'run' && missing.config.webDist).toBeUndefined();
  });
});
