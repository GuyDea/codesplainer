import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProcessTracker } from '../../src/agents/process';
import { createCodexProvider, unwrapShell } from '../../src/agents/providers/codex';
import { AgentError, type ActivityInput, type AgentProvider } from '../../src/agents/types';
import { FAKE_DIAGRAM, readRecord, writeFakeClis, type FakeClis } from './fixtures';
import {
  makeEntry,
  makeRequest,
  makeSettings,
  makeTask,
  removeDir,
  specOf,
  tempDir,
  writeTree,
} from './helpers';

let dir: string;
let dataDir: string;
let fakes: FakeClis;
let project: string;

function newProvider(): AgentProvider {
  return createCodexProvider({
    dataDir,
    tracker: new ProcessTracker(),
    homeDir: join(dir, 'home'),
  });
}

beforeAll(async () => {
  dir = await tempDir('cs-codex-');
  dataDir = join(dir, 'data');
  fakes = await writeFakeClis(dir);
  project = join(dir, 'proj');
  await writeTree(project, { 'src/app.ts': 'export {}\n' });
  await writeTree(join(dir, 'home', '.codex'), {
    'config.toml':
      'model = "gpt-test"\nmodel_reasoning_effort = "high"\n[mcp_servers.jira]\ncommand = "x"\n',
    'models_cache.json': JSON.stringify({
      models: [
        {
          slug: 'gpt-test',
          display_name: 'GPT Test',
          description: 'Test model',
          visibility: 'list',
        },
        { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' },
      ],
    }),
  });
  process.env.FAKE_RECORD = fakes.record;
});

afterEach(async () => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_SANDBOX;
  await removeDir(fakes.record);
});

afterAll(async () => {
  delete process.env.FAKE_RECORD;
  await removeDir(dir);
});

function setup(patch: Parameters<typeof makeSettings>[0] = () => undefined) {
  const settings = makeSettings((s) => {
    s.providers.codex.command = fakes.codex;
    patch(s);
  });
  const graph = makeEntry({ type: 'question' }, 'How does the app work?', { provider: 'codex' });
  return makeTask({ folders: [{ alias: 'proj', path: project }], graph, settings });
}

const runs = async () =>
  (await readRecord(fakes.record)).filter((r) => r.bin === 'codex' && r.stdin !== undefined);

describe('codex provider', () => {
  it('strips shell wrappers from commands', () => {
    expect(unwrapShell("/bin/bash -lc 'rg -n foo src'")).toBe('rg -n foo src');
    expect(unwrapShell(['bash', '-lc', 'ls'])).toBe('ls');
    expect(unwrapShell('cat a.txt')).toBe('cat a.txt');
    expect(unwrapShell('/bin/bash -lc "for f in a b; do nl -ba \\"$f\\"; done\'')).toBe(
      'for f in a b; do nl -ba "$f"; done',
    );
  });

  it('detects version, models and the default model', async () => {
    const info = await newProvider().detect(setup().settings, { refresh: true });
    expect(info.available).toBe(true);
    expect(info.version).toBe('0.0.1-test');
    expect(info.models).toEqual([{ id: 'gpt-test', label: 'GPT Test', description: 'Test model' }]);
    expect(info.defaultModel).toBe('gpt-test');
    expect(info.warnings).toEqual([]);
  });

  it('is unavailable when the sandbox is broken unless unsafeNoSandbox is set', async () => {
    process.env.FAKE_SANDBOX = 'broken';
    const p = newProvider();
    const blocked = await p.detect(setup().settings, { refresh: true });
    expect(blocked.available).toBe(false);
    expect(blocked.reason).toContain('bubblewrap');
    expect(blocked.reason).toContain('Run without sandbox');
    const unsafe = setup((s) => (s.providers.codex.unsafeNoSandbox = true));
    const allowed = await p.detect(unsafe.settings, { refresh: false });
    expect(allowed.available).toBe(true);
    expect(allowed.warnings.join(' ')).toMatch(/instructed to stay read-only/);
    await p.run(makeRequest(unsafe));
    const [call] = await runs();
    const args = call?.args as string[];
    expect(args[args.indexOf('-s') + 1]).toBe('danger-full-access');
    const denied = await p.run(makeRequest(setup())).catch((e: unknown) => e);
    expect((denied as AgentError).code).toBe('unavailable');
  });

  it('does not block Codex when the sandbox probe only hits a usage error', async () => {
    process.env.FAKE_SANDBOX = 'usage';
    const info = await newProvider().detect(setup().settings, { refresh: true });
    expect(info.available).toBe(true);
    expect(info.reason).toBeUndefined();
  });

  it('runs codex exec read-only with schema, last-message file and activity', async () => {
    const task = setup((s) => (s.providers.codex.effort = 'low'));
    const activity: ActivityInput[] = [];
    const req = makeRequest(task, { activity, model: 'gpt-test' });
    const res = await newProvider().run(req);
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);
    const [call] = await runs();
    const args = call?.args as string[];
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check']);
    expect(args[args.indexOf('-s') + 1]).toBe('read-only');
    expect(args[args.indexOf('-C') + 1]).toBe(project);
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-test');
    expect(args).toContain('model_reasoning_effort="low"');
    expect(args).toContain('mcp_servers.jira.enabled=false');
    expect(args).not.toContain('mcp_servers.off.enabled=false');
    expect(args[args.length - 1]).toBe('-');
    expect(JSON.parse(String(call?.schema))).toEqual(req.outputSchema);
    expect(String(call?.stdin)).toContain('<instructions>');
    expect(String(call?.stdin)).toContain(req.prompt.user);
    expect(res.session).toEqual({ provider: 'codex', id: call?.threadId });
    expect(res.usage).toMatchObject({
      inputTokens: 200,
      cachedTokens: 120,
      outputTokens: 40,
      turns: 1,
      model: 'gpt-test',
    });
    expect(activity.map((a) => a.text)).toEqual(
      expect.arrayContaining(['Running rg -n createServer src', 'Mapping the modules']),
    );
    // Temp files are cleaned up.
    const tmp = await readdir(join(dataDir, 'tmp')).catch(() => []);
    expect(tmp.filter((n) => n.startsWith('codex-'))).toEqual([]);
  });

  it('forks with exec fork and repairs with exec resume', async () => {
    process.env.FAKE_MODE = 'invalid-then-ok';
    const req = makeRequest(setup(), { forkSessionId: 'thread-parent' });
    const res = await newProvider().run(req);
    const calls = await runs();
    expect(calls.map((c) => c.sub)).toEqual(['fork', 'resume']);
    const fork = calls[0]?.args as string[];
    expect(fork.slice(0, 2)).toEqual(['exec', 'fork']);
    expect(fork).toContain('sandbox_mode="read-only"');
    expect(fork.slice(-2)).toEqual(['thread-parent', '-']);
    expect(calls[0]?.stdin).toBe(req.prompt.followUp);
    expect(calls[1]?.session).toBe(calls[0]?.threadId);
    expect(String(calls[1]?.stdin)).toContain('Your previous reply was invalid');
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);
    expect(res.session?.id).toBe(calls[0]?.threadId);
  });

  it('starts fresh when the parent thread is gone', async () => {
    process.env.FAKE_MODE = 'missing-session';
    const res = await newProvider().run(makeRequest(setup(), { forkSessionId: 'thread-gone' }));
    const calls = await runs();
    expect(calls.map((c) => c.sub)).toEqual(['fork', 'exec']);
    expect(res.warnings.join(' ')).toMatch(/fresh/);
  });

  it('classifies failures', async () => {
    process.env.FAKE_MODE = 'auth';
    const err = await newProvider()
      .run(makeRequest(setup()))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('auth');
    process.env.FAKE_MODE = 'hang';
    const timeout = await newProvider()
      .run(makeRequest(setup(), { timeoutMs: 400 }))
      .catch((e: unknown) => e);
    expect((timeout as AgentError).code).toBe('timeout');
  });
});
