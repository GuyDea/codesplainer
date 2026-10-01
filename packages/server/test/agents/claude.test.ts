import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProcessTracker } from '../../src/agents/process';
import { createClaudeProvider } from '../../src/agents/providers/claude';
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
let fakes: FakeClis;
let provider: AgentProvider;
let project: string;
let other: string;

beforeAll(async () => {
  dir = await tempDir('cs-claude-');
  fakes = await writeFakeClis(dir);
  project = join(dir, 'proj');
  other = join(dir, 'other');
  await writeTree(project, { 'src/app.ts': 'export {}\n' });
  await writeTree(other, { 'x.ts': '' });
  provider = createClaudeProvider({
    dataDir: join(dir, 'data'),
    tracker: new ProcessTracker(),
    homeDir: join(dir, 'home'),
  });
  process.env.FAKE_RECORD = fakes.record;
});

afterEach(async () => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_FAST;
  await removeDir(fakes.record);
});

afterAll(async () => {
  delete process.env.FAKE_RECORD;
  await removeDir(dir);
});

function setup(
  patch: Parameters<typeof makeSettings>[0] = () => undefined,
  folders = [{ alias: 'proj', path: project }],
) {
  const settings = makeSettings((s) => {
    s.providers.claude.command = fakes.claude;
    patch(s);
  });
  const graph = makeEntry({ type: 'question' }, 'How does the app work?', { provider: 'claude' });
  return makeTask({ folders, graph, settings });
}

const runs = async () =>
  (await readRecord(fakes.record)).filter((r) => r.bin === 'claude' && r.stdin !== undefined);
const DELIVER = '\n\nSubmit the JSON object with the StructuredOutput tool.';

describe('claude provider', () => {
  it('detects the fake CLI with version, models and login state', async () => {
    const info = await provider.detect(setup().settings, { refresh: true });
    expect(info.available).toBe(true);
    expect(info.version).toBe('2.0.99');
    expect(info.command).toBe(fakes.claude);
    expect(info.models.map((m) => m.id)).toEqual(['default', 'sonnet', 'opus', 'haiku', 'fable']);
    expect(info.capabilities).toMatchObject({ fork: true, structuredOutput: true, cost: true });
    expect(info.warnings).toEqual([]);
  });

  it('reports a missing command', async () => {
    const info = await provider.detect(
      makeSettings((s) => (s.providers.claude.command = join(dir, 'missing'))),
      { refresh: true },
    );
    expect(info.available).toBe(false);
    expect(info.reason).toContain('not found');
  });

  it('runs with read-only flags, structured output, activity and usage', async () => {
    const task = setup(
      (s) => {
        s.providers.claude.effort = 'low';
      },
      [
        { alias: 'proj', path: project },
        { alias: 'other', path: other },
      ],
    );
    const activity: ActivityInput[] = [];
    const req = makeRequest(task, { activity, model: 'sonnet' });
    const res = await provider.run(req);
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);
    expect(res.session?.provider).toBe('claude');
    expect(res.usage).toMatchObject({
      costUsd: 0.0125,
      inputTokens: 1110,
      cachedTokens: 1000,
      outputTokens: 50,
      turns: 3,
      model: 'claude-test-model',
    });
    const [call] = await runs();
    const args = call?.args as string[];
    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    expect(args).toEqual(
      expect.arrayContaining([
        '--tools',
        'Read,Grep,Glob',
        '--permission-mode',
        'dontAsk',
        '--strict-mcp-config',
      ]),
    );
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
    expect(args[args.indexOf('--add-dir') + 1]).toBe(other);
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe(req.prompt.system);
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string)).toEqual(req.outputSchema);
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--settings');
    expect(res.warnings).toEqual([]);
    expect(call?.stdin).toBe(`${req.prompt.user}${DELIVER}`);
    expect(call?.cwd).toBe(project);
    const texts = activity.map((a) => a.text);
    expect(texts).toContain('Reading proj:src/app.ts');
    expect(texts).toContain('Searching “createServer” in proj:src');
    expect(
      activity.some((a) => a.kind === 'thinking' && a.text === 'Looking at the entry point'),
    ).toBe(true);
  });

  it("prefers the run's effort and fast mode over the provider settings", async () => {
    const task = setup((s) => {
      s.providers.claude.effort = 'low';
    });
    const res = await provider.run(makeRequest(task, { effort: 'max', fast: true }));
    const [call] = await runs();
    const args = call?.args as string[];
    expect(args[args.indexOf('--effort') + 1]).toBe('max');
    expect(JSON.parse(args[args.indexOf('--settings') + 1] as string)).toEqual({ fastMode: true });
    expect(res.warnings).toEqual([]);
  });

  it('warns when fast mode is off for the account', async () => {
    process.env.FAKE_FAST = 'off';
    const task = setup((s) => {
      s.providers.claude.fast = true;
    });
    const activity: ActivityInput[] = [];
    const res = await provider.run(makeRequest(task, { activity }));
    const warning =
      'Fast mode is off: it needs usage credits, which are turned off for this account. This run used standard speed.';
    expect(res.warnings).toEqual([warning]);
    expect(activity).toContainEqual({ kind: 'warning', text: warning });
  });

  it('forks the parent session and sends the compact prompt', async () => {
    const task = setup();
    const req = makeRequest(task, { forkSessionId: 'sess-parent' });
    const res = await provider.run(req);
    const [call] = await runs();
    const args = call?.args as string[];
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-parent');
    expect(args).toContain('--fork-session');
    expect(call?.stdin).toBe(`${req.prompt.followUp}${DELIVER}`);
    expect(res.session?.id).toBe(call?.sessionId);
    expect(res.session?.id).not.toBe('sess-parent');
  });

  it('falls back to a fresh session when the parent session is gone', async () => {
    process.env.FAKE_MODE = 'missing-session';
    const req = makeRequest(setup(), { forkSessionId: 'sess-gone' });
    const res = await provider.run(req);
    const calls = await runs();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).not.toContain('--resume');
    expect(calls[1]?.stdin).toBe(`${req.prompt.user}${DELIVER}`);
    expect(res.warnings.join(' ')).toMatch(/fresh/);
    expect(specOf(res.output).nodes.length).toBe(2);
  });

  it('runs one repair round in its own session', async () => {
    process.env.FAKE_MODE = 'invalid-then-ok';
    const res = await provider.run(makeRequest(setup()));
    const calls = await runs();
    expect(calls).toHaveLength(2);
    const second = calls[1]?.args as string[];
    expect(second[second.indexOf('--resume') + 1]).toBe(calls[0]?.sessionId);
    expect(second).not.toContain('--fork-session');
    expect(String(calls[1]?.stdin)).toContain('Your previous reply was invalid');
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);
    expect(res.warnings.join(' ')).toMatch(/asked for a fix/);
    expect(res.usage?.costUsd).toBeCloseTo(0.025);
  });

  it('parses fenced text when structured output is off', async () => {
    const task = setup((s) => (s.providers.claude.structuredOutput = false));
    const res = await provider.run(makeRequest(task));
    const [call] = await runs();
    expect(call?.args).not.toContain('--json-schema');
    expect(specOf(res.output).title).toBe(FAKE_DIAGRAM.title);
  });

  it('does not classify failures from the model text', async () => {
    process.env.FAKE_MODE = 'max-turns';
    const err = await provider.run(makeRequest(setup())).catch((e: unknown) => e);
    expect((err as AgentError).code).toBe('process');
    expect((err as AgentError).message).toMatch(/maximum number of turns/);
  });

  it('reports a missing workspace folder instead of a missing CLI', async () => {
    const task = setup(() => undefined, [{ alias: 'gone', path: join(dir, 'gone') }]);
    const err = await provider.run(makeRequest(task)).catch((e: unknown) => e);
    expect((err as AgentError).code).toBe('unavailable');
    expect((err as AgentError).message).toContain(
      `Workspace folder not found: ${join(dir, 'gone')}`,
    );
  });

  it('classifies auth errors and process crashes', async () => {
    process.env.FAKE_MODE = 'auth';
    const auth = await provider.run(makeRequest(setup())).catch((e: unknown) => e);
    expect(auth).toBeInstanceOf(AgentError);
    expect((auth as AgentError).code).toBe('auth');
    process.env.FAKE_MODE = 'crash';
    const crash = await provider.run(makeRequest(setup())).catch((e: unknown) => e);
    expect((crash as AgentError).code).toBe('process');
    expect((crash as AgentError).message).toContain('boom: something broke');
  });

  it('honours timeouts and cancellation', async () => {
    process.env.FAKE_MODE = 'hang';
    const timeout = await provider
      .run(makeRequest(setup(), { timeoutMs: 400 }))
      .catch((e: unknown) => e);
    expect((timeout as AgentError).code).toBe('timeout');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const cancelled = await provider
      .run(makeRequest(setup(), { signal: controller.signal }))
      .catch((e: unknown) => e);
    expect((cancelled as AgentError).code).toBe('cancelled');
  });
});
