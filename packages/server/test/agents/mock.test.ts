import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DETAIL_LEVEL_INFO, wordCount, type GraphSpec } from '@codesplainer/shared';
import { ProcessTracker } from '../../src/agents/process';
import { createMockProvider } from '../../src/agents/providers/mock';
import { findSymbols, parseImports } from '../../src/agents/providers/mock-scan';
import { AgentError, type ActivityInput, type AgentProvider } from '../../src/agents/types';
import {
  DEMO_FILES,
  makeEntry,
  makeRequest,
  makeTask,
  removeDir,
  specOf,
  tempDir,
  writeTree,
} from './helpers';

let dir: string;
let project: string;
let provider: AgentProvider;
const folders = () => [{ alias: 'demo', path: project }];

beforeAll(async () => {
  process.env.CODESPLAINER_MOCK_DELAY_MS = '0';
  dir = await tempDir('cs-mock-');
  project = join(dir, 'demo');
  await writeTree(project, { ...DEMO_FILES, 'node_modules/x/index.js': 'ignored' });
  provider = createMockProvider({
    dataDir: join(dir, 'data'),
    tracker: new ProcessTracker(),
    homeDir: dir,
  });
});

afterAll(async () => {
  delete process.env.CODESPLAINER_MOCK_DELAY_MS;
  await removeDir(dir);
});

/** Every ref must point to an existing file/dir inside the folder, line ranges inside the file. */
async function expectRefsExist(spec: GraphSpec): Promise<void> {
  for (const node of spec.nodes) {
    for (const ref of node.refs) {
      expect(ref.folder).toBe('demo');
      const abs = join(project, ref.path);
      const s = await stat(abs);
      if (ref.startLine !== undefined) {
        expect(s.isFile()).toBe(true);
        const lines = (await readFile(abs, 'utf8')).split('\n').length;
        expect(ref.startLine).toBeGreaterThanOrEqual(1);
        expect(ref.endLine ?? ref.startLine).toBeLessThanOrEqual(lines);
      }
    }
  }
}

function expectFewWords(spec: GraphSpec): void {
  expect(wordCount(spec.title)).toBeLessThanOrEqual(6);
  for (const n of spec.nodes) expect(wordCount(n.label)).toBeLessThanOrEqual(3);
}

describe('mock scanning helpers', () => {
  it('parses imports', () => {
    expect(parseImports(DEMO_FILES['src/app.ts'] as string, 'js')).toEqual([
      './db/store',
      '../lib/log',
    ]);
    expect(parseImports('from .db import x\nimport os.path\n', 'py')).toEqual(['.db', 'os.path']);
    expect(parseImports('use crate::db::Store;\nmod api;\n', 'rust')).toEqual([
      'crate::db::Store',
      'api',
    ]);
  });

  it('finds symbols with line ranges', () => {
    const symbols = findSymbols(DEMO_FILES['src/app.ts'] as string, 'js');
    expect(symbols.map((s) => [s.name, s.kind, s.startLine, s.endLine])).toEqual([
      ['main', 'function', 4, 10],
      ['App', 'class', 12, 16],
    ]);
    const py = findSymbols(
      'class A:\n    def a(self):\n        pass\n\n    def b(self):\n        return 1\n',
      'py',
    );
    expect(py.map((s) => [s.name, s.startLine, s.endLine])).toEqual([
      ['a', 2, 3],
      ['b', 5, 6],
    ]);
  });
});

describe('mock provider', () => {
  it('draws the top-level modules with import edges', async () => {
    const activity: ActivityInput[] = [];
    const graph = makeEntry({ type: 'question' }, 'How is this organized?');
    const res = await provider.run(
      makeRequest(makeTask({ folders: folders(), graph }), { activity }),
    );
    const spec = specOf(res.output);
    expect(spec.nodes.length).toBeLessThanOrEqual(DETAIL_LEVEL_INFO.balanced.max);
    const labels = spec.nodes.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(['db/', 'lib/', 'app.ts']));
    expect(labels).not.toContain('node_modules/');
    const byLabel = (l: string) => spec.nodes.find((n) => n.label === l)?.id;
    expect(spec.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: byLabel('app.ts'),
          to: byLabel('db/'),
          kind: 'dependency',
        }),
        expect.objectContaining({ from: byLabel('app.ts'), to: byLabel('lib/') }),
      ]),
    );
    expect(spec.nodes.some((n) => n.highlight)).toBe(true);
    expect(spec.summary).toMatch(/no AI/);
    expectFewWords(spec);
    await expectRefsExist(spec);
    expect(activity.map((a) => a.text)).toEqual(
      expect.arrayContaining(['Listing demo', 'Listing src']),
    );
  });

  it('expands a folder, a file and a line range', async () => {
    const root = makeEntry({ type: 'question' }, 'How is this organized?');
    const rootSpec = specOf(
      (await provider.run(makeRequest(makeTask({ folders: folders(), graph: root })))).output,
    );
    const parent = { ...root, status: 'done' as const, spec: rootSpec };
    const expand = async (nodeId: string) => {
      const node = rootSpec.nodes.find((n) => n.id === nodeId);
      const graph = makeEntry(
        { type: 'expand', parentGraphId: parent.id, nodeId, nodeLabel: node?.label ?? '' },
        '',
      );
      return specOf(
        (await provider.run(makeRequest(makeTask({ folders: folders(), graph, parent })))).output,
      );
    };
    const dbId = rootSpec.nodes.find((n) => n.label === 'db/')?.id as string;
    const db = await expand(dbId);
    expect(db.nodes.map((n) => n.label)).toContain('store.ts');
    await expectRefsExist(db);

    const appId = rootSpec.nodes.find((n) => n.label === 'app.ts')?.id as string;
    const app = await expand(appId);
    expect(app.nodes.map((n) => n.label)).toEqual(['main', 'App']);
    expect(app.nodes[0]?.refs[0]).toMatchObject({
      path: 'src/app.ts',
      startLine: 4,
      endLine: 10,
      symbol: 'main',
    });
    expect(app.edges).toEqual([
      expect.objectContaining({ from: 'app', to: 'main', label: 'calls' }),
    ]);
    await expectRefsExist(app);

    // Expanding a function (line range) gives a step-by-step flow.
    const fnParent = { ...parent, id: 'fn-parent', spec: app };
    const graph = makeEntry(
      { type: 'expand', parentGraphId: fnParent.id, nodeId: 'main', nodeLabel: 'main' },
      '',
    );
    const flow = specOf(
      (await provider.run(makeRequest(makeTask({ folders: folders(), graph, parent: fnParent }))))
        .output,
    );
    expect(flow.kind).toBe('flow');
    expect(flow.nodes.map((n) => n.label)).toEqual(
      expect.arrayContaining(['Call save', 'Check value']),
    );
    expect(flow.edges.every((e) => e.kind === 'flow' && e.step !== undefined)).toBe(true);
    await expectRefsExist(flow);
  });

  it('answers ask-code and ask-node questions', async () => {
    const ref = { folder: 'demo', path: 'src/db/store.ts', startLine: 1, endLine: 7 };
    const code = makeEntry({ type: 'ask-code', ref }, 'What does this do?');
    const spec = specOf(
      (await provider.run(makeRequest(makeTask({ folders: folders(), graph: code })))).output,
    );
    expect(spec.nodes.map((n) => n.label)).toEqual(['save', 'load']);
    await expectRefsExist(spec);

    const root = makeEntry({ type: 'question' }, 'Overview?');
    const rootSpec = specOf(
      (await provider.run(makeRequest(makeTask({ folders: folders(), graph: root })))).output,
    );
    const parent = { ...root, status: 'done' as const, spec: rootSpec };
    const libId = rootSpec.nodes.find((n) => n.label === 'lib/')?.id as string;
    const ask = makeEntry(
      { type: 'ask-node', parentGraphId: parent.id, nodeId: libId, nodeLabel: 'lib/' },
      'Is logging async?',
    );
    const answer = specOf(
      (await provider.run(makeRequest(makeTask({ folders: folders(), graph: ask, parent }))))
        .output,
    );
    expect(answer.nodes[0]?.label).toBe('You');
    expect(answer.nodes.some((n) => n.label === 'lib/' && n.highlight)).toBe(true);
    await expectRefsExist(answer);
  });

  it('answers the connectivity test and respects abort', async () => {
    const graph = makeEntry({ type: 'question' }, 'x');
    const task = makeTask({ folders: folders(), graph });
    const test = await provider.run(makeRequest(task, { purpose: 'test' }));
    expect(test.output).toEqual({ ok: true });
    const controller = new AbortController();
    controller.abort();
    const err = await provider
      .run(makeRequest(task, { signal: controller.signal }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('cancelled');
  });
});
