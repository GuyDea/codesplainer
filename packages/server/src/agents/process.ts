/**
 * Child process helper for agent CLIs: line-buffered stdout, bounded stderr tail, timeout and
 * AbortSignal support, and whole-tree termination (SIGTERM, then SIGKILL after a grace period).
 *
 * POSIX: children are spawned detached (own process group) so `process.kill(-pid)` reaches
 * grandchildren too (MCP servers, shells...). Windows: `taskkill /pid X /T /F`.
 * Live processes are tracked by a ProcessTracker so the registry can kill them on shutdown.
 */
import { spawn as nodeSpawn, spawnSync, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import crossSpawn from 'cross-spawn';
import { errorMessage, tail } from './util';

const IS_WINDOWS = process.platform === 'win32';
const STDERR_TAIL_CHARS = 8 * 1024;
const DEFAULT_KILL_GRACE_MS = 3000;
/** How long to wait for stdio to close after the main process exited (grandchildren may hold it). */
const DRAIN_MS = 300;

export type KillReason = 'timeout' | 'cancelled' | 'dispose' | 'done';

export interface ProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Text written to stdin, which is then closed. */
  stdin?: string;
  /** Keep stdin open (interactive protocols such as ACP): use write() / endStdin(). */
  interactive?: boolean;
  onStdoutLine?: (line: string) => void;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Delay between SIGTERM and SIGKILL. Default 3 s. */
  killGraceMs?: number;
  tracker?: ProcessTracker;
}

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last ~8 KB of stderr. */
  stderrTail: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  /** The process could not be started (e.g. ENOENT). */
  spawnError?: string;
}

export interface ManagedProcess {
  readonly pid: number | undefined;
  readonly done: Promise<ProcessResult>;
  readonly running: boolean;
  /** Write to stdin (interactive mode). Returns false when stdin is closed. */
  write(text: string): boolean;
  endStdin(): void;
  /** Terminate the whole process tree (SIGTERM, SIGKILL after the grace period). */
  kill(reason?: KillReason): Promise<ProcessResult>;
  /** SIGKILL whatever is left of the process tree, synchronously. */
  forceKill(): void;
}

const trackers = new Set<ProcessTracker>();
let exitHookInstalled = false;

/** Last resort when the server exits without dispose(): SIGKILL every tracked process group. */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const t of trackers) t.killAllSync();
  });
}

/** Keeps track of live child processes (one per registry). */
export class ProcessTracker {
  private readonly live = new Set<ManagedProcess>();
  /** Groups whose leader exited while other members were still running. */
  private readonly remnants = new Map<number, () => void>();
  private isClosed = false;

  constructor() {
    trackers.add(this);
    installExitHook();
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get size(): number {
    return this.live.size;
  }

  add(p: ManagedProcess): void {
    this.live.add(p);
  }

  remove(p: ManagedProcess): void {
    this.live.delete(p);
  }

  addRemnant(pid: number, forceKill: () => void): void {
    this.remnants.set(pid, forceKill);
  }

  removeRemnant(pid: number): void {
    this.remnants.delete(pid);
  }

  /** Kill everything (whole trees, leftovers included) and refuse new processes. */
  async killAll(): Promise<void> {
    this.isClosed = true;
    const handles = [...this.live];
    await Promise.allSettled(handles.map((p) => p.kill('dispose')));
    this.killAllSync(handles);
  }

  /** Synchronous SIGKILL of all tracked trees (also used from the process 'exit' hook). */
  killAllSync(extra: ManagedProcess[] = []): void {
    for (const p of new Set([...this.live, ...extra])) p.forceKill();
    for (const kill of this.remnants.values()) kill();
    this.remnants.clear();
  }
}

export const defaultTracker = new ProcessTracker();

function settled(result: ProcessResult): ManagedProcess {
  const done = Promise.resolve(result);
  return {
    pid: undefined,
    done,
    running: false,
    write: () => false,
    endStdin: () => undefined,
    kill: () => done,
    forceKill: () => undefined,
  };
}

function safe<A extends unknown[]>(fn: ((...args: A) => void) | undefined, ...args: A): void {
  if (!fn) return;
  try {
    fn(...args);
  } catch {
    // Callbacks must not break process handling.
  }
}

export function startProcess(opts: ProcessOptions): ManagedProcess {
  const tracker = opts.tracker ?? defaultTracker;
  const started = Date.now();
  const graceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  let stderrTail = '';
  let timedOut = false;
  let cancelled = false;
  let spawnError: string | undefined;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let exited = false;
  let finished = false;

  const result = (): ProcessResult => ({
    code: exitCode,
    signal: exitSignal,
    stderrTail,
    timedOut,
    cancelled,
    durationMs: Date.now() - started,
    ...(spawnError ? { spawnError } : {}),
  });

  if (tracker.closed || opts.signal?.aborted) {
    cancelled = true;
    return settled(result());
  }

  let child: ChildProcess;
  try {
    child = crossSpawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !IS_WINDOWS,
      windowsHide: true,
    });
  } catch (e) {
    spawnError = errorMessage(e);
    return settled(result());
  }

  let resolveDone!: (r: ProcessResult) => void;
  const done = new Promise<ProcessResult>((resolve) => {
    resolveDone = resolve;
  });

  // ---- stdout (line buffered) / stderr (tail) ----
  const outDecoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');
  let pending = '';
  const pushStdout = (text: string, flush: boolean) => {
    pending += text;
    let start = 0;
    let idx: number;
    while ((idx = pending.indexOf('\n', start)) >= 0) {
      const line = pending.slice(start, idx);
      start = idx + 1;
      safe(opts.onStdoutLine, line.endsWith('\r') ? line.slice(0, -1) : line);
    }
    pending = pending.slice(start);
    if (flush && pending) {
      const line = pending;
      pending = '';
      safe(opts.onStdoutLine, line.endsWith('\r') ? line.slice(0, -1) : line);
    }
  };
  child.stdout?.on('data', (chunk: Buffer) => pushStdout(outDecoder.write(chunk), false));
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = errDecoder.write(chunk);
    stderrTail = tail(stderrTail + text, STDERR_TAIL_CHARS);
    safe(opts.onStderr, text);
  });
  child.stdout?.on('error', () => undefined);
  child.stderr?.on('error', () => undefined);
  child.stdin?.on('error', () => undefined); // EPIPE when the child exits early

  if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
  else if (!opts.interactive) child.stdin?.end();

  // ---- termination ----
  let killTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let drainTimer: NodeJS.Timeout | undefined;
  let taskkilled = false;

  const groupAlive = (): boolean => {
    const pid = child.pid;
    if (!pid || IS_WINDOWS) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  };

  const signalTree = (sig: NodeJS.Signals) => {
    const pid = child.pid;
    if (!pid) return;
    if (IS_WINDOWS) {
      if (taskkilled) return;
      taskkilled = true;
      try {
        nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        }).on('error', () => child.kill());
      } catch {
        child.kill();
      }
      return;
    }
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // already gone
      }
    }
  };

  const forceKill = () => {
    const pid = child.pid;
    if (!pid) return;
    if (IS_WINDOWS) {
      if (exited) return;
      try {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // best effort
      }
      return;
    }
    if (!exited || groupAlive()) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  };

  const escalate = () => {
    if (killTimer) return;
    killTimer = setTimeout(() => {
      if (!exited || groupAlive()) signalTree('SIGKILL');
      if (child.pid) tracker.removeRemnant(child.pid);
    }, graceMs);
    killTimer.unref();
  };

  const onAbort = () => void handle.kill('cancelled');

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutTimer);
    clearTimeout(drainTimer);
    pushStdout(outDecoder.end(), true);
    const rest = errDecoder.end();
    if (rest) stderrTail = tail(stderrTail + rest, STDERR_TAIL_CHARS);
    opts.signal?.removeEventListener('abort', onAbort);
    tracker.remove(handle);
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.stdin?.destroy();
    resolveDone(result());
  };

  child.on('error', (err) => {
    // Only spawn failures (ENOENT, EACCES: no pid) end the process; kill errors are ignored.
    if (child.pid !== undefined) return;
    spawnError ??= err.message;
    exited = true;
    finish();
  });
  child.on('exit', (code, sig) => {
    exited = true;
    exitCode = code;
    exitSignal = sig;
    // Leftover group members (MCP servers, shells) are cleaned up too; until they are gone the
    // tracker remembers the group so dispose() can SIGKILL it.
    if (groupAlive()) {
      if (child.pid) tracker.addRemnant(child.pid, forceKill);
      signalTree('SIGTERM');
      escalate();
    }
    drainTimer = setTimeout(finish, DRAIN_MS);
  });
  child.on('close', (code, sig) => {
    if (!exited) {
      exitCode = code;
      exitSignal = sig;
    }
    exited = true;
    finish();
  });

  const handle: ManagedProcess = {
    get pid() {
      return child.pid;
    },
    done,
    get running() {
      return !exited;
    },
    write(text: string) {
      const stdin = child.stdin;
      if (!stdin || stdin.destroyed || !stdin.writable || exited) return false;
      stdin.write(text);
      return true;
    },
    endStdin() {
      child.stdin?.end();
    },
    kill(reason: KillReason = 'cancelled') {
      if (finished || exited) return done;
      if (reason === 'timeout') timedOut = true;
      else if (reason !== 'done') cancelled = true;
      signalTree('SIGTERM');
      escalate();
      return done;
    },
    forceKill,
  };

  tracker.add(handle);
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => void handle.kill('timeout'), opts.timeoutMs);
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  return handle;
}

export interface CapturedResult extends ProcessResult {
  /** Captured stdout (bounded). */
  stdout: string;
}

/** Run a process to completion, capturing (bounded) stdout. */
export async function runProcess(
  opts: ProcessOptions & { maxStdoutChars?: number },
): Promise<CapturedResult> {
  const max = opts.maxStdoutChars ?? 256 * 1024;
  let stdout = '';
  const proc = startProcess({
    ...opts,
    onStdoutLine: (line) => {
      if (stdout.length < max) stdout += `${line}\n`;
      opts.onStdoutLine?.(line);
    },
  });
  const res = await proc.done;
  return { ...res, stdout: stdout.slice(0, max) };
}
