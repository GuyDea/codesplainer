/**
 * Hash router.
 *   #/                              home
 *   #/w/:wid                        workspace
 *   #/w/:wid/c/:cid                 conversation (current diagram resolved by the screen)
 *   #/w/:wid/c/:cid/g/:gid          conversation showing one diagram
 *   ...?view=map                    conversation map instead of the diagram
 * Browser back/forward work because every push is a real hash change.
 */
import { useMemo, useSyncExternalStore } from 'react';

export type AppView = 'diagram' | 'map';

export type Route =
  | { name: 'home' }
  | { name: 'workspace'; workspaceId: string }
  | {
      name: 'conversation';
      workspaceId: string;
      conversationId: string;
      graphId?: string;
      view?: AppView;
    }
  | { name: 'unknown'; hash: string };

export type KnownRoute = Exclude<Route, { name: 'unknown' }>;

const ROUTE_EVENT = 'codesplainer:route';

function decode(part: string): string | null {
  try {
    const value = decodeURIComponent(part);
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Parse a location hash ("#/w/abc?view=map", "", "#"). */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?', 2);
  const parts = pathPart.split('/').filter(Boolean);
  const decoded = parts.map(decode);
  if (decoded.some((p) => p === null)) return { name: 'unknown', hash };
  const seg = decoded as string[];
  const query = new URLSearchParams(queryPart);

  if (seg.length === 0) return { name: 'home' };
  if (seg[0] !== 'w' || !seg[1]) return { name: 'unknown', hash };
  const workspaceId = seg[1];
  if (seg.length === 2) return { name: 'workspace', workspaceId };
  if (seg[2] !== 'c' || !seg[3]) return { name: 'unknown', hash };
  const conversationId = seg[3];
  const route: Extract<Route, { name: 'conversation' }> = {
    name: 'conversation',
    workspaceId,
    conversationId,
  };
  if (seg.length === 6 && seg[4] === 'g' && seg[5]) route.graphId = seg[5];
  else if (seg.length !== 4) return { name: 'unknown', hash };
  if (query.get('view') === 'map') route.view = 'map';
  return route;
}

/** Format a route as a hash ("#/w/abc/c/def"). */
export function formatRoute(route: KnownRoute): string {
  const enc = encodeURIComponent;
  switch (route.name) {
    case 'home':
      return '#/';
    case 'workspace':
      return `#/w/${enc(route.workspaceId)}`;
    case 'conversation': {
      let hash = `#/w/${enc(route.workspaceId)}/c/${enc(route.conversationId)}`;
      if (route.graphId) hash += `/g/${enc(route.graphId)}`;
      if (route.view === 'map') hash += '?view=map';
      return hash;
    }
  }
}

export const routes = {
  home: (): KnownRoute => ({ name: 'home' }),
  workspace: (workspaceId: string): KnownRoute => ({ name: 'workspace', workspaceId }),
  conversation: (
    workspaceId: string,
    conversationId: string,
    graphId?: string,
    view?: AppView,
  ): KnownRoute => ({
    name: 'conversation',
    workspaceId,
    conversationId,
    ...(graphId ? { graphId } : {}),
    ...(view === 'map' ? { view } : {}),
  }),
};

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

export function currentRoute(): Route {
  return parseRoute(currentHash());
}

function sameHash(a: string, b: string): boolean {
  const norm = (h: string) => (h === '' || h === '#' ? '#/' : h);
  return norm(a) === norm(b);
}

/** Go to a route. `replace` swaps the current history entry instead of pushing one. */
export function navigate(route: KnownRoute | string, options: { replace?: boolean } = {}): void {
  const target = typeof route === 'string' ? route : formatRoute(route);
  if (sameHash(currentHash(), target)) return;
  if (options.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new Event(ROUTE_EVENT));
  } else {
    window.location.hash = target;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

/** The current route; re-renders on every hash change (including back/forward). */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}
