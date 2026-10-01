import { appendFile, mkdir, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CodeRef, GraphNode, GraphSpec, Workspace } from '@codesplainer/shared';
import { normalizedRef, resolveCodeRef, resolveSpecRefs } from '../src/fs/refs';
import { removeDir, tempDir, writeTree } from './support';

let dir: string;
let web: string;
let api: string;
let workspace: Workspace;

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

beforeAll(async () => {
  dir = await realpath(await tempDir('cs-refs-'));
  web = join(dir, 'web');
  api = join(dir, 'api');
  await writeTree(web, {
    'src/main.ts': lines(10),
    'README.md': '# Web\n',
    'src/components/Button.tsx': 'x',
  });
  await writeTree(api, { 'server.go': lines(5), 'handlers/users.go': 'package handlers\n' });
  await writeTree(dir, { 'outside/secret.txt': 'secret' });
  await symlink(join(dir, 'outside'), join(web, 'escape'));
  await mkdir(join(api, 'empty'), { recursive: true });
  const now = new Date().toISOString();
  workspace = {
    id: 'w',
    name: 'W',
    folders: [
      { alias: 'web', path: web },
      { alias: 'api', path: api },
    ],
    createdAt: now,
    updatedAt: now,
  };
});

afterAll(async () => {
  await removeDir(dir);
});

function node(id: string, refs: CodeRef[]): GraphNode {
  return { id, label: id, kind: 'module', refs, expandable: true };
}

function spec(nodes: GraphNode[]): GraphSpec {
  return { title: 'T', kind: 'architecture', nodes, edges: [], groups: [] };
}

async function resolveOne(ref: CodeRef): Promise<{ refs: CodeRef[]; warnings: string[] }> {
  const result = await resolveSpecRefs(spec([node('a', [ref])]), workspace);
  return { refs: result.spec.nodes[0]?.refs ?? [], warnings: result.warnings };
}

describe('resolveSpecRefs', () => {
  it('resolves refs by alias and clamps line ranges to the file', async () => {
    expect(
      (await resolveOne({ folder: 'web', path: 'src/main.ts', startLine: 3, endLine: 50 })).refs,
    ).toEqual([{ folder: 'web', path: 'src/main.ts', startLine: 3, endLine: 10 }]);
    // Case-insensitive alias, messy path.
    expect(
      (await resolveOne({ folder: 'WEB', path: './src//main.ts', startLine: 2 })).refs,
    ).toEqual([{ folder: 'web', path: 'src/main.ts', startLine: 2 }]);
  });

  it('resolves absolute paths inside a folder', async () => {
    const { refs } = await resolveOne({
      path: join(api, 'server.go'),
      startLine: 2,
      endLine: 4,
      symbol: 'main',
    });
    expect(refs).toEqual([
      { folder: 'api', path: 'server.go', startLine: 2, endLine: 4, symbol: 'main' },
    ]);
  });

  it('tries every folder when no alias is given, and alias-prefixed paths', async () => {
    expect((await resolveOne({ path: 'handlers/users.go' })).refs).toEqual([
      { folder: 'api', path: 'handlers/users.go' },
    ]);
    expect((await resolveOne({ path: 'web/src/main.ts' })).refs).toEqual([
      { folder: 'web', path: 'src/main.ts' },
    ]);
    // A wrong alias still finds the file in another folder.
    expect((await resolveOne({ folder: 'web', path: 'server.go' })).refs).toEqual([
      { folder: 'api', path: 'server.go' },
    ]);
  });

  it('flags directories and drops their line ranges', async () => {
    expect(
      (await resolveOne({ folder: 'web', path: 'src/components', startLine: 1, endLine: 2 })).refs,
    ).toEqual([{ folder: 'web', path: 'src/components', isDir: true }]);
    expect((await resolveOne({ folder: 'api', path: '' })).refs).toEqual([
      { folder: 'api', path: '', isDir: true },
    ]);
    expect((await resolveOne({ folder: 'api', path: 'empty' })).refs).toEqual([
      { folder: 'api', path: 'empty', isDir: true },
    ]);
  });

  it('fixes inverted ranges and drops ranges past the end of the file', async () => {
    expect(
      (await resolveOne({ folder: 'web', path: 'src/main.ts', startLine: 8, endLine: 4 })).refs,
    ).toEqual([{ folder: 'web', path: 'src/main.ts', startLine: 4, endLine: 8 }]);
    expect(
      (await resolveOne({ folder: 'web', path: 'src/main.ts', startLine: 20, endLine: 30 })).refs,
    ).toEqual([{ folder: 'web', path: 'src/main.ts' }]);
    expect((await resolveOne({ folder: 'web', path: 'src/main.ts', endLine: 7 })).refs).toEqual([
      { folder: 'web', path: 'src/main.ts', startLine: 7, endLine: 7 },
    ]);
  });

  it('drops missing, escaping and traversing refs with a single warning', async () => {
    const result = await resolveSpecRefs(
      spec([
        node('ok', [{ folder: 'web', path: 'README.md' }]),
        node('gone', [
          { folder: 'web', path: 'missing.ts' },
          { folder: 'api', path: 'nope/x.go' },
        ]),
        node('escape', [{ folder: 'web', path: 'escape/secret.txt' }]),
        node('dots', [{ folder: 'api', path: '../web/src/main.ts' }]),
        node('outside', [{ path: join(dir, 'outside', 'secret.txt') }]),
      ]),
      workspace,
    );
    expect(result.warnings).toEqual(['Removed 5 reference(s) to missing files']);
    expect(result.spec.nodes.map((n) => n.refs.length)).toEqual([1, 0, 0, 0, 0]);
    expect(result.spec.nodes[0]?.refs[0]).toEqual({ folder: 'web', path: 'README.md' });
  });

  it('deduplicates refs that resolve to the same place and returns a new spec', async () => {
    const input = spec([
      node('a', [
        { folder: 'web', path: 'src/main.ts' },
        { path: 'web/src/main.ts' },
        { folder: 'web', path: 'src/main.ts', startLine: 1, endLine: 2 },
      ]),
    ]);
    const result = await resolveSpecRefs(input, workspace);
    expect(result.warnings).toEqual([]);
    expect(result.spec.nodes[0]?.refs).toEqual([
      { folder: 'web', path: 'src/main.ts' },
      { folder: 'web', path: 'src/main.ts', startLine: 1, endLine: 2 },
    ]);
    expect(input.nodes[0]?.refs).toHaveLength(3);
  });

  it('notices when a file grows (line counts are cached by mtime and size)', async () => {
    const file = join(dir, 'grow');
    await writeTree(file, { 'a.ts': lines(3) });
    const ws: Workspace = { ...workspace, folders: [{ alias: 'grow', path: file }] };
    const ref: CodeRef = { folder: 'grow', path: 'a.ts', startLine: 1, endLine: 20 };
    expect(
      (await resolveSpecRefs(spec([node('a', [ref])]), ws)).spec.nodes[0]?.refs[0]?.endLine,
    ).toBe(3);
    await appendFile(join(file, 'a.ts'), lines(12));
    expect(
      (await resolveSpecRefs(spec([node('a', [ref])]), ws)).spec.nodes[0]?.refs[0]?.endLine,
    ).toBe(15);
  });
});

describe('resolveCodeRef / normalizedRef', () => {
  it('resolves a single ref for ask-code prompts', async () => {
    const target = await resolveCodeRef(
      { folder: 'api', path: 'server.go', startLine: 9, endLine: 3 },
      workspace,
    );
    expect(target).toMatchObject({
      rel: 'server.go',
      isDir: false,
      lineCount: 5,
      folder: { alias: 'api' },
    });
    expect(
      normalizedRef({ folder: 'api', path: 'server.go', startLine: 9, endLine: 3 }, target!),
    ).toEqual({
      folder: 'api',
      path: 'server.go',
      startLine: 3,
      endLine: 5,
    });
    expect(await resolveCodeRef({ folder: 'api', path: 'missing.go' }, workspace)).toBeUndefined();
  });
});
