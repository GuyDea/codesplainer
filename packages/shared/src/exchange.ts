import { z } from 'zod';
import { conversationSchema, isPending, stripGraphEntry, type Conversation } from './conversation';
import { APP_NAME, APP_VERSION } from './version';
import { workspaceFolderSchema, type Workspace } from './workspace';

/**
 * Portable files for sharing conversations.
 * - ConversationExport: one conversation ("*.codesplainer.json")
 * - WorkspaceBundle: every conversation of a workspace
 * Agent sessions and activity logs are machine specific and stripped on export.
 */

export const CONVERSATION_EXPORT_FORMAT = 'codesplainer/conversation';
export const WORKSPACE_BUNDLE_FORMAT = 'codesplainer/bundle';
export const EXPORT_VERSION = 1;

const exportedWorkspaceSchema = z.object({
  name: z.string(),
  folders: z.array(workspaceFolderSchema).min(1),
});
export type ExportedWorkspace = z.infer<typeof exportedWorkspaceSchema>;

const appInfoSchema = z.object({ name: z.string(), version: z.string() });

export const conversationExportSchema = z.object({
  format: z.literal(CONVERSATION_EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  app: appInfoSchema,
  workspace: exportedWorkspaceSchema,
  conversation: conversationSchema,
});
export type ConversationExport = z.infer<typeof conversationExportSchema>;

export const workspaceBundleSchema = z.object({
  format: z.literal(WORKSPACE_BUNDLE_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  app: appInfoSchema,
  workspace: exportedWorkspaceSchema,
  conversations: z.array(conversationSchema),
});
export type WorkspaceBundle = z.infer<typeof workspaceBundleSchema>;

export type ImportPayload =
  { kind: 'conversation'; data: ConversationExport } | { kind: 'bundle'; data: WorkspaceBundle };

function exportableConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    graphs: conversation.graphs.map((g) => {
      const entry = stripGraphEntry(g);
      if (isPending(entry.status)) {
        entry.status = 'cancelled';
        entry.error = 'Not finished when exported.';
      }
      return entry;
    }),
  };
}

function exportedWorkspace(workspace: Pick<Workspace, 'name' | 'folders'>): ExportedWorkspace {
  return {
    name: workspace.name,
    folders: workspace.folders.map((f) => ({ alias: f.alias, path: f.path })),
  };
}

export function toConversationExport(
  conversation: Conversation,
  workspace: Pick<Workspace, 'name' | 'folders'>,
  now = new Date(),
): ConversationExport {
  return {
    format: CONVERSATION_EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    app: { name: APP_NAME, version: APP_VERSION },
    workspace: exportedWorkspace(workspace),
    conversation: exportableConversation(conversation),
  };
}

export function toWorkspaceBundle(
  conversations: Conversation[],
  workspace: Pick<Workspace, 'name' | 'folders'>,
  now = new Date(),
): WorkspaceBundle {
  return {
    format: WORKSPACE_BUNDLE_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    app: { name: APP_NAME, version: APP_VERSION },
    workspace: exportedWorkspace(workspace),
    conversations: conversations.map(exportableConversation),
  };
}

/** Validate an uploaded file (already JSON-parsed). */
export function parseImportPayload(
  raw: unknown,
): { ok: true; payload: ImportPayload } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null)
    return { ok: false, error: 'File is not a JSON object.' };
  const format = (raw as { format?: unknown }).format;
  if (format === CONVERSATION_EXPORT_FORMAT) {
    const r = conversationExportSchema.safeParse(raw);
    return r.success
      ? { ok: true, payload: { kind: 'conversation', data: r.data } }
      : { ok: false, error: `Invalid conversation file: ${z.prettifyError(r.error)}` };
  }
  if (format === WORKSPACE_BUNDLE_FORMAT) {
    const r = workspaceBundleSchema.safeParse(raw);
    return r.success
      ? { ok: true, payload: { kind: 'bundle', data: r.data } }
      : { ok: false, error: `Invalid bundle file: ${z.prettifyError(r.error)}` };
  }
  return { ok: false, error: 'Not a Codesplainer export (unknown "format").' };
}

export function importedConversations(payload: ImportPayload): Conversation[] {
  return payload.kind === 'conversation' ? [payload.data.conversation] : payload.data.conversations;
}

/** Suggested download file name. */
export function exportFileName(title: string, ext: 'json' | 'md' = 'json'): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'conversation';
  return ext === 'json' ? `${base}.codesplainer.json` : `${base}.md`;
}
