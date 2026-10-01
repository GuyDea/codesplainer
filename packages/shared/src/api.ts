/**
 * HTTP API contract (all JSON, base path /api). Request bodies are validated with these schemas on
 * the server; the web client uses the inferred types.
 *
 *  GET    /api/health                                   -> HealthResponse
 *  GET    /api/providers                                -> { providers: ProviderInfo[] }
 *  POST   /api/providers/refresh                        -> { providers: ProviderInfo[] }   (re-detect CLIs)
 *  POST   /api/providers/:id/test                       -> ProviderTestResponse            (tiny smoke prompt)
 *  GET    /api/settings                                 -> Settings
 *  PUT    /api/settings        SettingsPatch            -> Settings
 *
 *  GET    /api/fs/browse?path=<abs>&hidden=0|1          -> BrowseResult  (directories only; default = home)
 *  POST   /api/fs/check        FsCheckBody              -> FsCheckResponse
 *  POST   /api/fs/pick-folder                           -> { paths: string[] }  (native dialog if available; [] if cancelled/unsupported)
 *
 *  GET    /api/workspaces                               -> { workspaces: Workspace[] }
 *  POST   /api/workspaces      CreateWorkspaceBody      -> Workspace
 *  GET    /api/workspaces/:id                           -> Workspace
 *  PATCH  /api/workspaces/:id  UpdateWorkspaceBody      -> Workspace
 *  DELETE /api/workspaces/:id                           -> { ok: true }   (also deletes its conversations)
 *  GET    /api/workspaces/:id/overview?refresh=0|1      -> WorkspaceOverview
 *  GET    /api/workspaces/:id/dir?folder=&path=         -> DirListing
 *  GET    /api/workspaces/:id/file?folder=&path=        -> FileContent
 *  POST   /api/workspaces/:id/open  OpenInEditorBody    -> { ok: true, command: string }
 *
 *  GET    /api/conversations?workspaceId=               -> { conversations: ConversationSummary[] }
 *  POST   /api/conversations   CreateConversationBody   -> Conversation
 *  GET    /api/conversations/:id                        -> Conversation
 *  PATCH  /api/conversations/:id  UpdateConversationBody -> Conversation
 *  DELETE /api/conversations/:id                        -> { ok: true }
 *  POST   /api/conversations/:id/duplicate              -> Conversation
 *  POST   /api/conversations/:id/ask  AskBody           -> { graph: GraphEntry }
 *  POST   /api/conversations/:id/graphs/:gid/retry  RetryBody -> { graph: GraphEntry }
 *  POST   /api/conversations/:id/graphs/:gid/cancel     -> { graph: GraphEntry }
 *  PATCH  /api/conversations/:id/graphs/:gid  UpdateGraphBody -> { graph: GraphEntry }
 *  DELETE /api/conversations/:id/graphs/:gid            -> { deleted: string[] }  (graph + descendants)
 *  GET    /api/conversations/:id/graphs/:gid/activity   -> { activity: ActivityItem[] }  (full live log)
 *  GET    /api/conversations/:id/graphs/:gid/raw        -> RawOutputResponse
 *  GET    /api/conversations/:id/export?format=json|md  -> file download (ConversationExport | markdown)
 *  GET    /api/workspaces/:id/export                    -> file download (WorkspaceBundle)
 *  POST   /api/import          ImportBody               -> ImportResponse
 *
 *  GET    /api/events                                   -> text/event-stream of ServerEvent (see events.ts)
 *
 * Errors: non-2xx with body ApiError.
 *
 * Security (local-only server, no accounts): requests must carry a localhost Host header, a
 * same-origin Origin header when present, and every non-GET/HEAD request must send
 * `x-codesplainer: 1` (blocks cross-site form posts / CSRF). Downloads are fetched with that header
 * and saved client-side as blobs.
 */
export const CLIENT_HEADER = 'x-codesplainer';
export const CLIENT_HEADER_VALUE = '1';
/** Default port of the local server. */
export const DEFAULT_PORT = 4777;
import { z } from 'zod';
import { graphOriginSchema, type Conversation, type GraphEntry } from './conversation';
import { DETAIL_LEVELS } from './kinds';
import { effortSchema, providerIdSchema, type ProviderInfo } from './providers';
import type { Workspace } from './workspace';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export interface HealthResponse {
  ok: true;
  name: string;
  version: string;
  dataDir: string;
  pid: number;
  /** process.platform of the server ("linux", "darwin", "win32"). */
  platform: string;
  homeDir: string;
  /** A native "choose folder" dialog is available (desktop app, or zenity/kdialog/osascript/powershell). */
  nativePicker: boolean;
  /** Folders passed on the command line resolved to this workspace (open it on first load). */
  startupWorkspaceId?: string;
}

export interface RawOutputResponse {
  /** Last raw agent answer saved for this diagram (only kept for failed/repaired runs). */
  text: string | null;
}

export interface ProviderTestResponse {
  ok: boolean;
  provider: ProviderInfo['id'];
  durationMs: number;
  message: string;
  output?: string;
}

export const fsCheckBodySchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(50),
});
export type FsCheckBody = z.infer<typeof fsCheckBodySchema>;
export interface FsCheckResponse {
  results: Record<
    string,
    { exists: boolean; isDir: boolean; readable: boolean; realPath?: string }
  >;
}

export const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  folders: z.array(z.string().min(1)).min(1).max(20),
});
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const updateWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  folders: z.array(z.string().min(1)).min(1).max(20).optional(),
});
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceBodySchema>;

export const openInEditorBodySchema = z.object({
  folder: z.string().min(1),
  path: z.string(),
  line: z.number().int().positive().optional(),
});
export type OpenInEditorBody = z.infer<typeof openInEditorBodySchema>;

export const createConversationBodySchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;

export const updateConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});
export type UpdateConversationBody = z.infer<typeof updateConversationBodySchema>;

/**
 * Ask a question / expand a node. For `expand` the question may be empty (the server fills in
 * "Expand: <label>"); `nodeLabel` in the origin may be empty (the server fills it from the parent).
 */
export const askBodySchema = z.object({
  question: z.string().trim().max(4000).default(''),
  origin: graphOriginSchema,
  provider: providerIdSchema.optional(),
  model: z.string().optional(),
  detail: z.enum(DETAIL_LEVELS).optional(),
  /** Reasoning effort for this run ('' or absent = the provider setting). */
  effort: effortSchema.optional(),
  /** Fast tier for this run (absent = the provider setting). */
  fast: z.boolean().optional(),
});
export type AskBody = z.input<typeof askBodySchema>;

export const retryBodySchema = z.object({
  provider: providerIdSchema.optional(),
  model: z.string().optional(),
  detail: z.enum(DETAIL_LEVELS).optional(),
  effort: effortSchema.optional(),
  fast: z.boolean().optional(),
  /** Do not fork the parent's agent session (fresh exploration). */
  fresh: z.boolean().optional(),
});
export type RetryBody = z.infer<typeof retryBodySchema>;

export const updateGraphBodySchema = z.object({
  /** Rename the diagram (sets spec.title). */
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(10_000).optional(),
  starred: z.boolean().optional(),
});
export type UpdateGraphBody = z.infer<typeof updateGraphBodySchema>;

export const importBodySchema = z.object({
  /** A ConversationExport or WorkspaceBundle (see exchange.ts). */
  data: z.unknown(),
  /** Import into this workspace. When omitted a workspace is created from the export's folders. */
  workspaceId: z.string().optional(),
  /** Map exported folder aliases to local absolute paths (used when creating a workspace). */
  folderMap: z.record(z.string(), z.string()).optional(),
  workspaceName: z.string().trim().min(1).max(120).optional(),
});
export type ImportBody = z.infer<typeof importBodySchema>;

export interface ImportResponse {
  workspace: Workspace;
  conversations: Conversation[];
}

export interface AskResponse {
  graph: GraphEntry;
}
