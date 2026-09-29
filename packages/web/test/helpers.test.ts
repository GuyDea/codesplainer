import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@codesplainer/shared';
import { joinArgs, splitArgs } from '../src/lib/args';
import { dataUrlToBlob } from '../src/lib/download';
import { formatPercent, plural, relativeTime } from '../src/lib/format';
import {
  buildNodeChildren,
  defaultAskScope,
  effectiveAskChoice,
  parentGraphId,
  queuePosition,
  resolveCurrentGraphId,
  siblingGraphId,
} from '../src/store/selectors';
import { cleanPath, describeCheck, parentDir } from '../src/dialogs/folderChecks';
import { pathCrumbs } from '../src/dialogs/FolderBrowserDialog';
import { conversation, graph } from './fixtures';

describe('format', () => {
  const now = Date.parse('2024-06-10T12:00:00.000Z');
  it('formats relative times', () => {
    expect(relativeTime('2024-06-10T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2024-06-10T11:55:00.000Z', now)).toBe('5 min ago');
    expect(relativeTime('2024-06-10T09:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2024-06-09T10:00:00.000Z', now)).toBe('yesterday');
    expect(relativeTime('2024-06-06T12:00:00.000Z', now)).toBe('4 days ago');
    expect(relativeTime('2024-06-11T12:00:00.000Z', now)).toBe('just now');
    expect(relativeTime(undefined, now)).toBe('');
    expect(relativeTime('garbage', now)).toBe('');
  });
  it('pluralizes and formats percents', () => {
    expect(plural(1, 'diagram')).toBe('1 diagram');
    expect(plural(3, 'diagram')).toBe('3 diagrams');
    expect(formatPercent(0.004)).toBe('0.4%');
    expect(formatPercent(0.37)).toBe('37%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('args', () => {
  it('splits and joins command lines', () => {
    expect(splitArgs('acp --flag "a b" \'c d\' e\\ f')).toEqual([
      'acp',
      '--flag',
      'a b',
      'c d',
      'e f',
    ]);
    expect(splitArgs('  ')).toEqual([]);
    expect(splitArgs('""')).toEqual(['']);
    const args = ['acp', 'with space', 'quote"d', ''];
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});

describe('paths', () => {
  it('cleans and splits paths', () => {
    expect(cleanPath(' /code/app/ ')).toBe('/code/app');
    expect(cleanPath('/')).toBe('/');
    expect(cleanPath('C:\\')).toBe('C:\\');
    expect(parentDir('/code/app')).toBe('/code');
    expect(parentDir('/code')).toBe('/');
    expect(parentDir('C:\\Users\\me')).toBe('C:\\Users');
    expect(parentDir('C:\\Users')).toBe('C:\\');
    expect(pathCrumbs('/home/me', '/').map((c) => c.path)).toEqual(['/', '/home', '/home/me']);
    expect(pathCrumbs('C:\\Users\\me', '\\').map((c) => c.path)).toEqual([
      'C:\\',
      'C:\\Users',
      'C:\\Users\\me',
    ]);
    expect(describeCheck({ exists: true, isDir: false, readable: true })).toEqual({
      status: 'invalid',
      message: 'Not a folder',
    });
  });
  it('decodes data URLs', async () => {
    const blob = dataUrlToBlob('data:image/svg+xml;charset=utf-8,%3Csvg%3E');
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe('<svg>');
    const png = dataUrlToBlob('data:image/png;base64,aGk=');
    expect(await png.text()).toBe('hi');
  });
});

describe('selectors', () => {
  const root = graph('r1');
  const child = graph('c1', {
    origin: { type: 'expand', parentGraphId: 'r1', nodeId: 'api', nodeLabel: 'API' },
  });
  const child2 = graph('c2', {
    origin: { type: 'ask-node', parentGraphId: 'r1', nodeId: 'api', nodeLabel: 'API' },
    status: 'running',
  });
  const root2 = graph('r2', { status: 'queued', createdAt: '2024-01-02T00:00:00.000Z' });
  const conv = conversation('x', [root, child, child2, root2]);

  it('resolves the current diagram', () => {
    expect(resolveCurrentGraphId(conv, 'c1', null)).toBe('c1');
    expect(resolveCurrentGraphId(conv, 'missing', 'c2')).toBe('c2');
    expect(resolveCurrentGraphId(conv, undefined, 'gone')).toBe('r2');
    expect(resolveCurrentGraphId(conversation('e', []), undefined, null)).toBeNull();
  });

  it('navigates parents and siblings', () => {
    expect(parentGraphId(conv, 'c1')).toBe('r1');
    expect(parentGraphId(conv, 'r1')).toBeNull();
    expect(siblingGraphId(conv, 'c1', 1)).toBe('c2');
    expect(siblingGraphId(conv, 'c1', -1)).toBeNull();
    expect(siblingGraphId(conv, 'r2', -1)).toBe('r1');
  });

  it('builds node children badges', () => {
    const children = buildNodeChildren(conv, root);
    expect(children.api?.map((c) => `${c.graphId}:${c.type}:${c.status}`)).toEqual([
      'c1:expand:done',
      'c2:ask-node:running',
    ]);
    expect(children.ui).toBeUndefined();
  });

  it('computes ask defaults', () => {
    expect(defaultAskScope(root)).toEqual({ type: 'graph', graphId: 'r1', title: 'T r1' });
    expect(defaultAskScope(root2)).toEqual({ type: 'new' });
    const settings = {
      ...defaultSettings(),
      defaultProvider: 'claude' as const,
      detail: 'simple' as const,
    };
    expect(effectiveAskChoice({ provider: null, models: {}, detail: null }, settings)).toEqual({
      provider: 'claude',
      model: '',
      detail: 'simple',
    });
    expect(
      effectiveAskChoice(
        { provider: 'codex', models: { codex: 'o3' }, detail: 'detailed' },
        settings,
      ),
    ).toEqual({
      provider: 'codex',
      model: 'o3',
      detail: 'detailed',
    });
    const info = (id: 'kiro' | 'claude' | 'mock', available: boolean) => ({
      id,
      name: id,
      description: '',
      available,
      enabled: true,
      warnings: [],
      models: [],
      capabilities: { fork: false, structuredOutput: false, cost: false, streaming: false },
      experimental: false,
    });
    const onlyClaude = [info('kiro', false), info('claude', true), info('mock', true)];
    expect(
      effectiveAskChoice(
        { provider: null, models: {}, detail: null },
        defaultSettings(),
        onlyClaude,
      ).provider,
    ).toBe('claude');
    expect(
      effectiveAskChoice({ provider: null, models: {}, detail: null }, defaultSettings(), [
        info('kiro', false),
        info('mock', true),
      ]).provider,
    ).toBe('mock');
    expect(queuePosition(conv, 'r2')).toBe(1);
    expect(queuePosition(conv, 'r1')).toBeUndefined();
  });
});
