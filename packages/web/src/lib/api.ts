/**
 * Typed client for the local Codesplainer server (see packages/shared/src/api.ts for the contract).
 * - JSON in / JSON out, base path /api (proxied to the server by Vite in dev).
 * - Every non-GET request carries the CSRF guard header `x-codesplainer: 1`.
 * - Non-2xx responses become ApiRequestError(status, code, message).
 */
import {
  apiErrorSchema,
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  type ActivityItem,
  type AskBody,
  type AskResponse,
  type BrowseResult,
  type Conversation,
  type ConversationSummary,
  type CreateConversationBody,
  type CreateWorkspaceBody,
  type DirListing,
  type FileContent,
  type FsCheckResponse,
  type GraphEntry,
  type HealthResponse,
  type ImportBody,
  type ImportResponse,
  type OpenInEditorBody,
  type ProviderId,
  type ProviderInfo,
  type ProviderTestResponse,
  type RawOutputResponse,
  type RetryBody,
  type Settings,
  type SettingsPatch,
  type UpdateConversationBody,
  type UpdateGraphBody,
  type UpdateWorkspaceBody,
  type Workspace,
  type WorkspaceOverview,
} from '@codesplainer/shared';
import { saveBlob } from './download';

export const API_BASE = '/api';

/** Error raised for failed API calls. status 0 = the server could not be reached. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The server is down / unreachable (or the dev proxy could not reach it). */
  get unreachable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export const NETWORK_ERROR_MESSAGE = "Can't reach the Codesplainer server.";

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

/** Human readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  return 'Unexpected error.';
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Build an /api URL. Booleans become 1/0, null/undefined values are skipped. */
export function apiUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

/** Turn a failed response into an ApiRequestError (reads the ApiError body when present). */
export async function toApiError(res: Response): Promise<ApiRequestError> {
  let code = `http_${res.status}`;
  let message = res.statusText || `Request failed (${res.status}).`;
  let details: unknown;
  try {
    const text = await res.text();
    if (text) {
      const json: unknown = JSON.parse(text);
      const parsed = apiErrorSchema.safeParse(json);
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        details = parsed.data.error.details;
      } else if (typeof json === 'object' && json !== null) {
        // Fastify's default error shape: { statusCode, code?, error, message }.
        const loose = json as { message?: unknown; code?: unknown };
        if (typeof loose.message === 'string' && loose.message) message = loose.message;
        if (typeof loose.code === 'string' && loose.code) code = loose.code;
      }
    }
  } catch {
    // Not JSON: keep the status based message.
  }
  if (res.status >= 502 && res.status <= 504 && code.startsWith('http_')) {
    message = NETWORK_ERROR_MESSAGE;
  }
  return new ApiRequestError(res.status, code, message, details);
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/** Low-level JSON request. */
export async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: string | undefined;
  if (method !== 'GET') {
    headers[CLIENT_HEADER] = CLIENT_HEADER_VALUE;
    // Fastify rejects an empty body declared as JSON, and DELETE carries no body.
    const payload = options.body ?? (method === 'DELETE' ? undefined : {});
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(payload);
    }
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, options.query), {
      method,
      headers,
      body,
      signal: options.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiRequestError(0, 'network', NETWORK_ERROR_MESSAGE);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiRequestError(
      res.status,
      'invalid_response',
      'The server sent an invalid response.',
    );
  }
}

const seg = (value: string) => encodeURIComponent(value);

export const api = {
  // ---- meta ----
  health: (signal?: AbortSignal) => request<HealthResponse>('GET', '/health', { signal }),

  // ---- providers ----
  listProviders: () => request<{ providers: ProviderInfo[] }>('GET', '/providers'),
  refreshProviders: () => request<{ providers: ProviderInfo[] }>('POST', '/providers/refresh'),
  testProvider: (id: ProviderId) =>
    request<ProviderTestResponse>('POST', `/providers/${seg(id)}/test`),

  // ---- settings ----
  getSettings: () => request<Settings>('GET', '/settings'),
  updateSettings: (patch: SettingsPatch) => request<Settings>('PUT', '/settings', { body: patch }),

  // ---- local filesystem (folder picker) ----
  browse: (path?: string, hidden?: boolean, signal?: AbortSignal) =>
    request<BrowseResult>('GET', '/fs/browse', {
      query: { path: path || undefined, hidden: hidden ?? false },
      signal,
    }),
  checkPaths: (paths: string[]) =>
    request<FsCheckResponse>('POST', '/fs/check', { body: { paths } }),
  pickFolder: () => request<{ paths: string[] }>('POST', '/fs/pick-folder'),

  // ---- workspaces ----
  listWorkspaces: () => request<{ workspaces: Workspace[] }>('GET', '/workspaces'),
  createWorkspace: (body: CreateWorkspaceBody) =>
    request<Workspace>('POST', '/workspaces', { body }),
  getWorkspace: (id: string) => request<Workspace>('GET', `/workspaces/${seg(id)}`),
  updateWorkspace: (id: string, body: UpdateWorkspaceBody) =>
    request<Workspace>('PATCH', `/workspaces/${seg(id)}`, { body }),
  deleteWorkspace: (id: string) => request<{ ok: true }>('DELETE', `/workspaces/${seg(id)}`),
  getOverview: (id: string, refresh = false, signal?: AbortSignal) =>
    request<WorkspaceOverview>('GET', `/workspaces/${seg(id)}/overview`, {
      query: { refresh },
      signal,
    }),
  listDir: (id: string, folder: string, path: string) =>
    request<DirListing>('GET', `/workspaces/${seg(id)}/dir`, { query: { folder, path } }),
  readFile: (id: string, folder: string, path: string, signal?: AbortSignal) =>
    request<FileContent>('GET', `/workspaces/${seg(id)}/file`, {
      query: { folder, path },
      signal,
    }),
  openInEditor: (id: string, body: OpenInEditorBody) =>
    request<{ ok: true; command: string }>('POST', `/workspaces/${seg(id)}/open`, { body }),
  workspaceExportUrl: (id: string) => apiUrl(`/workspaces/${seg(id)}/export`),

  // ---- conversations ----
  listConversations: (workspaceId: string) =>
    request<{ conversations: ConversationSummary[] }>('GET', '/conversations', {
      query: { workspaceId },
    }),
  createConversation: (body: CreateConversationBody) =>
    request<Conversation>('POST', '/conversations', { body }),
  getConversation: (id: string, signal?: AbortSignal) =>
    request<Conversation>('GET', `/conversations/${seg(id)}`, { signal }),
  updateConversation: (id: string, body: UpdateConversationBody) =>
    request<Conversation>('PATCH', `/conversations/${seg(id)}`, { body }),
  deleteConversation: (id: string) => request<{ ok: true }>('DELETE', `/conversations/${seg(id)}`),
  duplicateConversation: (id: string) =>
    request<Conversation>('POST', `/conversations/${seg(id)}/duplicate`),
  ask: (id: string, body: AskBody) =>
    request<AskResponse>('POST', `/conversations/${seg(id)}/ask`, { body }),
  retryGraph: (id: string, graphId: string, body: RetryBody = {}) =>
    request<{ graph: GraphEntry }>(
      'POST',
      `/conversations/${seg(id)}/graphs/${seg(graphId)}/retry`,
      { body },
    ),
  cancelGraph: (id: string, graphId: string) =>
    request<{ graph: GraphEntry }>(
      'POST',
      `/conversations/${seg(id)}/graphs/${seg(graphId)}/cancel`,
    ),
  updateGraph: (id: string, graphId: string, body: UpdateGraphBody) =>
    request<{ graph: GraphEntry }>('PATCH', `/conversations/${seg(id)}/graphs/${seg(graphId)}`, {
      body,
    }),
  deleteGraph: (id: string, graphId: string) =>
    request<{ deleted: string[] }>('DELETE', `/conversations/${seg(id)}/graphs/${seg(graphId)}`),
  getActivity: (id: string, graphId: string) =>
    request<{ activity: ActivityItem[] }>(
      'GET',
      `/conversations/${seg(id)}/graphs/${seg(graphId)}/activity`,
    ),
  getRawOutput: (id: string, graphId: string) =>
    request<RawOutputResponse>('GET', `/conversations/${seg(id)}/graphs/${seg(graphId)}/raw`),
  conversationExportUrl: (id: string, format: 'json' | 'md') =>
    apiUrl(`/conversations/${seg(id)}/export`, { format }),

  // ---- import ----
  importData: (body: ImportBody) => request<ImportResponse>('POST', '/import', { body }),
};

export type Api = typeof api;

/** Extract a file name from a Content-Disposition header (RFC 6266, incl. filename*). */
export function fileNameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const clean = (name: string) => name.replace(/[/\\]/g, '_').trim() || null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star?.[2]) {
    try {
      return clean(decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')));
    } catch {
      // fall through to the plain parameter
    }
  }
  const plain = /filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(header);
  if (plain) {
    const value = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2];
    return value ? clean(value) : null;
  }
  return null;
}

/**
 * Download a server file (exports). Fetched with the client header, then saved as a blob so the
 * browser never navigates to the API. Honors Content-Disposition, else uses `fallbackName`.
 */
export async function download(url: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE } });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiRequestError(0, 'network', NETWORK_ERROR_MESSAGE);
  }
  if (!res.ok) throw await toApiError(res);
  const blob = await res.blob();
  const name = fileNameFromDisposition(res.headers.get('content-disposition')) ?? fallbackName;
  saveBlob(blob, name);
  return name;
}
