/**
 * Export (conversation JSON / Markdown, workspace bundle) and import of Codesplainer files.
 *
 * Import target: an explicit workspaceId; else an existing workspace whose folders equal the
 * exported ones (after folderMap); else a new workspace built from the exported folders (paths
 * that do not exist here are allowed; exported aliases are kept). Exported aliases are mapped to
 * the target's aliases (same alias, same path, else by position) and refs are rewritten.
 */
import { isAbsolute, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import {
  conversationToMarkdown,
  exportFileName,
  importedConversations,
  makeFolderAliases,
  parseImportPayload,
  toConversationExport,
  toWorkspaceBundle,
  truncate,
  type Conversation,
  type ExportedWorkspace,
  type ImportBody,
  type ImportResponse,
  type Workspace,
  type WorkspaceFolder,
} from '@codesplainer/shared';
import { badRequest, notFound } from '../errors';
import type { EventBus } from '../events';
import { cleanUserPath, pathKey } from '../fs/paths';
import { newId } from '../ids';
import type { ConversationStore } from '../storage/conversations';
import type { WorkspaceStore } from '../storage/workspaces';
import { nowIso } from '../time';
import { copyConversation } from './copy';
import { defaultWorkspaceName, type WorkspaceService } from './workspaces';

export interface ExchangeDeps {
  conversations: ConversationStore;
  workspaces: WorkspaceStore;
  workspaceService: WorkspaceService;
  bus: EventBus;
}

export interface Download {
  filename: string;
  contentType: string;
  body: string;
}

/** Local form of an exported/mapped folder path (real path when it exists here). */
function localPath(raw: string): string {
  const cleaned = cleanUserPath(raw);
  if (!cleaned || cleaned.includes('\0') || !isAbsolute(cleaned)) {
    throw badRequest(`Folder path must be absolute: ${raw}`);
  }
  const abs = resolve(cleaned);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Exported alias -> alias of `target` (same alias, else same path, else same position). */
export function mapAliases(
  exported: readonly WorkspaceFolder[],
  target: readonly WorkspaceFolder[],
  mappedPaths: readonly string[] = [],
): Map<string, string> {
  const map = new Map<string, string>();
  exported.forEach((f, i) => {
    const byAlias =
      target.find((t) => t.alias === f.alias) ??
      target.find((t) => t.alias.toLowerCase() === f.alias.toLowerCase());
    const mapped = mappedPaths[i];
    const byPath = mapped ? target.find((t) => pathKey(t.path) === pathKey(mapped)) : undefined;
    const local = byAlias ?? byPath ?? target[i] ?? target[0];
    if (local) map.set(f.alias, local.alias);
  });
  return map;
}

export class ExchangeService {
  constructor(private readonly deps: ExchangeDeps) {}

  private conversation(id: string): Conversation {
    const conv = this.deps.conversations.get(id);
    if (!conv) throw notFound('Conversation');
    return conv;
  }

  exportConversation(id: string, format: 'json' | 'md'): Download {
    const conv = this.conversation(id);
    const workspace = this.deps.workspaces.get(conv.workspaceId);
    const ws = workspace ?? { name: 'Workspace', folders: [] };
    if (format === 'md') {
      return {
        filename: exportFileName(conv.title, 'md'),
        contentType: 'text/markdown; charset=utf-8',
        body: conversationToMarkdown(conv, workspace ? { workspace } : {}),
      };
    }
    if (!ws.folders.length) throw notFound('Workspace');
    return {
      filename: exportFileName(conv.title, 'json'),
      contentType: 'application/json; charset=utf-8',
      body: `${JSON.stringify(toConversationExport(conv, ws), null, 2)}\n`,
    };
  }

  exportWorkspace(id: string): Download {
    const workspace = this.deps.workspaces.get(id);
    if (!workspace) throw notFound('Workspace');
    const list = this.deps.conversations
      .list(id)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return {
      filename: exportFileName(workspace.name, 'json'),
      contentType: 'application/json; charset=utf-8',
      body: `${JSON.stringify(toWorkspaceBundle(list, workspace), null, 2)}\n`,
    };
  }

  private async targetWorkspace(
    body: ImportBody,
    exported: ExportedWorkspace,
  ): Promise<{ workspace: Workspace; aliasMap: Map<string, string>; created: boolean }> {
    if (body.workspaceId) {
      const workspace = this.deps.workspaces.get(body.workspaceId);
      if (!workspace) throw notFound('Workspace');
      const mapped = exported.folders.map((f) => {
        try {
          return localPath(body.folderMap?.[f.alias] ?? f.path);
        } catch {
          return '';
        }
      });
      return {
        workspace,
        aliasMap: mapAliases(exported.folders, workspace.folders, mapped),
        created: false,
      };
    }
    const mapped = exported.folders.map((f) => localPath(body.folderMap?.[f.alias] ?? f.path));
    const existing = this.deps.workspaceService.findByPaths(mapped);
    if (existing) {
      return {
        workspace: existing,
        aliasMap: mapAliases(exported.folders, existing.folders, mapped),
        created: false,
      };
    }
    // Keep the exported aliases (made unique again in case the file was edited by hand).
    const seenPaths = new Set<string>();
    const usedAliases: string[] = [];
    const folders: WorkspaceFolder[] = [];
    exported.folders.forEach((f, i) => {
      const path = mapped[i] as string;
      if (seenPaths.has(pathKey(path))) return;
      seenPaths.add(pathKey(path));
      const taken = usedAliases.some((a) => a.toLowerCase() === f.alias.toLowerCase());
      const alias = taken ? (makeFolderAliases([f.alias], usedAliases)[0] as string) : f.alias;
      usedAliases.push(alias);
      folders.push({ alias, path });
    });
    const now = nowIso();
    const workspace: Workspace = {
      id: newId(),
      name: truncate(body.workspaceName ?? exported.name, 120) || defaultWorkspaceName(mapped),
      folders,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await this.deps.workspaces.put(workspace);
    const aliasMap = new Map<string, string>();
    exported.folders.forEach((f, i) => {
      const hit = folders.find((x) => pathKey(x.path) === pathKey(mapped[i] as string));
      if (hit) aliasMap.set(f.alias, hit.alias);
    });
    return { workspace, aliasMap, created: true };
  }

  async import(body: ImportBody): Promise<ImportResponse> {
    const parsed = parseImportPayload(body.data);
    if (!parsed.ok) throw badRequest(parsed.error);
    const exported = parsed.payload.data.workspace;
    const { workspace, aliasMap, created } = await this.targetWorkspace(body, exported);
    if (created) this.deps.bus.emit({ type: 'workspace.updated', workspace });
    const imported: Conversation[] = [];
    for (const source of importedConversations(parsed.payload)) {
      const copy = copyConversation(source, {
        workspaceId: workspace.id,
        aliasMap,
        pendingError: 'Not finished when exported.',
      });
      await this.deps.conversations.add(copy);
      this.deps.bus.conversationUpdated(copy);
      imported.push(copy);
    }
    return { workspace, conversations: imported };
  }
}
