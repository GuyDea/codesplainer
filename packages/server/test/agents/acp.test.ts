import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProcessTracker } from '../../src/agents/process';
import { createAcpProvider } from '../../src/agents/providers/acp';
import { createKiroProvider, KIRO_AGENT_NAME } from '../../src/agents/providers/kiro';
import type { ActivityInput, AgentError, AgentProvider } from '../../src/agents/types';
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
let tracker: ProcessTracker;
let kiro: AgentProvider;
let acp: AgentProvider;

beforeAll(async () => {
  dir = await tempDir('cs-acp-');
  dataDir = join(dir, 'data');
  fakes = await writeFakeClis(dir);
  project = join(dir, 'proj');
  await writeTree(project, { 'src/app.ts': 'export {}\n' });
  tracker = new ProcessTracker();
  const ctx = { dataDir, tracker, homeDir: join(dir, 'home') };
  kiro = createKiroProvider(ctx);
  acp = createAcpProvider(ctx);
  process.env.FAKE_RECORD = fakes.record;
});

afterEach(async () => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_PERMISSION_KIND;
  await removeDir(fakes.record);
});

afterAll(async () => {
  delete process.env.FAKE_RECORD;
  await removeDir(dir);
});

function setup(
  provider: 'kiro' | 'acp',
  patch: Parameters<typeof makeSettings>[0] = () => undefined,
) {
  const settings = makeSettings((s) => {
    s.providers.kiro.command = fakes.acp;
    s.acp.command = fakes.acp;
    s.acp.args = ['acp'];
    s.acp.name = 'Fake ACP';
    patch(s);
  });
  const graph = makeEntry({ type: 'question' }, 'How does the app work?', { provider });
  return makeTask({ folders: [{ alias: 'proj', path: project }], graph, settings });
}

const events = async (name: string) =>
  (await readRecord(fakes.record)).filter((r) => r.event === name);

describe('kiro provider (fake ACP agent)', () => {
  it('writes the read-only agent and spawns kiro-cli acp in its agent home', async () => {
    const activity: ActivityInput[] = [];
    const task = setup('kiro');
    const req = makeRequest(task, { activity, model: 'm-fast' });
    const res = await kiro.run(req);
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);

    const agent = JSON.parse(
      await readFile(
        join(dataDir, 'kiro-home', '.kiro', 'agents', `${KIRO_AGENT_NAME}.json`),
        'utf8',
      ),
    );
    expect(agent).toMatchObject({
      name: 'codesplainer',
      prompt: req.prompt.system,
      tools: ['read', 'grep', 'glob'],
      allowedTools: ['read', 'grep', 'glob'],
      mcpServers: {},
      includeMcpJson: false,
    });

    const [start] = await events('start');
    expect(start?.args).toEqual(['acp', '--agent', 'codesplainer', '--model', 'm-fast']);
    expect(start?.cwd).toBe(join(dataDir, 'kiro-home'));
    const [session] = await events('session/new');
    expect(session?.params).toEqual({ cwd: project, mcpServers: [] });
    const [init] = await events('initialize');
    expect(init?.params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const [prompt] = await events('prompt');
    expect(prompt?.text).toBe(req.prompt.user);

    // The edit permission was rejected, fs/* answered with -32601.
    const [perm] = await events('permission');
    expect(perm?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    const [fsCall] = await events('fs');
    expect((fsCall?.error as { code: number }).code).toBe(-32601);

    const texts = activity.map((a) => a.text);
    expect(texts).toContain('Reading src/app.ts');
    expect(texts).toContain('Let me read the entry point.');
    expect(activity.some((a) => a.kind === 'thinking' && a.text === 'Planning the diagram')).toBe(
      true,
    );
    expect(
      activity.some(
        (a) => a.kind === 'warning' && a.text.includes('Blocked edit request: Touch src/app.ts'),
      ),
    ).toBe(true);
    expect(res.usage?.model).toBe('m-default');
    expect(res.session).toBeUndefined();
  });

  it('lists models during detection and caches them', async () => {
    const info = await kiro.detect(setup('kiro').settings, { refresh: true });
    expect(info.available).toBe(true);
    expect(info.version).toBe('9.9.9');
    expect(info.models).toEqual([
      { id: 'm-default', label: 'Default', description: 'The default' },
      { id: 'm-fast', label: 'Fast' },
    ]);
    expect(info.defaultModel).toBe('m-default');
    const before = (await events('session/new')).length;
    await kiro.detect(setup('kiro').settings, { refresh: false });
    expect((await events('session/new')).length).toBe(before);
  });

  it('reports a missing login as unavailable', async () => {
    process.env.FAKE_MODE = 'auth';
    const info = await kiro.detect(setup('kiro').settings, { refresh: true });
    expect(info.available).toBe(false);
    expect(info.reason).toMatch(/kiro-cli login/);
    const err = await kiro.run(makeRequest(setup('kiro'))).catch((e: unknown) => e);
    expect((err as AgentError).code).toBe('auth');
    expect((err as AgentError).message).toContain('Run fake-cli login first.');
  });

  it('asks for one repair when the answer has no JSON', async () => {
    process.env.FAKE_MODE = 'prose';
    const res = await kiro.run(makeRequest(setup('kiro')));
    const prompts = await events('prompt');
    expect(prompts).toHaveLength(2);
    expect(String(prompts[1]?.text)).toContain('Your previous reply was invalid');
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);
  });

  it('cancels a running prompt', async () => {
    process.env.FAKE_MODE = 'hang';
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const err = await kiro
      .run(makeRequest(setup('kiro'), { signal: controller.signal }))
      .catch((e: unknown) => e);
    expect((err as AgentError).code).toBe('cancelled');
    expect(await events('cancel')).toHaveLength(1);
    expect(tracker.size).toBe(0);
  });

  it('times out a hanging agent', async () => {
    process.env.FAKE_MODE = 'hang';
    const err = await kiro
      .run(makeRequest(setup('kiro'), { timeoutMs: 600 }))
      .catch((e: unknown) => e);
    expect((err as AgentError).code).toBe('timeout');
  });
});

describe('generic ACP provider', () => {
  it('needs a command', async () => {
    const info = await acp.detect(makeSettings(), { refresh: true });
    expect(info.available).toBe(false);
    expect(info.reason).toMatch(/No command configured/);
    expect(info.experimental).toBe(true);
  });

  it('detects agent info and models via the handshake', async () => {
    const info = await acp.detect(setup('acp').settings, { refresh: true });
    expect(info).toMatchObject({
      available: true,
      name: 'Fake ACP',
      version: '1.2.3',
      defaultModel: 'm-default',
    });
    expect(info.description).toContain('Fake Agent');
    expect(info.models.map((m) => m.id)).toEqual(['m-default', 'm-fast']);
  });

  it('prepends the instructions, switches the model and rejects edits', async () => {
    const req = makeRequest(setup('acp'), { model: 'm-fast' });
    const res = await acp.run(req);
    expect(specOf(res.output).nodes).toHaveLength(2);
    const [start] = await events('start');
    expect(start?.args).toEqual(['acp']);
    // Spawned outside the workspace (repo-shipped agent config is not loaded); workspace via session/new.
    expect(start?.cwd).toBe(join(dataDir, 'acp-home'));
    expect((await events('session/new'))[0]?.params).toEqual({ cwd: project, mcpServers: [] });
    const [prompt] = await events('prompt');
    expect(String(prompt?.text)).toMatch(/^<instructions>\n/);
    expect(String(prompt?.text)).toContain(req.prompt.user);
    const [setModel] = await events('set_model');
    expect(setModel?.params).toEqual({ sessionId: 's1', modelId: 'm-fast' });
    expect(res.usage?.model).toBe('m-fast');
    const [perm] = await events('permission');
    expect(perm?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });

  it('uses the kind announced earlier when a permission request omits it', async () => {
    process.env.FAKE_PERMISSION_KIND = 'none';
    await acp.run(makeRequest(setup('acp')));
    expect((await events('permission'))[0]?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'yes' },
    });
  });

  it('fails clearly when the workspace folder is missing', async () => {
    const task = setup('acp');
    task.workspace.folders = [{ alias: 'gone', path: join(dir, 'gone') }];
    const err = await acp.run(makeRequest(task)).catch((e: unknown) => e);
    expect((err as AgentError).code).toBe('unavailable');
    expect((err as AgentError).message).toContain('Workspace folder not found');
  });

  it('approves execute only when allowed', async () => {
    process.env.FAKE_PERMISSION_KIND = 'execute';
    await acp.run(makeRequest(setup('acp')));
    expect((await events('permission'))[0]?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'no' },
    });
    await removeDir(fakes.record);
    await acp.run(makeRequest(setup('acp', (s) => (s.acp.allowExecute = true))));
    expect((await events('permission'))[0]?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'yes' },
    });
  });
});
