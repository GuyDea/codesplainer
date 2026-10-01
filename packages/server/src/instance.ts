/**
 * One server per data directory. The running server (CLI, dev server or desktop app) owns
 * `<dataDir>/instance.json` with its pid and address. Another server that finds a live owner
 * stays away instead of opening the same files: it would mark the owner's running diagrams as
 * interrupted and overwrite its saves. Locks left by crashed processes, or written before the
 * machine last booted (their pid may belong to an unrelated process by now), are taken over.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { uptime } from 'node:os';
import { join } from 'node:path';
import { APP_VERSION } from '@codesplainer/shared';
import { writeFileAtomic } from './storage/atomic';

export const INSTANCE_FILE = 'instance.json';

/** Contents of the lock file. */
export interface InstanceInfo {
  pid: number;
  startedAt: string;
  version: string;
  /** Who runs the server, e.g. "cli" or "desktop". */
  kind?: string;
  /** Address of the UI, once the server listens. */
  url?: string;
}

export interface InstanceLock {
  readonly path: string;
  /** Record the server's address (read by other instances). */
  setUrl(url: string): Promise<void>;
  /** Delete the lock file if it is still ours. Idempotent. */
  release(): Promise<void>;
}

export type LockResult =
  { ok: true; lock: InstanceLock } | { ok: false; owner: InstanceInfo; path: string };

export interface LockOptions {
  kind?: string;
  /** Keep retrying this long while another live process holds the lock (e.g. a restart). */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const readText = (path: string) => readFile(path, 'utf8').catch(() => undefined);
const serialize = (info: InstanceInfo) => `${JSON.stringify(info, null, 2)}\n`;

/** True while a process with this pid exists (EPERM: it exists but belongs to someone else). */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseInfo(text: string | undefined): InstanceInfo | undefined {
  if (!text) return undefined;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (typeof raw.pid !== 'number' || typeof raw.startedAt !== 'string') return undefined;
    const info: InstanceInfo = {
      pid: raw.pid,
      startedAt: raw.startedAt,
      version: typeof raw.version === 'string' ? raw.version : '',
    };
    if (typeof raw.kind === 'string') info.kind = raw.kind;
    if (typeof raw.url === 'string') info.url = raw.url;
    return info;
  } catch {
    return undefined;
  }
}

/** The lock's process is gone, or it was written before this machine last booted. */
export function isStale(info: InstanceInfo, now = Date.now()): boolean {
  const started = Date.parse(info.startedAt);
  const bootedAt = now - uptime() * 1000;
  // A minute of slack: uptime() and the wall clock are not perfectly in sync.
  if (Number.isFinite(started) && started < bootedAt - 60_000) return true;
  return !processAlive(info.pid);
}

/** Take the data directory's lock, or report the live process that holds it. */
export async function acquireInstanceLock(
  dataDir: string,
  opts: LockOptions = {},
): Promise<LockResult> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, INSTANCE_FILE);
  const mine: InstanceInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    version: APP_VERSION,
    ...(opts.kind ? { kind: opts.kind } : {}),
  };
  const deadline = Date.now() + (opts.waitMs ?? 0);
  let takeovers = 0;
  for (;;) {
    try {
      // "wx" fails when the file exists: only one process can create it.
      await writeFile(path, serialize(mine), { flag: 'wx', mode: 0o600 });
      return { ok: true, lock: lockHandle(path, mine) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let text = await readText(path);
    if (text === undefined) continue; // released meanwhile
    let owner = parseInfo(text);
    if (!owner) {
      // Created a moment ago and not written yet, or garbage.
      await sleep(150);
      text = await readText(path);
      if (text === undefined) continue;
      owner = parseInfo(text);
    }
    if (owner && !isStale(owner)) {
      if (Date.now() >= deadline) return { ok: false, owner, path };
      await sleep(200);
      continue;
    }
    if (++takeovers > 5) throw new Error(`Could not lock the data directory (${path}).`);
    // Stale or unreadable: take it over, unless another process replaced it meanwhile.
    if ((await readText(path)) === text) await rm(path, { force: true });
  }
}

function lockHandle(path: string, info: InstanceInfo): InstanceLock {
  let current = info;
  let released = false;
  const ours = async () => {
    const owner = parseInfo(await readText(path));
    return owner?.pid === info.pid && owner.startedAt === info.startedAt;
  };
  return {
    path,
    async setUrl(url) {
      if (released) return;
      current = { ...current, url };
      if (await ours()) await writeFileAtomic(path, serialize(current));
    },
    async release() {
      if (released) return;
      released = true;
      if (await ours()) await rm(path, { force: true });
    },
  };
}
