/**
 * One diagram generation over ACP (shared by the Kiro and the generic ACP providers):
 * spawn → initialize → session/new → [set model] → prompt → extract JSON → validate → one repair
 * prompt in the same session when needed. Tool calls become activity items.
 */
import type { Usage } from '@codesplainer/shared';
import { extractJson } from '../extract';
import type { ProcessTracker } from '../process';
import { buildRepairPrompt } from '../prompt';
import {
  AgentError,
  type ActivityInput,
  type AgentRunRequest,
  type AgentRunResult,
} from '../types';
import {
  clip,
  displayPath,
  errorMessage,
  firstLine,
  isObject,
  shortenPaths,
  toAgentError,
  type FolderRef,
} from '../util';
import { AcpClient, type AcpToolCall } from './client';

export interface AcpRunConfig {
  req: AgentRunRequest;
  /** Display name ("Kiro CLI"). */
  label: string;
  command: string;
  args: string[];
  /** Process working directory (Kiro: its agent home). */
  spawnCwd: string;
  /** Session working directory (the first workspace folder). */
  sessionCwd: string;
  env?: NodeJS.ProcessEnv;
  /** Text of the first prompt (callers prepend the system prompt when the agent has no other way). */
  promptText: string;
  /** Tool kinds the permission policy approves (everything else is rejected). */
  allowKinds: ReadonlySet<string>;
  /** Switch the session model with session/set_model. */
  setModel?: string;
  tracker: ProcessTracker;
  /** Vendor notifications such as `_kiro.dev/metadata`; may enrich usage. */
  onVendorNotification?: (method: string, params: unknown, usage: Usage) => void;
}

const PATH_KEYS = [
  'path',
  'file_path',
  'filePath',
  'file',
  'filename',
  'dir',
  'directory',
  'target',
];
const PATTERN_KEYS = ['pattern', 'query', 'regex', 'glob', 'search', 'include'];

function findString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 3) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const k of keys) {
    const v = value[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  for (const v of Object.values(value)) {
    if (typeof v === 'object' && v !== null) {
      const found = findString(v, keys, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** True when a tool call carries more than its bare kind (title = kind, no locations/input). */
function hasDetails(tc: AcpToolCall): boolean {
  const title = (tc.title ?? '').trim().toLowerCase();
  return (
    Boolean(tc.locations?.length) ||
    (Boolean(title) && title !== (tc.kind ?? '').toLowerCase()) ||
    isObject(tc.rawInput)
  );
}

export function toolActivity(tc: AcpToolCall, folders: FolderRef[]): ActivityInput {
  const locations = (tc.locations ?? [])
    .map((l) => l?.path)
    .filter((p): p is string => typeof p === 'string' && !!p);
  const path = locations[0] ?? findString(tc.rawInput, PATH_KEYS);
  const shown = path ? displayPath(path, folders) : undefined;
  const title = tc.title ? shortenPaths(tc.title, folders) : '';
  let text: string;
  switch (tc.kind) {
    case 'read': {
      if (locations.length > 1) {
        const names = locations.slice(0, 2).map((p) => displayPath(p, folders));
        text = `Reading ${names.join(', ')}${locations.length > 2 ? ` +${locations.length - 2}` : ''}`;
      } else {
        text = shown ? `Reading ${shown}` : title || 'Reading';
      }
      break;
    }
    case 'search': {
      const pattern = findString(tc.rawInput, PATTERN_KEYS);
      text = pattern
        ? `Searching “${clip(pattern, 50)}”${shown ? ` in ${shown}` : ''}`
        : title || 'Searching';
      break;
    }
    case 'execute':
      text = title ? `Running ${title}` : 'Running a command';
      break;
    case 'think':
      return { kind: 'thinking', text: clip(title || 'Thinking', 140) };
    default:
      text = title || tc.kind || 'Using a tool';
  }
  return { kind: 'tool', text: clip(text, 140), ...(path ? { path } : {}) };
}

function contentText(content: unknown): string {
  if (isObject(content) && typeof content.text === 'string') return content.text;
  if (Array.isArray(content)) return content.map(contentText).join('');
  return '';
}

function parseAnswer(text: string): unknown {
  const value = extractJson(text);
  return value === undefined ? text : value;
}

export async function runAcpGeneration(cfg: AcpRunConfig): Promise<AgentRunResult> {
  const { req } = cfg;
  const started = Date.now();
  const warnings: string[] = [];
  const usage: Usage = {};
  let sessionId: string | undefined;
  let turnText = '';
  let segment = '';
  let thought = '';

  const flushThought = () => {
    const t = thought.trim();
    thought = '';
    if (t) req.onActivity({ kind: 'thinking', text: clip(firstLine(t) || t, 140) });
  };
  const flushSegment = () => {
    const s = segment.trim();
    segment = '';
    if (s && !s.startsWith('{') && !s.startsWith('```')) {
      req.onActivity({ kind: 'message', text: clip(firstLine(s), 140) });
    }
  };

  // Some agents (Kiro) announce a tool call bare ("read") and repeat it with details: report each
  // call once, as soon as it has details (or when it finishes without them).
  const pendingCalls = new Map<string, AcpToolCall>();
  const reportedCalls = new Set<string>();
  /** Tool kinds seen in updates (permission requests may omit the kind). */
  const callKinds = new Map<string, string>();
  const reportCall = (tc: AcpToolCall) => {
    if (tc.toolCallId) {
      if (reportedCalls.has(tc.toolCallId)) return;
      reportedCalls.add(tc.toolCallId);
      pendingCalls.delete(tc.toolCallId);
    }
    req.onActivity(toolActivity(tc, req.folders));
  };

  const onUpdate = (params: unknown) => {
    if (!isObject(params) || !isObject(params.update)) return;
    if (sessionId && typeof params.sessionId === 'string' && params.sessionId !== sessionId) return;
    const u = params.update;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        flushThought();
        const t = contentText(u.content);
        turnText += t;
        segment += t;
        break;
      }
      case 'agent_thought_chunk':
        thought += contentText(u.content);
        break;
      case 'tool_call':
      case 'tool_call_update': {
        const tc = u as AcpToolCall;
        const id = tc.toolCallId;
        if (id && typeof tc.kind === 'string') callKinds.set(id, tc.kind);
        if (u.sessionUpdate === 'tool_call') {
          flushThought();
          flushSegment();
        }
        const merged: AcpToolCall = { ...(id ? pendingCalls.get(id) : undefined), ...tc };
        if (u.status === 'failed') {
          const title = merged.title ? shortenPaths(merged.title, req.folders) : 'tool call';
          req.onActivity({ kind: 'warning', text: clip(`Failed: ${title}`, 140) });
          if (id) reportedCalls.add(id);
          break;
        }
        if (id && reportedCalls.has(id)) break;
        const done = u.status === 'completed';
        if (hasDetails(merged) || done || !id) reportCall(merged);
        else if (id) pendingCalls.set(id, merged);
        break;
      }
      default:
        break;
    }
  };

  const client = new AcpClient({
    command: cfg.command,
    args: cfg.args,
    cwd: cfg.spawnCwd,
    env: cfg.env,
    tracker: cfg.tracker,
    timeoutMs: req.timeoutMs,
    label: cfg.label,
    onNotification: (method, params) => {
      if (method === 'session/update') onUpdate(params);
      else cfg.onVendorNotification?.(method, params, usage);
    },
    onPermission: (p) => {
      const kind =
        p.toolCall.kind ??
        (p.toolCall.toolCallId ? callKinds.get(p.toolCall.toolCallId) : undefined) ??
        'other';
      const allowed = cfg.allowKinds.has(kind);
      if (!allowed) {
        const title = p.toolCall.title ? `: ${shortenPaths(p.toolCall.title, req.folders)}` : '';
        req.onActivity({ kind: 'warning', text: clip(`Blocked ${kind} request${title}`, 140) });
      }
      return allowed ? 'allow' : 'reject';
    },
  });

  let cancelTimer: NodeJS.Timeout | undefined;
  const onAbort = () => {
    if (sessionId) client.cancel(sessionId);
    cancelTimer = setTimeout(() => void client.close('cancelled'), 500);
  };
  if (req.signal.aborted) {
    await client.close('cancelled');
    throw new AgentError('cancelled', 'Cancelled.');
  }
  req.signal.addEventListener('abort', onAbort, { once: true });

  const runTurn = async (text: string): Promise<string> => {
    turnText = '';
    segment = '';
    thought = '';
    const res = await client.prompt(sessionId as string, text);
    flushThought();
    if (res.stopReason === 'cancelled' || req.signal.aborted)
      throw new AgentError('cancelled', 'Cancelled.');
    if (res.stopReason && res.stopReason !== 'end_turn') {
      warnings.push(`${cfg.label} stopped early (${res.stopReason}).`);
    }
    return turnText;
  };

  try {
    // (The generation service already reports "Starting <provider>".)
    const init = await client.initialize();
    let session;
    try {
      session = await client.newSession(cfg.sessionCwd);
    } catch (e) {
      const err = toAgentError(e, 'process');
      const hint = init.authMethods?.find((m) => m.description)?.description;
      if (err.code === 'auth' && hint) throw new AgentError('auth', `${err.message} ${hint}`);
      throw err;
    }
    sessionId = session.sessionId;
    if (session.models?.currentModelId) usage.model = session.models.currentModelId;
    if (cfg.setModel && cfg.setModel !== usage.model) {
      try {
        await client.setModel(sessionId, cfg.setModel);
        usage.model = cfg.setModel;
      } catch (e) {
        warnings.push(`Could not switch to model ${cfg.setModel}: ${clip(errorMessage(e), 200)}`);
      }
    }
    req.onActivity({
      kind: 'status',
      text: usage.model ? `Exploring (${usage.model})` : 'Exploring',
    });

    let rawText = await runTurn(cfg.promptText);
    let output = parseAnswer(rawText);
    const check = req.validate(output);
    if (!check.ok) {
      warnings.push(`First answer was invalid (${clip(check.error, 200)}); asked for a fix.`);
      req.onActivity({ kind: 'status', text: 'Answer invalid, asking for a fix' });
      const repairedText = await runTurn(buildRepairPrompt(check.error));
      const repaired = parseAnswer(repairedText);
      const again = req.validate(repaired);
      if (again.ok || repairedText.trim()) {
        rawText = repairedText;
        output = repaired;
      }
      if (!again.ok)
        warnings.push(`Answer still invalid after the repair round: ${clip(again.error, 200)}`);
    }
    usage.durationMs = Date.now() - started;
    return { output, rawText, usage, warnings };
  } catch (e) {
    usage.durationMs = Date.now() - started;
    throw toAgentError(e, 'process', { rawText: turnText, usage, warnings });
  } finally {
    clearTimeout(cancelTimer);
    req.signal.removeEventListener('abort', onAbort);
    await client.close(req.signal.aborted ? 'cancelled' : 'done');
  }
}
