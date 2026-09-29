import { afterEach, describe, expect, it } from 'vitest';
import {
  currentRoute,
  formatRoute,
  navigate,
  parseRoute,
  routes,
  type KnownRoute,
} from '../src/lib/router';

describe('router', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '#/');
  });

  it('parses every route shape', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/w/abc')).toEqual({ name: 'workspace', workspaceId: 'abc' });
    expect(parseRoute('#/w/abc/c/def')).toEqual({
      name: 'conversation',
      workspaceId: 'abc',
      conversationId: 'def',
    });
    expect(parseRoute('#/w/abc/c/def/g/ghi?view=map')).toEqual({
      name: 'conversation',
      workspaceId: 'abc',
      conversationId: 'def',
      graphId: 'ghi',
      view: 'map',
    });
    expect(parseRoute('#/w/abc/c/def?view=diagram')).toEqual({
      name: 'conversation',
      workspaceId: 'abc',
      conversationId: 'def',
    });
  });

  it('flags unknown routes', () => {
    for (const hash of [
      '#/x',
      '#/w',
      '#/w/a/b',
      '#/w/a/c',
      '#/w/a/c/b/g',
      '#/w/a/c/b/x/y',
      '#/w/%E0%A4%A',
    ]) {
      expect(parseRoute(hash).name).toBe('unknown');
    }
  });

  it('round-trips format/parse, including ids that need encoding', () => {
    const cases: KnownRoute[] = [
      routes.home(),
      routes.workspace('w 1/ä'),
      routes.conversation('w1', 'c?1'),
      routes.conversation('w1', 'c1', 'g#1'),
      routes.conversation('w1', 'c1', 'g1', 'map'),
      routes.conversation('w1', 'c1', undefined, 'map'),
    ];
    for (const route of cases) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
    expect(formatRoute(routes.conversation('w', 'c', 'g', 'map'))).toBe('#/w/w/c/c/g/g?view=map');
    expect(formatRoute(routes.conversation('w', 'c', 'g', 'diagram'))).toBe('#/w/w/c/c/g/g');
  });

  it('navigates with push and replace', () => {
    const start = window.history.length;
    navigate(routes.workspace('a'));
    expect(currentRoute()).toEqual({ name: 'workspace', workspaceId: 'a' });
    navigate(routes.workspace('b'), { replace: true });
    expect(currentRoute()).toEqual({ name: 'workspace', workspaceId: 'b' });
    expect(window.history.length).toBeLessThanOrEqual(start + 1);
  });

  it('notifies subscribers on replace', () => {
    let calls = 0;
    const onRoute = () => calls++;
    window.addEventListener('codesplainer:route', onRoute);
    navigate(routes.workspace('z'), { replace: true });
    window.removeEventListener('codesplainer:route', onRoute);
    expect(calls).toBe(1);
  });
});
