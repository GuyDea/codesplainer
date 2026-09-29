/** Data actions: call the API and fold results into the store (race-safe via reducers). */
import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  summarizeConversation,
  type AskBody,
  type Conversation,
  type CreateWorkspaceBody,
  type GraphEntry,
  type ImportBody,
  type ImportResponse,
  type ProviderId,
  type RetryBody,
  type SettingsPatch,
  type UpdateGraphBody,
  type UpdateWorkspaceBody,
  type Workspace,
} from '@codesplainer/shared';
import { api, ApiRequestError, apiUrl, errorMessage } from '../lib/api';
import {
  applyFetchedActivity,
  applyFetchedConversation,
  applyFetchedSummaries,
  applyFetchedWorkspaces,
  applyGraphResponse,
  applyGraphsDeleted,
  applySettingsPatch,
  mergePatch,
  reduceEvent,
  syncKey,
  touchedSince,
  upsertSummary,
  upsertWorkspace,
} from './reducers';
import { getState, setState } from './store';
import { reportError, setThemeLocal, toast } from './ui';

// ---- providers -------------------------------------------------------------------------------

export async function loadProviders(): Promise<void> {
  const since = getState().sync.seq;
  const { providers } = await api.listProviders();
  // A providers.updated event that arrived meanwhile is newer than this snapshot.
  setState((s) =>
    touchedSince(s.sync, syncKey.providers, since)
      ? { providersLoaded: true }
      : { providers, providersLoaded: true },
  );
}

export async function refreshProviders(): Promise<boolean> {
  try {
    const { providers } = await api.refreshProviders();
    setState({ providers, providersLoaded: true });
    return true;
  } catch (err) {
    reportError(err, "Couldn't re-detect providers");
    return false;
  }
}

export function testProvider(id: ProviderId) {
  return api.testProvider(id);
}

// ---- settings --------------------------------------------------------------------------------

function syncThemeFromSettings(): void {
  const theme = getState().settings?.theme;
  if (theme && theme !== getState().theme) setThemeLocal(theme);
}

export async function loadSettings(): Promise<void> {
  const since = getState().sync.seq;
  const settings = await api.getSettings();
  setState((s) =>
    touchedSince(s.sync, syncKey.settings, since) && s.settings
      ? {}
      : { settings: applySettingsPatch(settings, s.settingsPending) },
  );
  syncThemeFromSettings();
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
let pendingVersion = 0;
const SETTINGS_DEBOUNCE_MS = 450;

/** Optimistically apply a deep-partial patch and save it (debounced PUT /api/settings). */
export function updateSettings(patch: SettingsPatch): void {
  pendingVersion++;
  setState((s) => ({
    settingsPending: mergePatch(s.settingsPending, patch),
    settings: s.settings ? applySettingsPatch(s.settings, patch) : s.settings,
  }));
  if (patch.theme) setThemeLocal(patch.theme);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => void flushSettings(), SETTINGS_DEBOUNCE_MS);
}

export async function flushSettings(): Promise<void> {
  clearTimeout(settingsTimer);
  const patch = getState().settingsPending;
  if (!patch) return;
  const version = pendingVersion;
  try {
    const settings = await api.updateSettings(patch);
    if (version === pendingVersion) {
      setState({ settingsPending: null, settings });
    } else {
      setState((s) => ({ settings: applySettingsPatch(settings, s.settingsPending) }));
    }
  } catch (err) {
    if (version === pendingVersion) setState({ settingsPending: null });
    reportError(err, "Couldn't save settings");
    loadSettings().catch(() => undefined);
  }
}

/** Best-effort save of unsent settings when the page is hidden/closed. */
export function flushSettingsOnExit(): void {
  const patch = getState().settingsPending;
  if (!patch) return;
  clearTimeout(settingsTimer);
  try {
    void fetch(apiUrl('/settings'), {
      method: 'PUT',
      keepalive: true,
      headers: { 'content-type': 'application/json', [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
      body: JSON.stringify(patch),
    });
  } catch {
    // ignore
  }
}

// ---- workspaces ------------------------------------------------------------------------------

export async function loadWorkspaces(): Promise<void> {
  const since = getState().sync.seq;
  const { workspaces } = await api.listWorkspaces();
  setState((s) => ({ ...applyFetchedWorkspaces(s, workspaces, since), workspacesLoaded: true }));
}

export async function createWorkspace(body: CreateWorkspaceBody): Promise<Workspace> {
  const workspace = await api.createWorkspace(body);
  setState((s) => ({ workspaces: upsertWorkspace(s.workspaces, workspace) }));
  return workspace;
}

export async function updateWorkspace(id: string, body: UpdateWorkspaceBody): Promise<Workspace> {
  const workspace = await api.updateWorkspace(id, body);
  setState((s) => ({ workspaces: upsertWorkspace(s.workspaces, workspace) }));
  return workspace;
}

/** POST /api/import, then fold the (possibly new) workspace and conversations into the store. */
export async function importData(body: ImportBody): Promise<ImportResponse> {
  const res = await api.importData(body);
  setState((s) => {
    const patch: Partial<typeof s> = { workspaces: upsertWorkspace(s.workspaces, res.workspace) };
    if (s.conversationsWorkspaceId === res.workspace.id) {
      let list = s.conversations;
      for (const c of res.conversations) list = upsertSummary(list, summarizeConversation(c));
      patch.conversations = list;
    }
    return patch;
  });
  return res;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await api.deleteWorkspace(id);
  setState((s) => reduceEvent(s, { type: 'workspace.deleted', workspaceId: id }).state);
}

/** GET a workspace and fold it into the list (null when it does not exist). */
export async function fetchWorkspace(id: string): Promise<Workspace | null> {
  try {
    const workspace = await api.getWorkspace(id);
    setState((s) => ({ workspaces: upsertWorkspace(s.workspaces, workspace) }));
    return workspace;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

/** Make sure a workspace is known (e.g. deep link before the list loaded / created elsewhere). */
export async function ensureWorkspace(id: string): Promise<Workspace | null> {
  const known = getState().workspaces.find((w) => w.id === id);
  return known ?? fetchWorkspace(id);
}

// ---- conversation summaries ----------------------------------------------------------------

/** Select the workspace whose conversations are listed and (re)load them. */
export async function openWorkspaceConversations(workspaceId: string): Promise<void> {
  if (getState().conversationsWorkspaceId !== workspaceId) {
    setState({
      conversationsWorkspaceId: workspaceId,
      conversations: [],
      conversationsStatus: 'loading',
    });
  }
  await loadConversations(workspaceId);
}

export async function loadConversations(workspaceId: string): Promise<void> {
  const since = getState().sync.seq;
  try {
    const { conversations } = await api.listConversations(workspaceId);
    setState((s) =>
      s.conversationsWorkspaceId === workspaceId
        ? {
            ...applyFetchedSummaries(s, workspaceId, conversations, since),
            conversationsStatus: 'ready',
          }
        : {},
    );
  } catch (err) {
    setState((s) =>
      s.conversationsWorkspaceId === workspaceId && s.conversationsStatus !== 'ready'
        ? { conversationsStatus: 'error' }
        : {},
    );
    throw err;
  }
}

// ---- conversations ---------------------------------------------------------------------------

/** Show a conversation: switch the current id (clearing old data) and fetch it. */
export async function openConversation(id: string): Promise<void> {
  if (getState().conversationId !== id) {
    setState({
      conversationId: id,
      conversation: null,
      pendingGraphs: [],
      activity: {},
      conversationStatus: 'loading',
      conversationError: null,
      currentGraphId: null,
      selection: { nodeId: null, edgeId: null },
      rightPanel: null,
      askScope: null,
    });
  }
  await loadConversation(id);
}

export async function loadConversation(id: string): Promise<void> {
  const since = getState().sync.seq;
  if (!getState().conversation) setState({ conversationStatus: 'loading' });
  try {
    const conversation = await api.getConversation(id);
    setState((s) =>
      s.conversationId === id
        ? {
            ...applyFetchedConversation(s, conversation, since),
            conversationStatus: 'ready',
            conversationError: null,
          }
        : {},
    );
  } catch (err) {
    setState((s) =>
      s.conversationId === id && !s.conversation
        ? {
            conversationStatus: 'error',
            conversationError: {
              message: errorMessage(err),
              status: err instanceof ApiRequestError ? err.status : 0,
            },
          }
        : {},
    );
  }
}

function adoptConversation(conversation: Conversation, makeCurrent: boolean): void {
  setState((s) => {
    const patch: Partial<typeof s> = {};
    if (s.conversationsWorkspaceId === conversation.workspaceId) {
      patch.conversations = upsertSummary(s.conversations, summarizeConversation(conversation));
    }
    if (makeCurrent) {
      Object.assign(patch, {
        conversationId: conversation.id,
        conversation,
        pendingGraphs: [],
        activity: {},
        conversationStatus: 'ready',
        conversationError: null,
        currentGraphId: null,
        selection: { nodeId: null, edgeId: null },
        rightPanel: null,
        askScope: null,
      });
    }
    return patch;
  });
}

export async function createConversation(
  workspaceId: string,
  title?: string,
): Promise<Conversation> {
  const conversation = await api.createConversation({ workspaceId, title });
  adoptConversation(conversation, true);
  return conversation;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const conversation = await api.updateConversation(id, { title });
  setState((s) => {
    const patch: Partial<typeof s> = {};
    if (s.conversationsWorkspaceId === conversation.workspaceId) {
      patch.conversations = upsertSummary(s.conversations, summarizeConversation(conversation));
    }
    if (s.conversation?.id === id) {
      patch.conversation = {
        ...s.conversation,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      };
    }
    return patch;
  });
}

export async function deleteConversation(id: string, workspaceId: string): Promise<void> {
  await api.deleteConversation(id);
  setState(
    (s) => reduceEvent(s, { type: 'conversation.deleted', conversationId: id, workspaceId }).state,
  );
}

export async function duplicateConversation(id: string): Promise<Conversation> {
  const conversation = await api.duplicateConversation(id);
  adoptConversation(conversation, false);
  return conversation;
}

// ---- diagrams --------------------------------------------------------------------------------

export async function askQuestion(conversationId: string, body: AskBody): Promise<GraphEntry> {
  const { graph } = await api.ask(conversationId, body);
  setState((s) => applyGraphResponse(s, conversationId, graph));
  return graph;
}

export async function retryGraph(
  conversationId: string,
  graphId: string,
  body: RetryBody,
): Promise<GraphEntry> {
  const { graph } = await api.retryGraph(conversationId, graphId, body);
  setState((s) => applyGraphResponse(s, conversationId, graph));
  return graph;
}

export async function cancelGraph(conversationId: string, graphId: string): Promise<GraphEntry> {
  const { graph } = await api.cancelGraph(conversationId, graphId);
  setState((s) => applyGraphResponse(s, conversationId, graph));
  return graph;
}

export async function patchGraph(
  conversationId: string,
  graphId: string,
  body: UpdateGraphBody,
): Promise<GraphEntry> {
  const { graph } = await api.updateGraph(conversationId, graphId, body);
  setState((s) => applyGraphResponse(s, conversationId, graph));
  return graph;
}

export async function deleteGraph(conversationId: string, graphId: string): Promise<string[]> {
  const { deleted } = await api.deleteGraph(conversationId, graphId);
  const ids = deleted?.length ? deleted : [graphId];
  setState((s) => applyGraphsDeleted(s, conversationId, ids));
  return ids;
}

const activityLoads = new Map<string, Promise<void>>();

/** Fetch the full activity log of a diagram (merged with live items). */
export function loadActivity(conversationId: string, graphId: string): Promise<void> {
  const key = `${conversationId}/${graphId}`;
  const existing = activityLoads.get(key);
  if (existing) return existing;
  const promise = api
    .getActivity(conversationId, graphId)
    .then(({ activity }) => {
      setState((s) => applyFetchedActivity(s, conversationId, graphId, activity ?? []));
    })
    .catch(() => undefined)
    .finally(() => activityLoads.delete(key));
  activityLoads.set(key, promise);
  return promise;
}

export function toastSaved(title: string): void {
  toast({ tone: 'success', title, duration: 2500 });
}
