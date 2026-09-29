/**
 * Crash-safe JSON files: writes go to a temp file in the same directory, are fsynced and renamed
 * over the target (readers never see half-written files). Operations on one path are serialized.
 * A file that cannot be parsed is moved aside as `<name>.corrupt-<timestamp>` and the caller
 * starts fresh (with a warning) instead of refusing to start.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, copyFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { Logger } from '../log';

const chains = new Map<string, Promise<unknown>>();

/** Run `op` after every earlier operation queued for the same path has settled. */
export function serialized<T>(path: string, op: () => Promise<T>): Promise<T> {
  const previous = chains.get(path) ?? Promise.resolve();
  const next = previous.then(op, op);
  chains.set(path, next);
  const cleanup = () => {
    if (chains.get(path) === next) chains.delete(path);
  };
  next.then(cleanup, cleanup);
  return next;
}

/** Resolves when all operations queued so far for `path` have settled. */
export async function settled(path: string): Promise<void> {
  await (chains.get(path) ?? Promise.resolve()).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** rename() with a few retries: Windows reports EPERM/EBUSY while another process reads. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw e;
      await sleep(20 * (attempt + 1));
    }
  }
}

/** Write `data` to `path` atomically (not serialized; see writeFileSerialized). */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } catch (e) {
    await handle.close().catch(() => undefined);
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  await handle.close();
  try {
    await renameWithRetry(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Atomic write, serialized with other operations on the same path. */
export function writeFileSerialized(path: string, data: string): Promise<void> {
  return serialized(path, () => writeFileAtomic(path, data));
}

export function writeJsonSerialized(path: string, value: unknown, pretty = true): Promise<void> {
  const text = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  return writeFileSerialized(path, text);
}

/** Delete a file, serialized with writes to it (missing files are fine). */
export function removeFileSerialized(path: string): Promise<void> {
  return serialized(path, () => rm(path, { force: true }));
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Move a broken file out of the way. Returns the new path (undefined when that failed too). */
export async function quarantine(path: string): Promise<string | undefined> {
  const target = `${path}.corrupt-${stamp()}`;
  try {
    await renameWithRetry(path, target);
    return target;
  } catch {
    return undefined;
  }
}

/** Keep a copy of a file that is only partially usable (the original is rewritten later). */
export async function backup(path: string): Promise<string | undefined> {
  const target = `${path}.corrupt-${stamp()}`;
  try {
    await copyFile(path, target);
    return target;
  } catch {
    return undefined;
  }
}

/**
 * Read and parse a JSON file. Missing file -> undefined. Unparseable JSON or a `parse` callback
 * that throws -> the file is quarantined, a warning is logged and undefined is returned.
 */
export async function loadJsonFile<T>(
  path: string,
  parse: (raw: unknown) => T,
  log: Logger,
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  let reason: string;
  try {
    if (!text.trim()) throw new Error('the file is empty');
    return parse(JSON.parse(text) as unknown);
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }
  const moved = await quarantine(path);
  log.warn(
    `${basename(path)} is corrupted (${reason.split('\n')[0]}); ` +
      (moved ? `moved it to ${basename(moved)} and started fresh.` : 'starting fresh.'),
  );
  return undefined;
}
