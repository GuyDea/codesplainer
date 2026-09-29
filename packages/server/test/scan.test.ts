import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Workspace } from '@codesplainer/shared';
import { IgnoreRules, isDefaultIgnored } from '../src/fs/ignore';
import { detectLanguage, languageName } from '../src/fs/languages';
import { OverviewCache } from '../src/fs/overview';
import { scanFolder, scanWorkspace } from '../src/fs/scan';
import { compactTree, renderCompactTree, TREE_MAX_LINES } from '../src/fs/tree';
import { removeDir, tempDir, writeTree } from './support';

let dir: string;
let root: string;

const workspaceOf = (folders: { alias: string; path: string }[]): Workspace => {
  const now = new Date().toISOString();
  return { id: 'w1', name: 'W', folders, createdAt: now, updatedAt: now };
};

beforeAll(async () => {
  dir = await realpath(await tempDir('cs-scan-'));
  root = join(dir, 'proj');
  await writeTree(root, {
    '.gitignore': 'generated/\n*.log\n!keep.log\n',
    'package.json': '{"name":"proj"}',
    'README.md': '# Proj',
    Dockerfile: 'FROM node',
    'src/index.ts': 'export const a = 1;\n'.repeat(50),
    'src/util.ts': 'export const b = 2;\n',
    'src/styles.css': 'body {}',
    'src/app.min.js': 'minified',
    'src/app.js.map': '{}',
    'src/debug.log': 'log',
    'src/keep.log': 'kept',
    'generated/out.ts': 'x',
    'node_modules/dep/index.js': 'x',
    'dist/bundle.js': 'x',
    'services/api/go.mod': 'module api',
    'services/api/main.go': 'package main\n',
    'services/api/.gitignore': 'tmp/\n',
    'services/api/tmp/cache.go': 'package tmp',
    'a/b/c/d/package.json': '{}',
    'scripts/build.py': 'print(1)',
  });
  await mkdir(join(root, '.git'), { recursive: true });
});

afterAll(async () => {
  await removeDir(dir);
});

describe('ignore rules', () => {
  it('applies default ignores', () => {
    expect(isDefaultIgnored('node_modules', true)).toBe(true);
    expect(isDefaultIgnored('.git', true)).toBe(true);
    expect(isDefaultIgnored('app.min.js', false)).toBe(true);
    expect(isDefaultIgnored('x.map', false)).toBe(true);
    expect(isDefaultIgnored('src', true)).toBe(false);
  });

  it('honours root and nested .gitignore files', async () => {
    const rules = new IgnoreRules(root);
    expect(await rules.isIgnored('generated/out.ts', false)).toBe(true);
    expect(await rules.isIgnored('src/debug.log', false)).toBe(true);
    expect(await rules.isIgnored('src/keep.log', false)).toBe(false);
    expect(await rules.isIgnored('services/api/tmp/cache.go', false)).toBe(true);
    expect(await rules.isIgnored('services/api/main.go', false)).toBe(false);
    expect(await rules.isIgnored('node_modules/dep/index.js', false)).toBe(true);
    expect(await rules.isIgnored('src/index.ts', false)).toBe(false);
  });
});

describe('languages', () => {
  it('maps file names to languages', () => {
    expect(languageName('a.ts')).toBe('TypeScript');
    expect(languageName('a.PY')).toBe('Python');
    expect(languageName('Dockerfile')).toBe('Dockerfile');
    expect(languageName('Makefile')).toBe('Makefile');
    expect(languageName('x.hpp')).toBe('C/C++');
    expect(languageName('x.cs')).toBe('C#');
    expect(detectLanguage('src/main.rs')).toEqual({ id: 'rust', name: 'Rust' });
    expect(languageName('data.bin')).toBeUndefined();
  });
});

describe('scanFolder', () => {
  it('counts files with ignore rules, languages by bytes and manifests', async () => {
    const { overview, tree } = await scanFolder({ alias: 'proj', path: root });
    expect(overview.exists).toBe(true);
    expect(overview.isGitRepo).toBe(true);
    expect(overview.truncated).toBe(false);
    // .gitignore, package.json, README.md, Dockerfile, 4 in src, 3 in services/api, 1 deep, 1 script
    expect(overview.fileCount).toBe(13);
    expect(overview.languages[0]).toMatchObject({ language: 'TypeScript', files: 2 });
    const names = overview.languages.map((l) => l.language);
    expect(names).toEqual(expect.arrayContaining(['Go', 'Python', 'CSS', 'JSON', 'Markdown']));
    expect(overview.manifests).toEqual([
      'Dockerfile',
      'package.json',
      'README.md',
      'services/api/go.mod',
    ]);
    expect(tree?.dirs.map((d) => d.name)).toEqual(['a', 'scripts', 'services', 'src']);
  });

  it('reports missing folders and stops at the budget', async () => {
    const missing = await scanFolder({ alias: 'x', path: join(dir, 'missing') });
    expect(missing.overview).toMatchObject({ exists: false, fileCount: 0 });
    expect(missing.tree).toBeNull();
    const small = await scanFolder({ alias: 'proj', path: root }, { maxFiles: 3 });
    expect(small.overview.truncated).toBe(true);
    expect(small.overview.fileCount).toBe(3);
  });

  it('aggregates a workspace and caches it', async () => {
    const ws = workspaceOf([
      { alias: 'proj', path: root },
      { alias: 'api', path: join(root, 'services', 'api') },
    ]);
    const scan = await scanWorkspace(ws);
    expect(scan.overview.folders).toHaveLength(2);
    // services/api is scanned as a folder of its own: go.mod, main.go, .gitignore.
    expect(scan.overview.totals.files).toBe(13 + 3);
    const cache = new OverviewCache();
    const first = await cache.get(ws);
    expect(await cache.get(ws)).toBe(first);
    expect(await cache.get(ws, { refresh: true })).not.toBe(first);
    const changed = await cache.get({ ...ws, folders: ws.folders.slice(0, 1) });
    expect(changed.overview.folders).toHaveLength(1);
  });
});

describe('compact tree', () => {
  it('renders folders, counts and notable files', async () => {
    const tree = await compactTree(workspaceOf([{ alias: 'proj', path: root }]));
    const lines = tree.split('\n');
    expect(lines[0]).toBe(`proj/  (${root})`);
    expect(tree).toContain('  package.json');
    expect(tree).toContain('  src/  (4 files)');
    expect(tree).toContain('    index.ts');
    expect(tree).toContain('  services/  (3 files)');
    expect(tree).not.toContain('node_modules');
    expect(tree).not.toContain('generated');
  });

  it('stays under the line cap for big trees, quickly', async () => {
    const big = join(dir, 'big');
    const files: Record<string, string> = {};
    for (let a = 0; a < 30; a++) {
      for (let b = 0; b < 12; b++) {
        files[`pkg${a}/mod${b}/index.ts`] = 'x';
        files[`pkg${a}/mod${b}/impl.ts`] = 'x';
      }
    }
    await writeTree(big, files);
    const started = Date.now();
    const scan = await scanWorkspace(workspaceOf([{ alias: 'big', path: big }]));
    const text = renderCompactTree(scan.folders);
    expect(Date.now() - started).toBeLessThan(5000);
    const lines = text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(TREE_MAX_LINES);
    expect(lines[0]).toBe(`big/  (${big})`);
    expect(text).toContain('pkg0/  (24 files)');
    const tiny = renderCompactTree(scan.folders, 10).split('\n');
    expect(tiny).toHaveLength(10);
    expect(tiny[9]).toMatch(/more lines\)$/);
  });
});
