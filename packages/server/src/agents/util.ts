/** Small helpers shared by the agent providers (paths, text, errors, timing). */
import { stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { toPosixPath } from '@codesplainer/shared';
import { AgentError, type AgentErrorCode, type AgentRunResult } from './types';

export interface FolderRef {
  alias: string;
  path: string;
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

export const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Single-line text clipped to `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** First non-empty line of a text, markdown emphasis stripped. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.replace(/[*_`#>]+/g, '').trim();
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Last `max` characters of a text, cut at a line start when possible. */
export function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < max / 4 ? cut.slice(nl + 1) : cut;
}

/**
 * Display form of a path touched by an agent: relative to the workspace folder that contains it
 * ("src/app.ts", or "web:src/app.ts" when there are several folders). Other paths are returned as-is.
 */
export function displayPath(p: string, folders: FolderRef[]): string {
  if (!p) return p;
  if (!isAbsolute(p)) return toPosixPath(p) || '.';
  const multi = folders.length > 1;
  for (const folder of folders) {
    const rel = relative(folder.path, p);
    if (rel === '') return multi ? `${folder.alias}:` : '.';
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      const posix = toPosixPath(rel);
      return multi ? `${folder.alias}:${posix}` : posix;
    }
  }
  return toPosixPath(p);
}

/** Replace absolute workspace-folder prefixes inside free text (tool titles, shell commands). */
export function shortenPaths(text: string, folders: FolderRef[]): string {
  let out = text;
  const multi = folders.length > 1;
  // Longest paths first so nested folders win.
  for (const folder of [...folders].sort((a, b) => b.path.length - a.path.length)) {
    const variants = new Set([folder.path, toPosixPath(folder.path)]);
    for (const v of variants) {
      if (!v || v === '/') continue;
      out = out.split(`${v}/`).join(multi ? `${folder.alias}:` : '');
      out = out.split(`${v}\\`).join(multi ? `${folder.alias}:` : '');
      out = out.split(v).join(multi ? `${folder.alias}:` : '.');
    }
  }
  return out;
}

const AUTH_PATTERNS = [
  /not logged in/i,
  /please (?:run )?\/?log ?in/i,
  /log ?in (?:again|required|expired)/i,
  /\bre-?authenticate\b/i,
  /authentication (?:failed|required|error)/i,
  /\bunauthori[sz]ed\b/i,
  /invalid (?:api[ _-]?key|x-api-key|bearer token)/i,
  /\b(?:status|code|http|error)[: ]+401\b/i,
  /\b401 unauthori[sz]ed/i,
  /oauth token (?:has )?(?:expired|revoked|invalid)/i,
  /(?:kiro-cli|codex|claude)'? (?:auth )?login/i,
];
const RATE_PATTERNS = [
  /rate[ _-]?limit/i,
  /usage limit/i,
  /quota (?:exceeded|reached)/i,
  /too many requests/i,
  /\b(?:status|code|http|error)[: ]+429\b/i,
  /(?:usage|weekly|session|daily|5-hour) limit (?:reached|exceeded)/i,
  /\boverloaded\b/i,
];

/** Classify an error text coming from a CLI (stderr tail, error result). */
export function classifyErrorText(text: string): AgentErrorCode | undefined {
  if (!text) return undefined;
  if (RATE_PATTERNS.some((re) => re.test(text))) return 'rate_limit';
  if (AUTH_PATTERNS.some((re) => re.test(text))) return 'auth';
  return undefined;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

/** Wrap anything thrown into an AgentError, keeping existing AgentErrors. */
export function toAgentError(
  e: unknown,
  fallback: AgentErrorCode = 'unknown',
  partial?: Partial<AgentRunResult>,
): AgentError {
  if (e instanceof AgentError) {
    if (!partial || e.partial) return e;
    const err = new AgentError(e.code, e.message, partial);
    err.stack = e.stack;
    return err;
  }
  const message = errorMessage(e);
  return new AgentError(classifyErrorText(message) ?? fallback, message, partial);
}

/** Resolves after `ms`; rejects with AgentError('cancelled') when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AgentError('cancelled', 'Cancelled.'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AgentError('cancelled', 'Cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Remaining milliseconds until a deadline (at least 1). */
export function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

/**
 * The agent's working directory must exist: Node reports a missing cwd as `spawn <cli> ENOENT`,
 * which would look like a missing CLI.
 */
export async function ensureFolder(path: string | undefined): Promise<string> {
  if (!path) throw new AgentError('unavailable', 'The workspace has no folders.');
  const s = await stat(path).catch(() => undefined);
  if (!s?.isDirectory()) throw new AgentError('unavailable', `Workspace folder not found: ${path}`);
  return path;
}

/** Environment for child CLIs: inherits ours, drops variables that confuse nested agents. */
export function childEnv(
  extra: Record<string, string> = {},
  drop: string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', ...extra };
  for (const key of drop) delete env[key];
  return env;
}

/** A tiny TTL cache (also dedupes concurrent loads of the same key). */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(private readonly ttlMs: number) {}

  /** `keep` decides whether a loaded value stays cached (default: yes). Rejections never do. */
  get(
    key: string,
    load: () => Promise<T>,
    refresh = false,
    keep?: (value: T) => boolean,
  ): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && !refresh && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    const entry = { at: Date.now(), value };
    this.entries.set(key, entry);
    const drop = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
    value.then((v) => {
      if (keep && !keep(v)) drop();
    }, drop);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
