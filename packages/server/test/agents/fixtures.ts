/**
 * Fake agent CLIs, written at test time as executable node scripts. Behaviour is controlled by
 * environment variables (inherited from process.env): FAKE_RECORD (JSONL file receiving every
 * invocation), FAKE_MODE (ok | invalid-then-ok | auth | crash | hang | missing-session | prose),
 * FAKE_SANDBOX=broken (codex), FAKE_PERMISSION_KIND (acp, default "edit"), FAKE_FAST=off (claude:
 * fast mode requested but unavailable for the account).
 */
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FAKE_DIAGRAM = {
  title: 'Fake app',
  summary: 'The app writes to the database.',
  kind: 'architecture',
  direction: 'LR',
  nodes: [
    {
      id: 'app',
      label: 'App',
      kind: 'service',
      detail: 'Entry point',
      group: null,
      expandable: true,
      highlight: true,
      refs: [{ folder: 'proj', path: 'src/app.ts', startLine: null, endLine: null, symbol: null }],
    },
    {
      id: 'db',
      label: 'DB',
      kind: 'store',
      detail: '',
      group: null,
      expandable: false,
      highlight: false,
      refs: [],
    },
  ],
  edges: [{ from: 'app', to: 'db', label: 'writes', kind: 'write', step: null }],
  groups: [],
};

const COMMON = `
const fs = require('fs');
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';
const DIAGRAM = ${JSON.stringify(FAKE_DIAGRAM)};
const INVALID = { title: 'Broken', nodes: [] };
function record(obj) {
  if (process.env.FAKE_RECORD) fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ bin: BIN, ...obj }) + '\\n');
}
function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
function out(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
function rid() { return Math.random().toString(36).slice(2, 10); }
function readStdin(cb) { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => cb(s)); }
`;

const CLAUDE = `#!/usr/bin/env node
const BIN = 'claude';
${COMMON}
if (args[0] === '--version') { record({ args }); console.log('2.0.99 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { record({ args }); console.log(JSON.stringify({ loggedIn: !process.env.FAKE_LOGGED_OUT })); process.exit(0); }
// Strict flag parsing (value-taking flags consume the next argument, --add-dir is variadic).
const VALUE = ['--output-format', '--tools', '--permission-mode', '--model', '--effort', '--resume', '--append-system-prompt', '--append-system-prompt-file', '--json-schema', '--max-budget-usd', '--settings'];
const BOOL = ['-p', '--verbose', '--strict-mcp-config', '--fork-session'];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUE.includes(a)) { i++; continue; }
  if (BOOL.includes(a)) continue;
  if (a === '--add-dir') { while (args[i + 1] && !args[i + 1].startsWith('-')) i++; continue; }
  process.stderr.write('error: unknown option ' + a + '\\n');
  process.exit(2);
}
readStdin((stdin) => {
  const resume = flag('--resume');
  const fork = args.includes('--fork-session');
  const sessionId = resume && !fork ? resume : 'sess-' + rid();
  record({ args, stdin, cwd: process.cwd(), sessionId });
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'crash') { process.stderr.write('boom: something broke\\n'); process.exit(3); }
  if (mode === 'missing-session' && resume && fork) { process.stderr.write('No conversation found with session ID: ' + resume + '\\n'); process.exit(1); }
  out({ type: 'system', subtype: 'hook_started' });
  const fastRequested = JSON.parse(flag('--settings') || '{}').fastMode === true;
  const fast = fastRequested && process.env.FAKE_FAST !== 'off'
    ? { fast_mode_state: 'on' }
    : { fast_mode_state: 'off', fast_mode_disabled_reason: fastRequested ? 'extra_usage_disabled' : undefined };
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-test-model', tools: ['Read', 'Grep', 'Glob'], ...fast });
  if (mode === 'auth') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: sessionId });
    process.exit(1);
  }
  if (mode === 'max-turns') {
    // The model explains login code; that must not be mistaken for an auth failure.
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Users must log in again: the middleware returns 401 Unauthorized and hits the rate limit.' }] } });
    out({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 30, session_id: sessionId });
    process.exit(1);
  }
  out({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Looking at the entry point\\nmore' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: process.cwd() + '/src/app.ts' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'createServer', path: process.cwd() + '/src' } }] } });
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
  const test = stdin.includes('Connectivity test');
  const invalid = mode === 'invalid-then-ok' && !(resume && !fork);
  const answer = test ? { ok: true } : invalid ? INVALID : DIAGRAM;
  const structured = args.includes('--json-schema');
  out({ type: 'assistant', message: { content: [{ type: 'text', text: structured ? 'Done.' : 'Here it is.' }] } });
  out({
    type: 'result', subtype: 'success', is_error: false,
    result: structured ? 'Done.' : 'Here it is:\\n\`\`\`json\\n' + JSON.stringify(answer) + '\\n\`\`\`',
    structured_output: structured ? answer : undefined,
    num_turns: 3, duration_ms: 1234, total_cost_usd: 0.0125,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 },
    modelUsage: { 'claude-test-model': {} }, session_id: sessionId,
  });
  process.exit(0);
});
`;

const CODEX = `#!/usr/bin/env node
const BIN = 'codex';
${COMMON}
if (args[0] === '--version') { record({ args }); console.log('codex-cli 0.0.1-test'); process.exit(0); }
if (args[0] === 'sandbox') {
  record({ args });
  if (args[1] !== 'true') { process.stderr.write('usage: expected "sandbox true"\\n'); process.exit(2); }
  if (process.env.FAKE_SANDBOX === 'broken') { process.stderr.write('error building bubblewrap command: mountinfo path is not absolute\\n'); process.exit(1); }
  if (process.env.FAKE_SANDBOX === 'usage') {
    process.stderr.write("error: unrecognized subcommand 'true'\\n\\nUsage: codex sandbox <COMMAND>\\n");
    process.exit(2);
  }
  process.exit(0);
}
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (args[0] === 'mcp') { console.log(JSON.stringify([{ name: 'jira', enabled: true }, { name: 'off', enabled: false }])); process.exit(0); }
if (args[0] !== 'exec') { process.stderr.write('unknown command\\n'); process.exit(2); }
{
  // Strict flag parsing like clap: fork/resume have no -s/-C; exactly one prompt ("-") at the end.
  const sub0 = args[1] === 'fork' || args[1] === 'resume' ? args[1] : 'exec';
  const VALUE = ['--output-schema', '-o', '-m', '-c', ...(sub0 === 'exec' ? ['-s', '-C'] : [])];
  const BOOL = ['--json', '--skip-git-repo-check'];
  const positional = [];
  for (let i = sub0 === 'exec' ? 1 : 2; i < args.length; i++) {
    const a = args[i];
    if (VALUE.includes(a)) { i++; continue; }
    if (BOOL.includes(a)) continue;
    if (a.startsWith('-') && a !== '-') { process.stderr.write('error: unexpected argument ' + a + '\\n'); process.exit(2); }
    positional.push(a);
  }
  const expected = sub0 === 'exec' ? 1 : 2;
  if (positional.length !== expected || positional[positional.length - 1] !== '-') {
    process.stderr.write('error: bad positional arguments ' + JSON.stringify(positional) + '\\n');
    process.exit(2);
  }
}
readStdin((stdin) => {
  const sub = args[1] === 'fork' || args[1] === 'resume' ? args[1] : 'exec';
  const session = sub === 'exec' ? undefined : args[args.length - 2];
  const threadId = sub === 'resume' ? session : 'thread-' + rid();
  record({ args, stdin, cwd: process.cwd(), sub, session, threadId, schema: flag('--output-schema') ? fs.readFileSync(flag('--output-schema'), 'utf8') : null });
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'crash') { process.stderr.write('codex crashed\\n'); process.exit(3); }
  if (mode === 'missing-session' && sub === 'fork') { process.stderr.write('Error: no rollout found for thread id ' + session + '\\n'); process.exit(1); }
  out({ type: 'thread.started', thread_id: threadId });
  out({ type: 'turn.started' });
  const cmd = "/bin/bash -lc 'rg -n createServer " + process.cwd() + "/src'";
  out({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: cmd, aggregated_output: '', exit_code: null, status: 'in_progress' } });
  out({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: cmd, aggregated_output: 'src/app.ts:1', exit_code: 0, status: 'completed' } });
  out({ type: 'item.completed', item: { id: 'i2', type: 'reasoning', text: '**Mapping the modules**\\n\\nDetails.' } });
  if (mode === 'auth') { out({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized: please run codex login' } }); process.exit(1); }
  const test = stdin.includes('Connectivity test');
  const invalid = mode === 'invalid-then-ok' && sub !== 'resume';
  const text = JSON.stringify(test ? { ok: true } : invalid ? INVALID : DIAGRAM);
  out({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text } });
  const o = flag('-o');
  if (o) fs.writeFileSync(o, text);
  out({ type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 120, output_tokens: 40, reasoning_output_tokens: 10 } });
  process.exit(0);
});
`;

const ACP = `#!/usr/bin/env node
const BIN = process.env.FAKE_ACP_BIN || 'acp';
${COMMON}
if (args[0] === '--version') { record({ args }); console.log('kiro-cli 9.9.9'); process.exit(0); }
record({ event: 'start', args, cwd: process.cwd() });
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const waiting = new Map();
let promptId = null;
let prompts = 0;
function send(o) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\\n'); }
function ask(id, method, params) { return new Promise((resolve) => { waiting.set(id, resolve); send({ id, method, params }); }); }
function update(sessionId, u) { send({ method: 'session/update', params: { sessionId, update: u } }); }
async function onPrompt(msg) {
  prompts++;
  const sessionId = msg.params.sessionId;
  const text = (msg.params.prompt || []).map((b) => b.text || '').join('');
  record({ event: 'prompt', text, n: prompts });
  promptId = msg.id;
  if (mode === 'hang') return;
  if (prompts === 1) {
    update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Planning the ' } });
    update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'diagram' } });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Let me read the entry point.' } });
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Reading app.ts', kind: 'read', status: 'pending', locations: [{ path: SESSION_CWD + '/src/app.ts' }] });
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' });
    const kind = process.env.FAKE_PERMISSION_KIND || 'edit';
    // "none": a kind-less request for the read call announced above (the kind is optional in ACP).
    const toolCall = kind === 'none'
      ? { toolCallId: 'c1', title: 'Reading app.ts' }
      : { toolCallId: 'c2', title: 'Touch ' + SESSION_CWD + '/src/app.ts', kind };
    const perm = await ask('perm-1', 'session/request_permission', {
      sessionId,
      toolCall,
      options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
    });
    record({ event: 'permission', kind, result: perm.result || null });
    const fsReply = await ask('fs-1', 'fs/read_text_file', { sessionId, path: '/etc/hosts' });
    record({ event: 'fs', error: fsReply.error || null });
  }
  send({ method: '_kiro.dev/metadata', params: { sessionId, contextUsagePercentage: 12.5 } });
  const test = text.includes('Connectivity test');
  const answer = test ? { ok: true } : DIAGRAM;
  const body = mode === 'prose' && prompts === 1 ? 'I could not decide, sorry.' : 'Here is the diagram:\\n\`\`\`json\\n' + JSON.stringify(answer, null, 1) + '\\n\`\`\`';
  for (let i = 0; i < body.length; i += 40) update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: body.slice(i, i + 40) } });
  send({ id: msg.id, result: { stopReason: 'end_turn' } });
  promptId = null;
}
let SESSION_CWD = '';
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id !== undefined && !msg.method) { const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w(msg); } return; }
  switch (msg.method) {
    case 'initialize':
      record({ event: 'initialize', params: msg.params });
      send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [{ id: 'fake-login', name: 'Login', description: 'Run fake-cli login first.' }], agentInfo: { name: 'fake-agent', title: 'Fake Agent', version: '1.2.3' } } });
      break;
    case 'session/new':
      record({ event: 'session/new', params: msg.params });
      SESSION_CWD = msg.params.cwd;
      if (mode === 'auth') { send({ id: msg.id, error: { code: -32000, message: 'Authentication required' } }); break; }
      send({ method: '_kiro.dev/commands/available', params: { sessionId: 's1', commands: [] } });
      send({ id: msg.id, result: { sessionId: 's1', models: { currentModelId: 'm-default', availableModels: [{ modelId: 'm-default', name: 'Default', description: 'The default' }, { modelId: 'm-fast', name: 'Fast' }] } } });
      break;
    case 'session/set_model':
      record({ event: 'set_model', params: msg.params });
      send({ id: msg.id, result: {} });
      break;
    case 'session/prompt':
      onPrompt(msg);
      break;
    case 'session/cancel':
      record({ event: 'cancel' });
      if (promptId !== null) { send({ id: promptId, result: { stopReason: 'cancelled' } }); promptId = null; }
      break;
    default:
      if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: 'nope' } });
  }
});
rl.on('close', () => process.exit(0));
`;

export interface FakeClis {
  claude: string;
  codex: string;
  acp: string;
  record: string;
}

export async function writeFakeClis(dir: string): Promise<FakeClis> {
  const files = { claude: CLAUDE, codex: CODEX, acp: ACP };
  const out: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    const p = join(dir, `fake-${name}`);
    await writeFile(p, text, 'utf8');
    await chmod(p, 0o755);
    out[name] = p;
  }
  return {
    claude: out.claude as string,
    codex: out.codex as string,
    acp: out.acp as string,
    record: join(dir, 'record.jsonl'),
  };
}

export async function readRecord(file: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
