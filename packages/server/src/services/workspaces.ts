/**
 * Workspace management: folder normalization, aliases, default names, "last opened" tracking
 * (throttled) and cascading deletes.
 */
import { isAbsolute } from 'node:path';
import {
  baseName,
  makeFolderAliases,
  truncate,
  type CreateWorkspaceBody,
  type UpdateWorkspaceBody,
  type Workspace,
  type WorkspaceFolder,
} from '@codesplainer/shared';
import { LAST_OPENED_THROTTLE_MS } from '../constants';
import { notFound } from '../errors';
import type { EventBus } from '../events';
import type { OverviewCache } from '../fs/overview';
import {
  cleanUserPath,
  normalizeFolderPath,
  normalizeFolderPaths,
  pathKey,
  samePathSet,
} from '../fs/paths';
import { newId } from '../ids';
import type { WorkspaceStore } from '../storage/workspaces';
import { ageMs, laterIso, nowIso } from '../time';
import type { ConversationService } from './conversations';

export interface WorkspaceDeps {
  workspaces: WorkspaceStore;
  conversations: ConversationService;
  overview: OverviewCache;
  bus: EventBus;
}

/** "api" for one folder, "api +2" for three. */
export function defaultWorkspaceName(paths: readonly string[]): string {
  const first = paths[0] ?? 'Workspace';
  const name = baseName(first) || first;
  return truncate(paths.length > 1 ? `${name} +${paths.length - 1}` : name, 120);
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceDeps) {}

  list(): Workspace[] {
    return this.deps.workspaces.list();
  }

  get(id: string): Workspace {
    const workspace = this.deps.workspaces.get(id);
    if (!workspace) throw notFound('Workspace');
    return workspace;
  }

  /** GET /api/workspaces/:id: also records the visit (at most once per minute). */
  async open(id: string): Promise<Workspace> {
    const workspace = this.get(id);
    if (ageMs(workspace.lastOpenedAt) < LAST_OPENED_THROTTLE_MS) return workspace;
    const next: Workspace = { ...workspace, lastOpenedAt: laterIso(workspace.lastOpenedAt) };
    await this.deps.workspaces.put(next);
    this.deps.bus.emit({ type: 'workspace.updated', workspace: next });
    return next;
  }

  /** A workspace with exactly these folders (order ignored). */
  findByPaths(paths: readonly string[]): Workspace | undefined {
    return this.list().find((w) =>
      samePathSet(
        w.folders.map((f) => f.path),
        paths,
      ),
    );
  }

  async create(body: CreateWorkspaceBody, opts: { base?: string } = {}): Promise<Workspace> {
    const paths = await normalizeFolderPaths(body.folders, opts);
    const aliases = makeFolderAliases(paths);
    const now = nowIso();
    const workspace: Workspace = {
      id: newId(),
      name: body.name ?? defaultWorkspaceName(paths),
      folders: paths.map((path, i) => ({ alias: aliases[i] as string, path })),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await this.deps.workspaces.put(workspace);
    this.deps.bus.emit({ type: 'workspace.updated', workspace });
    return workspace;
  }

  /** Folders passed on the command line: reuse a workspace with the same folders or create one. */
  async openOrCreate(folders: readonly string[], base: string): Promise<Workspace> {
    const paths = await normalizeFolderPaths(folders, { base });
    const existing = this.findByPaths(paths);
    if (existing) return this.open(existing.id);
    return this.create({ folders: paths });
  }

  /**
   * Folder paths for PATCH: folders the workspace already has are kept as they are (even when
   * missing on disk, e.g. after importing from another machine) so the user can fix the others;
   * new paths are validated and normalized.
   */
  private async updatedPaths(current: Workspace, inputs: readonly string[]): Promise<string[]> {
    const known = new Map(current.folders.map((f) => [pathKey(f.path), f.path]));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      const cleaned = cleanUserPath(input);
      const same = isAbsolute(cleaned) ? known.get(pathKey(cleaned)) : undefined;
      const path = same ?? (await normalizeFolderPath(input));
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(path);
    }
    return out;
  }

  async update(id: string, body: UpdateWorkspaceBody): Promise<Workspace> {
    const current = this.get(id);
    let folders: WorkspaceFolder[] = current.folders;
    if (body.folders) {
      const paths = await this.updatedPaths(current, body.folders);
      const byPath = new Map(current.folders.map((f) => [pathKey(f.path), f]));
      const kept = paths.map((p) => byPath.get(pathKey(p)));
      const keptAliases = kept.filter((f): f is WorkspaceFolder => !!f).map((f) => f.alias);
      const fresh = makeFolderAliases(
        paths.filter((_, i) => !kept[i]),
        keptAliases,
      );
      let next = 0;
      folders = paths.map((path, i) => {
        const same = kept[i];
        return same
          ? { alias: same.alias, path: same.path }
          : { alias: fresh[next++] as string, path };
      });
    }
    const latest = this.get(id);
    const workspace: Workspace = {
      ...latest,
      name: body.name ?? latest.name,
      folders,
      updatedAt: laterIso(latest.updatedAt),
    };
    await this.deps.workspaces.put(workspace);
    if (body.folders) this.deps.overview.invalidate(id);
    this.deps.bus.emit({ type: 'workspace.updated', workspace });
    return workspace;
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    await this.deps.conversations.removeForWorkspace(id);
    await this.deps.workspaces.delete(id);
    this.deps.overview.invalidate(id);
    this.deps.bus.emit({ type: 'workspace.deleted', workspaceId: id });
  }
}
