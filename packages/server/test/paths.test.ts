import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Workspace } from '@codesplainer/shared';
import { HttpError } from '../src/errors';
import {
  checkPath,
  cleanUserPath,
  isInside,
  locateAbsolute,
  normalizeFolderPaths,
  resolveInFolder,
  safeRelativePath,
  samePathSet,
} from '../src/fs/paths';
import { removeDir, tempDir, writeTree } from './support';

let dir: string;
let root: string;
let workspace: Workspace;

beforeAll(async () => {
  dir = await realpath(await tempDir('cs-paths-'));
  root = join(dir, 'proj');
  await writeTree(root, { 'src/a.ts': 'a', 'docs/readme.md': 'r' });
  await writeTree(dir, { 'outside/secret.txt': 'secret' });
  await symlink(join(dir, 'outside'), join(root, 'escape'));
  await symlink(join(dir, 'outside', 'secret.txt'), join(root, 'secret-link.txt'));
  await symlink(join(root, 'src', 'a.ts'), join(root, 'inner-link.ts'));
  await writeFile(join(dir, 'a-file'), 'x');
  const now = new Date().toISOString();
  workspace = {
    id: 'w',
    name: 'W',
    folders: [
      { alias: 'proj', path: root },
      { alias: 'docs', path: join(root, 'docs') },
    ],
    createdAt: now,
    updatedAt: now,
  };
});

afterAll(async () => {
  await removeDir(dir);
});

async function rejects(p: Promise<unknown>, status: number): Promise<HttpError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  return err as HttpError;
}

describe('relative paths', () => {
  it('normalizes safe paths', () => {
    expect(safeRelativePath('')).toBe('');
    expect(safeRelativePath('./src//a.ts')).toBe('src/a.ts');
    expect(safeRelativePath('src\\a.ts')).toBe('src/a.ts');
    expect(safeRelativePath('src/')).toBe('src');
  });

  it('rejects absolute paths and parent segments', () => {
    for (const bad of ['/etc/passwd', 'C:\\Windows', '../x', 'src/../../x', 'a/..', 'x\0y']) {
      expect(() => safeRelativePath(bad)).toThrow(HttpError);
    }
  });

  it('checks containment', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
    expect(isInside('/a/b', '/a/b/..cache')).toBe(true);
  });
});

describe('resolveInFolder', () => {
  it('resolves files and directories inside a folder', async () => {
    const file = await resolveInFolder(workspace, 'proj', 'src/a.ts');
    expect(file.rel).toBe('src/a.ts');
    expect(file.abs).toBe(join(root, 'src', 'a.ts'));
    expect(file.stats.isFile()).toBe(true);
    const top = await resolveInFolder(workspace, undefined, '');
    expect(top.folder.alias).toBe('proj');
    expect(top.stats.isDirectory()).toBe(true);
    expect((await resolveInFolder(workspace, 'PROJ', 'inner-link.ts')).real).toBe(
      join(root, 'src', 'a.ts'),
    );
  });

  it('rejects traversal, absolute paths and symlinks that escape', async () => {
    await rejects(resolveInFolder(workspace, 'proj', '../outside/secret.txt'), 400);
    await rejects(resolveInFolder(workspace, 'proj', join(dir, 'outside', 'secret.txt')), 400);
    const escape = await rejects(resolveInFolder(workspace, 'proj', 'escape/secret.txt'), 403);
    expect(escape.code).toBe('outside_folder');
    await rejects(resolveInFolder(workspace, 'proj', 'secret-link.txt'), 403);
    await rejects(resolveInFolder(workspace, 'proj', 'missing.ts'), 404);
    await rejects(resolveInFolder(workspace, 'nope', 'src/a.ts'), 404);
  });

  it('maps absolute paths back to folders (longest folder wins)', () => {
    expect(locateAbsolute(workspace, join(root, 'src', 'a.ts'))).toMatchObject({
      folder: { alias: 'proj' },
      rel: 'src/a.ts',
    });
    expect(locateAbsolute(workspace, join(root, 'docs', 'readme.md'))).toMatchObject({
      folder: { alias: 'docs' },
      rel: 'readme.md',
    });
    expect(locateAbsolute(workspace, join(dir, 'outside'))).toBeUndefined();
    expect(locateAbsolute(workspace, 'relative/path')).toBeUndefined();
  });
});

describe('workspace folder normalization', () => {
  it('expands, resolves and deduplicates', async () => {
    const paths = await normalizeFolderPaths([
      root,
      `${root}/`,
      `"${root}"`,
      join(root, 'src', '..'),
    ]);
    expect(paths).toEqual([root]);
    expect(await normalizeFolderPaths(['proj'], { base: dir })).toEqual([root]);
    expect(cleanUserPath('~/x', '/home/me')).toBe('/home/me/x');
    expect(samePathSet(['/a', '/b'], ['/b', '/a/'])).toBe(true);
  });

  it('rejects relative, missing and non-directory paths with clear messages', async () => {
    expect((await rejects(normalizeFolderPaths(['relative/dir']), 400)).message).toMatch(
      /absolute/,
    );
    expect((await rejects(normalizeFolderPaths([join(dir, 'missing')]), 400)).message).toMatch(
      /not found/,
    );
    expect((await rejects(normalizeFolderPaths([join(dir, 'a-file')]), 400)).message).toMatch(
      /Not a folder/,
    );
  });

  it('checks arbitrary paths', async () => {
    expect(await checkPath(root)).toMatchObject({
      exists: true,
      isDir: true,
      readable: true,
      realPath: root,
    });
    expect(await checkPath(join(dir, 'a-file'))).toMatchObject({ exists: true, isDir: false });
    expect(await checkPath(join(dir, 'missing'))).toEqual({
      exists: false,
      isDir: false,
      readable: false,
    });
    expect(await checkPath('relative')).toEqual({ exists: false, isDir: false, readable: false });
  });
});

describe('symlinked folder creation', () => {
  it('stores the real path of a symlinked folder', async () => {
    const link = join(dir, 'proj-link');
    await symlink(root, link);
    await mkdir(join(dir, 'empty'), { recursive: true });
    expect(await normalizeFolderPaths([link, join(dir, 'empty')])).toEqual([
      root,
      join(dir, 'empty'),
    ]);
  });
});
