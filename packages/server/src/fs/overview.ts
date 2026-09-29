/**
 * Per-workspace cache of scan results (overview + rendered prompt tree). Entries live 5 minutes,
 * are keyed by the folder list (a folder change never serves stale data) and concurrent requests
 * share one scan. Failed scans are not cached.
 */
import type { Workspace, WorkspaceOverview } from '@codesplainer/shared';
import { scanWorkspace, type ScanOptions } from './scan';
import { renderCompactTree } from './tree';

export const OVERVIEW_TTL_MS = 5 * 60 * 1000;

export interface CachedScan {
  overview: WorkspaceOverview;
  tree: string;
}

interface Entry {
  key: string;
  at: number;
  value: Promise<CachedScan>;
}

export class OverviewCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = OVERVIEW_TTL_MS,
    private readonly scanOptions: ScanOptions = {},
  ) {}

  private keyOf(workspace: Workspace): string {
    return JSON.stringify(workspace.folders.map((f) => [f.alias, f.path]));
  }

  get(workspace: Workspace, opts: { refresh?: boolean } = {}): Promise<CachedScan> {
    const key = this.keyOf(workspace);
    const hit = this.entries.get(workspace.id);
    if (hit && !opts.refresh && hit.key === key && Date.now() - hit.at < this.ttlMs) {
      return hit.value;
    }
    const value = scanWorkspace(workspace, this.scanOptions).then((scan) => ({
      overview: scan.overview,
      tree: renderCompactTree(scan.folders),
    }));
    const entry: Entry = { key, at: Date.now(), value };
    this.entries.set(workspace.id, entry);
    value.catch(() => {
      if (this.entries.get(workspace.id) === entry) this.entries.delete(workspace.id);
    });
    return value;
  }

  async overview(
    workspace: Workspace,
    opts: { refresh?: boolean } = {},
  ): Promise<WorkspaceOverview> {
    return (await this.get(workspace, opts)).overview;
  }

  async tree(workspace: Workspace, opts: { refresh?: boolean } = {}): Promise<string> {
    return (await this.get(workspace, opts)).tree;
  }

  invalidate(workspaceId: string): void {
    this.entries.delete(workspaceId);
  }
}
