/**
 * Minimal Agent Client Protocol client (JSON-RPC 2.0, newline-delimited, over the agent's stdio).
 * Supports initialize, session/new, session/set_model, session/prompt and session/cancel; streams
 * session/update notifications to a callback; answers session/request_permission through a policy
 * and rejects everything else the agent asks for (fs/*, terminal/*) with -32601.
 */
import { appendFileSync } from 'node:fs';
import { APP_NAME, APP_VERSION } from '@codesplainer/shared';
import {
  startProcess,
  type ManagedProcess,
  type ProcessResult,
  type ProcessTracker,
} from '../process';
import { AgentError } from '../types';
import { classifyErrorText, clip, isObject, stripAnsi } from '../util';

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpToolCall {
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  locations?: { path?: string; line?: number }[];
}

export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

export interface AcpModelInfo {
  modelId: string;
  name?: string;
  description?: string;
}

export interface AcpInitializeResult {
  protocolVersion?: number;
  agentCapabilities?: Record<string, unknown>;
  authMethods?: { id: string; name?: string; description?: string }[];
  agentInfo?: { name?: string; title?: string; version?: string };
}

export interface AcpNewSessionResult {
  sessionId: string;
  models?: { currentModelId?: string; availableModels?: AcpModelInfo[] };
  modes?: unknown;
}

export interface AcpClientOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  tracker?: ProcessTracker;
  /** Hard limit for the agent process (killed afterwards). */
  timeoutMs?: number;
  /** Shown in error messages ("Kiro CLI exited …"). */
  label: string;
  /** session/update and any other notification (unknown ones such as `_kiro.dev/*` included). */
  onNotification?: (method: string, params: unknown) => void;
  /** Decide a permission request. Default: reject. */
  onPermission?: (req: AcpPermissionRequest) => 'allow' | 'reject';
  onStderr?: (chunk: string) => void;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const METHOD_NOT_FOUND = -32601;

export class AcpClient {
  private readonly proc: ManagedProcess;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closedError?: AgentError;
  private initResult?: AcpInitializeResult;
  /** Resolves when the agent process is gone. */
  readonly exited: Promise<ProcessResult>;

  constructor(private readonly opts: AcpClientOptions) {
    this.proc = startProcess({
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env,
      interactive: true,
      timeoutMs: opts.timeoutMs,
      tracker: opts.tracker,
      killGraceMs: 2000,
      onStdoutLine: (line) => this.onLine(line),
      onStderr: opts.onStderr,
    });
    this.exited = this.proc.done.then((res) => {
      const err = this.exitError(res);
      this.closedError = err;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      return res;
    });
  }

  get running(): boolean {
    return this.proc.running;
  }

  private exitError(res: ProcessResult): AgentError {
    const label = this.opts.label;
    if (res.timedOut) return new AgentError('timeout', `${label} timed out.`);
    if (res.cancelled) return new AgentError('cancelled', 'Cancelled.');
    if (res.spawnError)
      return new AgentError('unavailable', `Could not start ${label}: ${res.spawnError}`);
    const stderr = stripAnsi(res.stderrTail).trim();
    const detail = stderr ? `: ${clip(stderr.split('\n').slice(-6).join(' '), 600)}` : '';
    const code = classifyErrorText(stderr) ?? 'process';
    const how = res.signal ? `signal ${res.signal}` : `code ${res.code}`;
    return new AgentError(code, `${label} exited unexpectedly (${how})${detail}`);
  }

  private send(message: Record<string, unknown>): void {
    const ok = this.proc.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    if (!ok && this.closedError) throw this.closedError;
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
      try {
        this.send({ id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  notify(method: string, params: unknown): void {
    try {
      this.send({ method, params });
    } catch {
      // agent already gone
    }
  }

  private respond(
    id: unknown,
    payload: { result: unknown } | { error: { code: number; message: string } },
  ): void {
    try {
      this.send({ id, ...payload });
    } catch {
      // agent already gone
    }
  }

  private onLine(line: string): void {
    const text = line.trim();
    const debugFile = process.env.CODESPLAINER_ACP_DEBUG;
    if (debugFile) {
      try {
        appendFileSync(debugFile, `${new Date().toISOString()} ${this.opts.label} <- ${text}\n`);
      } catch {
        // debugging only
      }
    }
    if (!text.startsWith('{')) return; // agents sometimes log to stdout
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) return;
      msg = parsed;
    } catch {
      return;
    }
    const method = typeof msg.method === 'string' ? msg.method : undefined;
    const hasId = msg.id !== undefined && msg.id !== null;
    if (method && hasId) {
      this.onRequest(msg.id, method, msg.params);
    } else if (method) {
      try {
        this.opts.onNotification?.(method, msg.params);
      } catch {
        // callbacks must not break the protocol loop
      }
    } else if (hasId) {
      const id = typeof msg.id === 'number' ? msg.id : Number(msg.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (isObject(msg.error)) {
        const message = typeof msg.error.message === 'string' ? msg.error.message : 'Unknown error';
        const data =
          msg.error.data !== undefined ? ` ${clip(JSON.stringify(msg.error.data), 300)}` : '';
        const full = `${this.opts.label}: ${pending.method} failed: ${message}${data}`;
        // ACP reserves -32000 for "authentication required".
        const classified = classifyErrorText(full);
        const code =
          classified === 'rate_limit'
            ? classified
            : msg.error.code === -32000
              ? 'auth'
              : classified;
        pending.reject(new AgentError(code ?? 'process', full));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private onRequest(id: unknown, method: string, params: unknown): void {
    if (method === 'session/request_permission' && isObject(params)) {
      const req: AcpPermissionRequest = {
        sessionId: String(params.sessionId ?? ''),
        toolCall: isObject(params.toolCall) ? (params.toolCall as AcpToolCall) : {},
        options: Array.isArray(params.options)
          ? params.options.filter(isObject).map((o) => ({
              optionId: String(o.optionId ?? ''),
              name: typeof o.name === 'string' ? o.name : undefined,
              kind: typeof o.kind === 'string' ? o.kind : undefined,
            }))
          : [],
      };
      let decision: 'allow' | 'reject';
      try {
        decision = this.opts.onPermission?.(req) ?? 'reject';
      } catch {
        decision = 'reject';
      }
      const kinds =
        decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
      const option = kinds.map((k) => req.options.find((o) => o.kind === k)).find(Boolean);
      this.respond(id, {
        result: option
          ? { outcome: { outcome: 'selected', optionId: option.optionId } }
          : { outcome: { outcome: 'cancelled' } },
      });
      return;
    }
    // fs/*, terminal/* and anything else: not offered by this client.
    this.respond(id, {
      error: { code: METHOD_NOT_FOUND, message: `Method not supported: ${method}` },
    });
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.request<AcpInitializeResult>('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: APP_NAME.toLowerCase(), title: APP_NAME, version: APP_VERSION },
    });
    this.initResult = isObject(result) ? result : {};
    return this.initResult;
  }

  get initializeResult(): AcpInitializeResult | undefined {
    return this.initResult;
  }

  async newSession(cwd: string): Promise<AcpNewSessionResult> {
    const result = await this.request<AcpNewSessionResult>('session/new', { cwd, mcpServers: [] });
    if (!isObject(result) || typeof result.sessionId !== 'string') {
      throw new AgentError('process', `${this.opts.label}: session/new returned no sessionId.`);
    }
    return result;
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.request('session/set_model', { sessionId, modelId });
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason?: string }> {
    const result = await this.request<{ stopReason?: string }>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
    return isObject(result) ? result : {};
  }

  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId });
  }

  /** Close stdin and terminate the agent (and its children). */
  async close(reason: 'done' | 'cancelled' | 'timeout' = 'done'): Promise<ProcessResult> {
    this.proc.endStdin();
    return this.proc.kill(reason);
  }
}

/** Convert ACP models into provider models. */
export function acpModels(
  models: AcpNewSessionResult['models'],
): { id: string; label: string; description?: string }[] {
  const list = Array.isArray(models?.availableModels) ? models.availableModels : [];
  return list
    .filter((m) => isObject(m) && typeof m.modelId === 'string')
    .map((m) => ({
      id: m.modelId,
      label: typeof m.name === 'string' && m.name ? m.name : m.modelId,
      ...(typeof m.description === 'string' && m.description ? { description: m.description } : {}),
    }));
}
