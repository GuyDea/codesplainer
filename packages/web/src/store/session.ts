/** Connection lifecycle: health check, initial loads, live events and their side effects. */
import {
  ancestorsOf,
  APP_VERSION,
  getGraph,
  graphDisplayTitle,
  parentIdOf,
  type Conversation,
  type ServerEvent,
} from '@codesplainer/shared';
import { api, errorMessage } from '../lib/api';
import { connectEvents, type EventClient } from '../lib/events';
import { currentRoute, navigate, routes } from '../lib/router';
import {
  loadActivity,
  loadConversation,
  loadConversations,
  loadProviders,
  loadSettings,
  loadWorkspaces,
} from './data';
import { reduceEvent, type EventEffect } from './reducers';
import { getState, setState } from './store';
import type { AppState } from './types';
import { setThemeLocal, toast } from './ui';

let events: EventClient | null = null;
let bootstrapping: Promise<void> | null = null;

/** Health check, then live events + initial data. Safe to call again (retry). */
export function bootstrap(): Promise<void> {
  if (bootstrapping) return bootstrapping;
  bootstrapping = (async () => {
    // Keep the previous error while retrying so the offline screen does not flicker.
    setState({ connection: 'connecting' });
    try {
      const health = await api.health();
      setState({ health, connection: 'online', connectionError: null });
    } catch (err) {
      setState({ connection: 'offline', connectionError: errorMessage(err) });
      return;
    }
    // Subscribe before fetching so nothing is missed; the reducers merge overlaps.
    startEvents();
    await loadCoreData();
  })().finally(() => {
    bootstrapping = null;
  });
  return bootstrapping;
}

/** Providers, settings and workspaces; records a load error (shown with a retry). */
export async function loadCoreData(): Promise<void> {
  const results = await Promise.allSettled([loadProviders(), loadSettings(), loadWorkspaces()]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  setState({ loadError: failed ? errorMessage(failed.reason) : null });
}

export function startEvents(): void {
  if (events) return;
  events = connectEvents({
    onEvent: handleServerEvent,
    onStateChange: (eventsState) => setState({ eventsState }),
    onReconnect: () => void refetchAll(),
  });
}

export function stopEvents(): void {
  events?.close();
  events = null;
}

/** Try to reconnect right away (tab visible again, network back). */
export function reconnectEventsNow(): void {
  events?.reconnectNow();
}

/** Refetch everything on screen after a reconnect (events are not replayed). */
export async function refetchAll(): Promise<void> {
  try {
    const health = await api.health();
    setState({ health, connection: 'online', connectionError: null });
  } catch {
    return;
  }
  const s = getState();
  const tasks: Promise<unknown>[] = [loadCoreData()];
  if (s.conversationsWorkspaceId) tasks.push(loadConversations(s.conversationsWorkspaceId));
  if (s.conversationId) tasks.push(loadConversation(s.conversationId));
  if (s.conversationId && s.currentGraphId)
    tasks.push(loadActivity(s.conversationId, s.currentGraphId));
  await Promise.allSettled(tasks);
}

let versionWarned = false;

export function handleServerEvent(event: ServerEvent): void {
  const previous = getState();
  const { state, effects } = reduceEvent(previous, event);
  if (state !== previous) setState(state);
  if (event.type === 'hello' && event.version !== APP_VERSION && !versionWarned) {
    versionWarned = true;
    toast({
      title: 'Codesplainer was updated',
      description: `Server ${event.version}, this page ${APP_VERSION}.`,
      duration: 0,
      action: { label: 'Reload', onClick: () => window.location.reload() },
    });
  }
  if (event.type === 'settings.updated') {
    const theme = getState().settings?.theme;
    if (theme && theme !== getState().theme) setThemeLocal(theme);
  }
  for (const effect of effects) runEffect(effect, previous);
}

function isViewing(graphId: string, conversationId: string): boolean {
  const route = currentRoute();
  const s = getState();
  return (
    route.name === 'conversation' &&
    route.conversationId === conversationId &&
    s.currentGraphId === graphId &&
    s.view === 'diagram' &&
    document.visibilityState !== 'hidden'
  );
}

function openGraphRoute(
  conversation: Pick<Conversation, 'workspaceId' | 'id'>,
  graphId: string,
): void {
  navigate(routes.conversation(conversation.workspaceId, conversation.id, graphId));
}

function runEffect(effect: EventEffect, previous: AppState): void {
  const s = getState();
  const route = currentRoute();
  switch (effect.type) {
    case 'graph-finished': {
      const conversation = s.conversation;
      if (!conversation || conversation.id !== effect.conversationId) return;
      const { graph } = effect;
      if (isViewing(graph.id, conversation.id)) return;
      const title = graphDisplayTitle(graph);
      const inConversation =
        route.name === 'conversation' && route.conversationId === conversation.id;
      if (graph.status === 'done') {
        const fromCurrent = parentIdOf(graph.origin) === s.currentGraphId;
        if (
          inConversation &&
          s.settings?.autoOpenExpansions &&
          fromCurrent &&
          s.view === 'diagram'
        ) {
          openGraphRoute(conversation, graph.id);
          return;
        }
        toast({
          id: `ready-${graph.id}`,
          tone: 'success',
          title: `“${title}” ready`,
          action: { label: 'Open', onClick: () => openGraphRoute(conversation, graph.id) },
        });
      } else if (graph.status === 'error') {
        toast({
          id: `failed-${graph.id}`,
          tone: 'error',
          title: `“${title}” failed`,
          description: graph.error,
          action: { label: 'Open', onClick: () => openGraphRoute(conversation, graph.id) },
        });
      }
      return;
    }

    case 'graphs-deleted': {
      if (route.name !== 'conversation' || route.conversationId !== effect.conversationId) return;
      const current = previous.currentGraphId;
      if (!current || !effect.graphIds.includes(current)) return;
      const before = previous.conversation;
      if (!before || before.id !== effect.conversationId) return;
      // Go to the nearest ancestor that survived; otherwise let the screen pick a default.
      const deleted = new Set(effect.graphIds);
      const survivor = ancestorsOf(before, current)
        .reverse()
        .find((g) => !deleted.has(g.id));
      const target =
        survivor && getGraph(s.conversation ?? before, survivor.id) ? survivor.id : undefined;
      navigate(routes.conversation(route.workspaceId, route.conversationId, target), {
        replace: true,
      });
      return;
    }

    case 'conversation-deleted': {
      if (route.name === 'conversation' && route.conversationId === effect.conversationId) {
        navigate(routes.workspace(effect.workspaceId), { replace: true });
        toast({ title: 'This conversation was deleted.' });
      }
      return;
    }

    case 'workspace-deleted': {
      if (
        (route.name === 'workspace' || route.name === 'conversation') &&
        route.workspaceId === effect.workspaceId
      ) {
        navigate(routes.home(), { replace: true });
        toast({ title: 'This workspace was deleted.' });
      }
      return;
    }
  }
}
