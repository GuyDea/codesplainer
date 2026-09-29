import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  codexPlatformDir,
  compareVersions,
  findOnPath,
  listCandidates,
  locateBinary,
  parseVersion,
  type BinarySpec,
} from '../../src/agents/detect';
import { removeDir, tempDir } from './helpers';

const isWindows = process.platform === 'win32';

async function fakeBinary(p: string, version: string): Promise<void> {
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, `#!/usr/bin/env node\nconsole.log('${version} (Fake)');\n`, 'utf8');
  await chmod(p, 0o755);
}

let root: string;
beforeAll(async () => {
  root = await tempDir('cs-detect-');
});
afterAll(async () => {
  await removeDir(root);
});

describe('versions', () => {
  it('parses version strings from CLI output', () => {
    expect(parseVersion('2.1.284 (Claude Code)')).toBe('2.1.284');
    expect(parseVersion('codex-cli 0.155.0-alpha.16.3')).toBe('0.155.0-alpha.16.3');
    expect(parseVersion('kiro-cli 1.27.1')).toBe('1.27.1');
    expect(parseVersion('v10.2.0')).toBe('10.2.0');
    expect(parseVersion('no version')).toBeUndefined();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('2.1.284', '2.1.28')).toBeGreaterThan(0);
    expect(compareVersions('26.917.62051', '26.917.61114')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('maps the codex platform folder', () => {
    expect(codexPlatformDir('linux', 'x64')).toBe('linux-x86_64');
    expect(codexPlatformDir('darwin', 'arm64')).toBe('macos-aarch64');
    expect(codexPlatformDir('win32', 'x64')).toBe('windows-x86_64');
  });
});

describe.skipIf(isWindows)('locating binaries', () => {
  it('finds commands on PATH', async () => {
    const bin = join(root, 'pathbin');
    await fakeBinary(join(bin, 'mycli'), '1.0.0');
    const env = { PATH: `${bin}:/nonexistent` };
    expect(await findOnPath('mycli', env)).toBe(join(bin, 'mycli'));
    expect(await findOnPath('othercli', env)).toBeUndefined();
  });

  it('picks the newest extension-bundled binary', async () => {
    const home = join(root, 'home');
    const ext = join(home, '.vscode', 'extensions');
    for (const v of ['2.1.9', '2.1.10', '2.1.2']) {
      await fakeBinary(
        join(ext, `anthropic.claude-code-${v}-linux-x64`, 'resources', 'native-binary', 'claude'),
        v,
      );
    }
    // A folder without the binary is skipped.
    await mkdir(join(ext, 'anthropic.claude-code-9.9.9-linux-x64'), { recursive: true });
    const spec: BinarySpec = {
      names: ['claude'],
      extensions: [
        {
          prefix: 'anthropic.claude-code-',
          binaries: [join('resources', 'native-binary', 'claude')],
        },
      ],
    };
    const env = { PATH: join(root, 'empty') };
    const candidates = await listCandidates(spec, { homeDir: home, env });
    expect(candidates.map((c) => c.dirVersion)).toEqual(['2.1.10', '2.1.9', '2.1.2']);
    const located = await locateBinary(spec, { homeDir: home, env, refresh: true });
    expect(located.ok && located.binary.version).toBe('2.1.10');
    expect(located.ok && located.binary.source).toBe('extension');
  });

  it('prefers PATH and honours an explicit override', async () => {
    const home = join(root, 'home2');
    const bin = join(root, 'bin2');
    await fakeBinary(join(bin, 'tool'), '3.0.0');
    await fakeBinary(join(home, '.local', 'bin', 'tool'), '1.0.0');
    const spec: BinarySpec = { names: ['tool'] };
    const env = { PATH: bin };
    const fromPath = await locateBinary(spec, { homeDir: home, env, refresh: true });
    expect(fromPath.ok && fromPath.binary).toMatchObject({
      path: join(bin, 'tool'),
      source: 'path',
      version: '3.0.0',
    });
    const known = await locateBinary(spec, {
      homeDir: home,
      env: { PATH: join(root, 'empty') },
      refresh: true,
    });
    expect(known.ok && known.binary.source).toBe('known');
    const custom = join(root, 'custom', 'my-tool');
    await fakeBinary(custom, '4.5.6');
    const overridden = await locateBinary(spec, {
      homeDir: home,
      env,
      override: custom,
      refresh: true,
    });
    expect(overridden.ok && overridden.binary).toMatchObject({
      path: custom,
      source: 'setting',
      version: '4.5.6',
    });
    const missing = await locateBinary(spec, {
      homeDir: home,
      env,
      override: join(root, 'nope'),
      refresh: true,
    });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.reason).toContain('not found');
  });
});
