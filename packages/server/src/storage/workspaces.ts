/**
 * Workspace repository: <dataDir>/workspaces.json (`{ version, workspaces: [...] }`), cached in
 * memory, rewritten atomically on every change (the file is small).
 */
import { join } from 'node:path';
import { workspaceSchema, type Workspace } from '@codesplainer/shared';
import type { Logger } from '../log';
import { backup, loadJsonFile, settled, writeJsonSerialized } from './atomic';

const FILE_VERSION = 1;

interface Parsed {
  workspaces: Workspace[];
  invalid: number;
}

function parseFile(raw: unknown): Parsed {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as { workspaces?: unknown }).workspaces)
      ? (raw as { workspaces: unknown[] }).workspaces
      : undefined;
  if (!list) throw new Error('expected { "workspaces": [...] }');
  const workspaces: Workspace[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const item of list) {
    const r = workspaceSchema.safeParse(item);
    if (!r.success || seen.has(r.data.id)) {
      invalid++;
      continue;
    }
    seen.add(r.data.id);
    workspaces.push(r.data);
  }
  return { workspaces, invalid };
}

/** Most recently used first (lastOpenedAt, else updatedAt). */
export function byRecentUse(a: Workspace, b: Workspace): number {
  const ta = a.lastOpenedAt ?? a.updatedAt;
  const tb = b.lastOpenedAt ?? b.updatedAt;
  return ta < tb ? 1 : ta > tb ? -1 : 0;
}

export class WorkspaceStore {
  private readonly items = new Map<string, Workspace>();

  private constructor(readonly path: string) {}

  static async open(dataDir: string, log: Logger): Promise<WorkspaceStore> {
    const store = new WorkspaceStore(join(dataDir, 'workspaces.json'));
    const parsed = await loadJsonFile(store.path, parseFile, log);
    for (const w of parsed?.workspaces ?? []) store.items.set(w.id, w);
    if (parsed?.invalid) {
      const copy = await backup(store.path);
      log.warn(
        `workspaces.json: skipped ${parsed.invalid} invalid workspace(s)` +
          (copy ? ` (original kept as ${copy}).` : '.'),
      );
      await store.save();
    }
    return store;
  }

  /** All workspaces, most recently used first. */
  list(): Workspace[] {
    return [...this.items.values()].sort(byRecentUse);
  }

  get(id: string): Workspace | undefined {
    return this.items.get(id);
  }

  /** Insert or replace, then persist. */
  async put(workspace: Workspace): Promise<void> {
    this.items.set(workspace.id, workspace);
    await this.save();
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.items.delete(id);
    if (existed) await this.save();
    return existed;
  }

  save(): Promise<void> {
    return writeJsonSerialized(this.path, { version: FILE_VERSION, workspaces: this.list() });
  }

  flush(): Promise<void> {
    return settled(this.path);
  }
}
