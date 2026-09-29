import { chmod, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from '@codesplainer/shared';
import { createProviderRegistry } from '../../src/agents/registry';
import { AgentError, type ProviderRegistry } from '../../src/agents/types';
import { readRecord, writeFakeClis, type FakeClis } from './fixtures';
import {
  makeEntry,
  makeRequest,
  makeSettings,
  makeTask,
  removeDir,
  tempDir,
  writeTree,
} from './helpers';

let dir: string;
let dataDir: string;
let fakes: FakeClis;
let registry: ProviderRegistry;

beforeAll(async () => {
  process.env.CODESPLAINER_MOCK_DELAY_MS = '0';
  dir = await tempDir('cs-registry-');
  dataDir = join(dir, 'data');
  fakes = await writeFakeClis(dir);
  process.env.FAKE_RECORD = fakes.record;
  registry = createProviderRegistry({ dataDir, homeDir: join(dir, 'home') });
});

afterAll(async () => {
  await registry.dispose();
  delete process.env.FAKE_RECORD;
  delete process.env.FAKE_MODE;
  delete process.env.CODESPLAINER_MOCK_DELAY_MS;
  await removeDir(dir);
});

const settingsWithFakes = () =>
  makeSettings((s) => {
    s.providers.claude.command = fakes.claude;
    s.providers.codex.command = fakes.codex;
    s.providers.kiro.command = join(dir, 'no-kiro-here');
    s.providers.acp.enabled = false;
  });

const versionCalls = async () =>
  (await readRecord(fakes.record)).filter(
    (r) => r.bin === 'claude' && (r.args as string[])[0] === '--version',
  ).length;

describe('provider registry', () => {
  it('lists providers in order with settings applied', async () => {
    const list = await registry.list(settingsWithFakes());
    expect(list.map((p) => p.id)).toEqual([...PROVIDER_IDS]);
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    expect(byId.mock).toMatchObject({ available: true, enabled: true });
    expect(byId.claude).toMatchObject({ available: true, version: '2.0.99' });
    expect(byId.codex).toMatchObject({ available: true, version: '0.0.1-test' });
    expect(byId.kiro?.available).toBe(false);
    expect(byId.kiro?.reason).toContain('not found');
    expect(byId.acp).toMatchObject({ available: false, enabled: false });
  });

  it('caches detection until refresh or a relevant settings change', async () => {
    const settings = settingsWithFakes();
    await registry.list(settings);
    const before = await versionCalls();
    await registry.list(settings);
    await registry.info('claude', settings);
    expect(await versionCalls()).toBe(before);
    await registry.list(settings, { refresh: true });
    expect(await versionCalls()).toBe(before + 1);
    // Changing the command re-detects.
    const other = settingsWithFakes();
    other.providers.claude.command = join(dir, 'missing-claude');
    expect((await registry.info('claude', other)).available).toBe(false);
    // `enabled` is applied without re-detection side effects.
    other.providers.claude.enabled = false;
    expect((await registry.info('claude', other)).enabled).toBe(false);
  });

  it('runs smoke tests without throwing', async () => {
    const settings = settingsWithFakes();
    const mock = await registry.test('mock', settings);
    expect(mock).toMatchObject({ ok: true, provider: 'mock' });
    const claude = await registry.test('claude', settings);
    expect(claude.ok).toBe(true);
    expect(claude.message).toMatch(/Answered in/);
    const readme = await readFile(join(dataDir, 'scratch', 'README.md'), 'utf8');
    expect(readme).toContain('Scratch');
    const calls = (await readRecord(fakes.record)).filter(
      (r) => r.bin === 'claude' && r.stdin !== undefined,
    );
    const args = calls[calls.length - 1]?.args as string[];
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string)).toMatchObject({
      required: ['ok'],
    });
    const kiro = await registry.test('kiro', settings);
    expect(kiro.ok).toBe(false);
    expect(kiro.message).toContain('not found');
    process.env.FAKE_MODE = 'crash';
    const crashed = await registry.test('codex', settings);
    delete process.env.FAKE_MODE;
    expect(crashed.ok).toBe(false);
  });

  it('re-detects an unavailable provider when it is tested', async () => {
    const lateKiro = join(dir, 'late-kiro');
    const settings = settingsWithFakes();
    settings.providers.kiro.command = lateKiro;
    expect((await registry.info('kiro', settings)).available).toBe(false);
    // The user installs the CLI, then presses "Test".
    await copyFile(fakes.acp, lateKiro);
    await chmod(lateKiro, 0o755);
    const res = await registry.test('kiro', settings);
    expect(res).toMatchObject({ ok: true, provider: 'kiro' });
    expect((await registry.info('kiro', settings)).available).toBe(true);
  });

  it('dispose() kills running agents', async () => {
    const project = join(dir, 'proj');
    await writeTree(project, { 'a.ts': '' });
    const reg = createProviderRegistry({ dataDir, homeDir: join(dir, 'home') });
    const settings = settingsWithFakes();
    const graph = makeEntry({ type: 'question' }, 'Hang?', { provider: 'claude' });
    const task = makeTask({ folders: [{ alias: 'proj', path: project }], graph, settings });
    process.env.FAKE_MODE = 'hang';
    const running = reg.get('claude').run(makeRequest(task, { timeoutMs: 60_000 }));
    await new Promise((r) => setTimeout(r, 700));
    await reg.dispose();
    const err = await running.catch((e: unknown) => e);
    delete process.env.FAKE_MODE;
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('cancelled');
  });
});
