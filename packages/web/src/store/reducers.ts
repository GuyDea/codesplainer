/**
 * Pure state transitions for server data: SSE events and fetched snapshots.
 *
 * Races between a fetch and events that arrive while it is in flight are resolved with
 * SyncState: every event bumps `seq` and stamps the ids it touched; a fetch remembers the seq at
 * which it started. When the snapshot arrives, local items touched after that point win if they
 * are at least as fresh, items created meanwhile are kept, and tombstoned ids are dropped.
 */
import {
  getGraph,
  isPending,
  mergeSettings,
  PROVIDER_IDS,
  type ActivityItem,
  type Conversation,
  type ConversationSummary,
  type GraphEntry,
  type GraphStatus,
  type ServerEvent,
  type Settings,
  type SettingsPatch,
  type Workspace,
} from '@codesplainer/shared';
import type { DataState, SyncState } from './types';

export const MAX_ACTIVITY_ITEMS = 1000;

export const syncKey = {
  graph: (id: string) => `g:${id}`,
  conversation: (id: string) => `c:${id}`,
  workspace: (id: string) => `w:${id}`,
  settings: 'settings',
  providers: 'providers',
};

/** True when an event touched `key` after the fetch that started at `sinceSeq`. */
export function touchedSince(sync: SyncState, key: string, sinceSeq: number): boolean {
  return (sync.touched[key] ?? -1) > sinceSeq;
}

export function emptySync(): SyncState {
  return { seq: 0, touched: {}, deleted: {} };
}

export function initialDataState(): DataState {
  return {
    providers: [],
    settings: null,
    settingsPending: null,
    workspaces: [],
    conversationsWorkspaceId: null,
    conversations: [],
    conversationId: null,
    conversation: null,
    pendingGraphs: [],
    activity: {},
    sync: emptySync(),
  };
}

function touch(sync: SyncState, keys: string[]): SyncState {
  const seq = sync.seq + 1;
  const touched = { ...sync.touched };
  for (const key of keys) touched[key] = seq;
  return { ...sync, seq, touched };
}

function tombstone(sync: SyncState, keys: string[]): SyncState {
  const seq = sync.seq + 1;
  const deleted = { ...sync.deleted };
  for (const key of keys) deleted[key] = seq;
  return { ...sync, seq, deleted };
}

// ---- freshness -------------------------------------------------------------------------------

const STATUS_RANK: Record<GraphStatus, number> = {
  queued: 0,
  running: 1,
  done: 2,
  error: 2,
  cancelled: 2,
};

/** Monotonic progress of a diagram: retries bump `attempt`, statuses only move forward. */
export function graphFreshness(entry: Pick<GraphEntry, 'attempt' | 'status'>): number {
  return (entry.attempt ?? 1) * 10 + STATUS_RANK[entry.status];
}

/** > 0 when `a` is newer than `b`. */
export function compareGraphs(a: GraphEntry, b: GraphEntry): number {
  return graphFreshness(a) - graphFreshness(b);
}

function compareIso(a: string | undefined, b: string | undefined): number {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

// ---- generic merge ---------------------------------------------------------------------------

export interface MergeOptions<T> {
  id: (item: T) => string;
  key: (id: string) => string;
  /** > 0 when a is newer than b. */
  compare: (a: T, b: T) => number;
  sync: SyncState;
  /** Seq at which the fetch started. */
  sinceSeq: number;
}

/** Merge a fetched list with local items (see file comment). Keeps the fetched order. */
export function mergeFetched<T>(fetched: T[], local: T[], opts: MergeOptions<T>): T[] {
  const localById = new Map(local.map((item) => [opts.id(item), item]));
  const recent = (id: string) => touchedSince(opts.sync, opts.key(id), opts.sinceSeq);
  const isDeleted = (id: string) => opts.sync.deleted[opts.key(id)] !== undefined;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of fetched) {
    const id = opts.id(item);
    if (isDeleted(id) || seen.has(id)) continue;
    seen.add(id);
    const mine = localById.get(id);
    out.push(mine && recent(id) && opts.compare(mine, item) >= 0 ? mine : item);
  }
  for (const item of local) {
    const id = opts.id(item);
    if (seen.has(id) || isDeleted(id) || !recent(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

// ---- graphs ----------------------------------------------------------------------------------

/** Insert or replace a diagram unless the incoming copy is older. Keeps local activity/session. */
export function upsertGraphList(graphs: GraphEntry[], incoming: GraphEntry): GraphEntry[] {
  const index = graphs.findIndex((g) => g.id === incoming.id);
  if (index < 0) return [...graphs, incoming];
  const current = graphs[index] as GraphEntry;
  if (compareGraphs(incoming, current) < 0) return graphs;
  const merged: GraphEntry = {
    ...incoming,
    activity: incoming.activity?.length ? incoming.activity : current.activity,
  };
  if (!merged.session && current.session) merged.session = current.session;
  const next = graphs.slice();
  next[index] = merged;
  return next;
}

export function upsertGraph(conversation: Conversation, incoming: GraphEntry): Conversation {
  const graphs = upsertGraphList(conversation.graphs, incoming);
  return graphs === conversation.graphs ? conversation : { ...conversation, graphs };
}

// ---- activity --------------------------------------------------------------------------------

const activityKey = (item: ActivityItem) => `${item.ts}|${item.kind}|${item.text}`;

/** A retry starts a new attempt: forget the live log of the previous one. */
function resetActivityOnRetry(
  activity: Record<string, ActivityItem[]>,
  previous: GraphEntry | undefined,
  incoming: GraphEntry,
): Record<string, ActivityItem[]> {
  if (!previous || (incoming.attempt ?? 1) <= (previous.attempt ?? 1) || !activity[incoming.id]) {
    return activity;
  }
  const next = { ...activity };
  delete next[incoming.id];
  return next;
}

export function appendActivity(
  list: ActivityItem[] | undefined,
  item: ActivityItem,
): ActivityItem[] {
  const current = list ?? [];
  const last = current[current.length - 1];
  if (last && activityKey(last) === activityKey(item)) return current;
  const next = [...current, item];
  return next.length > MAX_ACTIVITY_ITEMS ? next.slice(next.length - MAX_ACTIVITY_ITEMS) : next;
}

/** Union of a fetched full log and live items, de-duplicated and ordered by timestamp. */
export function mergeActivity(
  existing: ActivityItem[] | undefined,
  fetched: ActivityItem[],
): ActivityItem[] {
  if (!existing?.length) return fetched.slice(-MAX_ACTIVITY_ITEMS);
  const seen = new Set<string>();
  const all: ActivityItem[] = [];
  for (const item of [...fetched, ...existing]) {
    const key = activityKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(item);
  }
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return all.slice(-MAX_ACTIVITY_ITEMS);
}

// ---- summaries / workspaces ------------------------------------------------------------------

function byUpdatedDesc<T extends { updatedAt: string }>(a: T, b: T): number {
  return compareIso(b.updatedAt, a.updatedAt);
}

export function upsertSummary(
  list: ConversationSummary[],
  incoming: ConversationSummary,
): ConversationSummary[] {
  const index = list.findIndex((c) => c.id === incoming.id);
  if (
    index >= 0 &&
    compareIso(incoming.updatedAt, (list[index] as ConversationSummary).updatedAt) < 0
  ) {
    return list;
  }
  const next = index >= 0 ? list.map((c, i) => (i === index ? incoming : c)) : [...list, incoming];
  return next.sort(byUpdatedDesc);
}

export function upsertWorkspace(list: Workspace[], incoming: Workspace): Workspace[] {
  const index = list.findIndex((w) => w.id === incoming.id);
  if (index < 0) return [...list, incoming];
  const current = list[index] as Workspace;
  if (
    compareIso(incoming.updatedAt, current.updatedAt) < 0 ||
    (incoming.updatedAt === current.updatedAt &&
      compareIso(incoming.lastOpenedAt, current.lastOpenedAt) < 0)
  ) {
    return list;
  }
  return list.map((w, i) => (i === index ? incoming : w));
}

// ---- settings --------------------------------------------------------------------------------

/** Combine two deep-partial settings patches (b wins). */
export function mergePatch(a: SettingsPatch | null, b: SettingsPatch): SettingsPatch {
  if (!a) return b;
  const out: SettingsPatch = { ...a, ...b };
  if (a.providers || b.providers) {
    const providers: NonNullable<SettingsPatch['providers']> = { ...(a.providers ?? {}) };
    for (const id of PROVIDER_IDS) {
      const next = b.providers?.[id];
      if (next) providers[id] = { ...(providers[id] ?? {}), ...next };
    }
    out.providers = providers;
  }
  if (a.acp || b.acp) out.acp = { ...(a.acp ?? {}), ...(b.acp ?? {}) };
  return out;
}

/** Apply a patch locally; invalid combinations leave the settings unchanged. */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch | null): Settings {
  if (!patch) return settings;
  try {
    return mergeSettings(settings, patch);
  } catch {
    return settings;
  }
}

// ---- events ----------------------------------------------------------------------------------

export type EventEffect =
  | {
      type: 'graph-finished';
      conversationId: string;
      graph: GraphEntry;
      previousStatus: GraphStatus;
    }
  | { type: 'graphs-deleted'; conversationId: string; graphIds: string[] }
  | { type: 'conversation-deleted'; conversationId: string; workspaceId: string }
  | { type: 'workspace-deleted'; workspaceId: string };

export interface ReduceResult {
  state: DataState;
  effects: EventEffect[];
}

const unchanged = (state: DataState): ReduceResult => ({ state, effects: [] });

export function reduceEvent(state: DataState, event: ServerEvent): ReduceResult {
  switch (event.type) {
    case 'hello':
      return unchanged(state);

    case 'graph.updated': {
      if (event.conversationId !== state.conversationId) return unchanged(state);
      const key = syncKey.graph(event.graph.id);
      if (state.sync.deleted[key] !== undefined) return unchanged(state);
      const sync = touch(state.sync, [key]);
      const conversation = state.conversation;
      if (conversation && conversation.id === event.conversationId) {
        const previous = getGraph(conversation, event.graph.id);
        const next = upsertGraph(conversation, event.graph);
        const activity = resetActivityOnRetry(state.activity, previous, event.graph);
        const effects: EventEffect[] = [];
        const applied = getGraph(next, event.graph.id);
        if (
          previous &&
          next !== conversation &&
          applied &&
          isPending(previous.status) &&
          !isPending(applied.status)
        ) {
          effects.push({
            type: 'graph-finished',
            conversationId: conversation.id,
            graph: applied,
            previousStatus: previous.status,
          });
        }
        return { state: { ...state, conversation: next, activity, sync }, effects };
      }
      return {
        state: { ...state, pendingGraphs: upsertGraphList(state.pendingGraphs, event.graph), sync },
        effects: [],
      };
    }

    case 'graph.activity': {
      if (event.conversationId !== state.conversationId) return unchanged(state);
      if (state.sync.deleted[syncKey.graph(event.graphId)] !== undefined) return unchanged(state);
      const list = appendActivity(state.activity[event.graphId], event.item);
      if (list === state.activity[event.graphId]) return unchanged(state);
      return {
        state: { ...state, activity: { ...state.activity, [event.graphId]: list } },
        effects: [],
      };
    }

    case 'graph.deleted': {
      const ids = new Set(event.graphIds);
      if (ids.size === 0) return unchanged(state);
      const sync = tombstone(state.sync, event.graphIds.map(syncKey.graph));
      let { conversation, pendingGraphs, activity } = state;
      if (conversation && conversation.id === event.conversationId) {
        const graphs = conversation.graphs.filter((g) => !ids.has(g.id));
        if (graphs.length !== conversation.graphs.length)
          conversation = { ...conversation, graphs };
      }
      if (event.conversationId === state.conversationId) {
        pendingGraphs = pendingGraphs.filter((g) => !ids.has(g.id));
      }
      if (event.graphIds.some((id) => activity[id])) {
        activity = { ...activity };
        for (const id of event.graphIds) delete activity[id];
      }
      return {
        state: { ...state, conversation, pendingGraphs, activity, sync },
        effects: [
          {
            type: 'graphs-deleted',
            conversationId: event.conversationId,
            graphIds: event.graphIds,
          },
        ],
      };
    }

    case 'conversation.updated': {
      const summary = event.conversation;
      const key = syncKey.conversation(summary.id);
      if (state.sync.deleted[key] !== undefined) return unchanged(state);
      let next: DataState = { ...state, sync: touch(state.sync, [key]) };
      if (summary.workspaceId === state.conversationsWorkspaceId) {
        next.conversations = upsertSummary(state.conversations, summary);
      }
      const conversation = state.conversation;
      if (
        conversation &&
        conversation.id === summary.id &&
        compareIso(summary.updatedAt, conversation.updatedAt) >= 0 &&
        (conversation.title !== summary.title || conversation.updatedAt !== summary.updatedAt)
      ) {
        next = {
          ...next,
          conversation: { ...conversation, title: summary.title, updatedAt: summary.updatedAt },
        };
      }
      return { state: next, effects: [] };
    }

    case 'conversation.deleted': {
      const key = syncKey.conversation(event.conversationId);
      const next: DataState = {
        ...state,
        sync: tombstone(state.sync, [key]),
        conversations: state.conversations.filter((c) => c.id !== event.conversationId),
      };
      return {
        state: next,
        effects: [
          {
            type: 'conversation-deleted',
            conversationId: event.conversationId,
            workspaceId: event.workspaceId,
          },
        ],
      };
    }

    case 'workspace.updated': {
      const key = syncKey.workspace(event.workspace.id);
      if (state.sync.deleted[key] !== undefined) return unchanged(state);
      return {
        state: {
          ...state,
          sync: touch(state.sync, [key]),
          workspaces: upsertWorkspace(state.workspaces, event.workspace),
        },
        effects: [],
      };
    }

    case 'workspace.deleted': {
      const key = syncKey.workspace(event.workspaceId);
      const next: DataState = {
        ...state,
        sync: tombstone(state.sync, [key]),
        workspaces: state.workspaces.filter((w) => w.id !== event.workspaceId),
      };
      if (state.conversationsWorkspaceId === event.workspaceId) next.conversations = [];
      return {
        state: next,
        effects: [{ type: 'workspace-deleted', workspaceId: event.workspaceId }],
      };
    }

    case 'providers.updated':
      return {
        state: {
          ...state,
          providers: event.providers,
          sync: touch(state.sync, [syncKey.providers]),
        },
        effects: [],
      };

    case 'settings.updated':
      return {
        state: {
          ...state,
          settings: applySettingsPatch(event.settings, state.settingsPending),
          sync: touch(state.sync, [syncKey.settings]),
        },
        effects: [],
      };
  }
}

// ---- fetched snapshots -----------------------------------------------------------------------

/** Apply GET /api/conversations/:id. Ignored when the user already moved to another one. */
export function applyFetchedConversation(
  state: DataState,
  fetched: Conversation,
  sinceSeq: number,
): DataState {
  if (state.conversationId !== fetched.id) return state;
  if (state.sync.deleted[syncKey.conversation(fetched.id)] !== undefined) return state;
  const current = state.conversation?.id === fetched.id ? state.conversation : null;
  const local = current ? current.graphs : state.pendingGraphs;
  const graphs = mergeFetched(fetched.graphs, local, {
    id: (g) => g.id,
    key: syncKey.graph,
    compare: compareGraphs,
    sync: state.sync,
    sinceSeq,
  }).map((g) => {
    // Keep the local session/activity pointers when the fetched copy lacks them.
    const mine = local.find((l) => l.id === g.id);
    if (!mine || mine === g) return g;
    const copy = { ...g };
    if (!copy.session && mine.session) copy.session = mine.session;
    return copy;
  });
  let { title, updatedAt } = fetched;
  const summaryTouched = (state.sync.touched[syncKey.conversation(fetched.id)] ?? -1) > sinceSeq;
  if (current && summaryTouched && compareIso(current.updatedAt, fetched.updatedAt) > 0) {
    title = current.title;
    updatedAt = current.updatedAt;
  }
  let activity = state.activity;
  for (const g of fetched.graphs) {
    if (!g.activity?.length) continue;
    if (activity === state.activity) activity = { ...activity };
    activity[g.id] = mergeActivity(activity[g.id], g.activity);
  }
  return {
    ...state,
    conversation: { ...fetched, title, updatedAt, graphs },
    pendingGraphs: [],
    activity,
  };
}

/** Apply GET /api/conversations?workspaceId=. */
export function applyFetchedSummaries(
  state: DataState,
  workspaceId: string,
  fetched: ConversationSummary[],
  sinceSeq: number,
): DataState {
  if (state.conversationsWorkspaceId !== workspaceId) return state;
  const conversations = mergeFetched(fetched, state.conversations, {
    id: (c) => c.id,
    key: syncKey.conversation,
    compare: (a, b) => compareIso(a.updatedAt, b.updatedAt),
    sync: state.sync,
    sinceSeq,
  }).sort(byUpdatedDesc);
  return { ...state, conversations };
}

/** Apply GET /api/workspaces. */
export function applyFetchedWorkspaces(
  state: DataState,
  fetched: Workspace[],
  sinceSeq: number,
): DataState {
  const workspaces = mergeFetched(fetched, state.workspaces, {
    id: (w) => w.id,
    key: syncKey.workspace,
    compare: (a, b) => compareIso(a.updatedAt, b.updatedAt),
    sync: state.sync,
    sinceSeq,
  });
  return { ...state, workspaces };
}

/** Apply GET .../activity (full log) for one graph. */
export function applyFetchedActivity(
  state: DataState,
  conversationId: string,
  graphId: string,
  fetched: ActivityItem[],
): DataState {
  if (state.conversationId !== conversationId) return state;
  if (state.sync.deleted[syncKey.graph(graphId)] !== undefined) return state;
  return {
    ...state,
    activity: { ...state.activity, [graphId]: mergeActivity(state.activity[graphId], fetched) },
  };
}

/** Apply a graph returned by a mutation response (ask/retry/cancel/patch). */
export function applyGraphResponse(
  state: DataState,
  conversationId: string,
  graph: GraphEntry,
): DataState {
  if (state.sync.deleted[syncKey.graph(graph.id)] !== undefined) return state;
  if (state.conversation?.id === conversationId) {
    const previous = getGraph(state.conversation, graph.id);
    const conversation = upsertGraph(state.conversation, graph);
    if (conversation === state.conversation) return state;
    return {
      ...state,
      conversation,
      activity: resetActivityOnRetry(state.activity, previous, graph),
    };
  }
  if (state.conversationId === conversationId) {
    return { ...state, pendingGraphs: upsertGraphList(state.pendingGraphs, graph) };
  }
  return state;
}

/** Remove graphs after a successful DELETE (same as the event, without effects). */
export function applyGraphsDeleted(
  state: DataState,
  conversationId: string,
  graphIds: string[],
): DataState {
  return reduceEvent(state, { type: 'graph.deleted', conversationId, graphIds }).state;
}
