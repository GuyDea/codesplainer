import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BrowseResult,
  DirListing,
  FileContent,
  FsCheckResponse,
  HealthResponse,
  Workspace,
  WorkspaceOverview,
} from '@codesplainer/shared';
import { LAST_OPENED_THROTTLE_MS } from '../src/constants';
import {
  PROJECT_FILES,
  call,
  createConversation,
  createWorkspace,
  expectStatus,
  makeProject,
  recordEvents,
  removeDir,
  startServer,
  tempDir,
  writeTree,
  type TestServer,
} from './support';

// Never pop up a real folder dialog on the developer's desktop.
delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;

let server: TestServer;
let root: string;
let proj: string;
let other: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  root = await realpath(await tempDir('cs-ws-'));
  proj = join(root, 'proj');
  other = join(root, 'lib', 'proj');
  await writeTree(proj, {
    ...PROJECT_FILES,
    'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]),
    '.hidden/x.ts': 'x',
  });
  await mkdir(join(proj, '.git'), { recursive: true });
  await writeTree(other, { 'main.go': 'package main\n' });
  await writeFile(join(root, 'plain-file.txt'), 'x');
  server = await startServer();
});

afterAll(async () => {
  await server.close();
  await removeDir(server.dataDir);
  await removeDir(root);
});

describe('workspace CRUD', () => {
  it('creates workspaces with normalized folders, aliases and default names', async () => {
    const log = recordEvents(server);
    const ws = await createWorkspace(server, [`${proj}/`, other, proj]);
    log.stop();
    expect(ws.name).toBe('proj +1');
    expect(ws.folders).toEqual([
      { alias: 'proj', path: proj },
      { alias: 'proj-2', path: other },
    ]);
    expect(ws.lastOpenedAt).toBeDefined();
    expect(log.of('workspace.updated').map((e) => e.workspace.id)).toEqual([ws.id]);

    const single = await createWorkspace(server, [other], 'Go service');
    expect(single).toMatchObject({ name: 'Go service', folders: [{ alias: 'proj', path: other }] });
    const tilde = await call<Workspace>(server, 'POST', '/api/workspaces', { folders: ['~'] });
    expect(expectStatus(tilde, 201).folders[0]?.path).toBe(await realpath(homedir()));
  });

  it('rejects bad folders with clear messages', async () => {
    const missing = await call(server, 'POST', '/api/workspaces', {
      folders: [join(root, 'missing')],
    });
    expect(missing.status).toBe(400);
    expect(missing.json).toMatchObject({
      error: { code: 'invalid_request', message: expect.stringMatching(/Folder not found/) },
    });
    const relative = await call(server, 'POST', '/api/workspaces', { folders: ['relative/dir'] });
    expect(relative.json).toMatchObject({ error: { message: expect.stringMatching(/absolute/) } });
    const file = await call(server, 'POST', '/api/workspaces', {
      folders: [join(root, 'plain-file.txt')],
    });
    expect(file.json).toMatchObject({ error: { message: expect.stringMatching(/Not a folder/) } });
    expect((await call(server, 'GET', '/api/workspaces/nope')).status).toBe(404);
  });

  it('lists most recently used first and tracks visits (throttled)', async () => {
    const a = await createWorkspace(server, [proj], 'A');
    await sleep(5);
    const b = await createWorkspace(server, [other], 'B');
    let list = expectStatus(
      await call<{ workspaces: Workspace[] }>(server, 'GET', '/api/workspaces'),
      200,
    );
    expect(list.workspaces.findIndex((w) => w.id === b.id)).toBeLessThan(
      list.workspaces.findIndex((w) => w.id === a.id),
    );

    // Pretend A was last opened long ago: the next GET records a visit, the one after is throttled.
    const old = new Date(Date.now() - LAST_OPENED_THROTTLE_MS - 5_000).toISOString();
    await server.ctx.stores.workspaces.put({ ...a, lastOpenedAt: old });
    const log = recordEvents(server);
    const visited = expectStatus(
      await call<Workspace>(server, 'GET', `/api/workspaces/${a.id}`),
      200,
    );
    expect(visited.lastOpenedAt! > old).toBe(true);
    const again = expectStatus(
      await call<Workspace>(server, 'GET', `/api/workspaces/${a.id}`),
      200,
    );
    expect(again.lastOpenedAt).toBe(visited.lastOpenedAt);
    log.stop();
    expect(log.of('workspace.updated').map((e) => e.workspace.id)).toEqual([a.id]);

    list = expectStatus(
      await call<{ workspaces: Workspace[] }>(server, 'GET', '/api/workspaces'),
      200,
    );
    expect(list.workspaces[0]?.id).toBe(a.id);
  });

  it('updates names and folders, keeping aliases of unchanged folders', async () => {
    const extra = await makeProject({ 'x.py': 'print(1)' }, 'proj-');
    try {
      const ws = await createWorkspace(server, [proj], 'Before');
      const renamed = expectStatus(
        await call<Workspace>(server, 'PATCH', `/api/workspaces/${ws.id}`, { name: 'After' }),
        200,
      );
      expect(renamed).toMatchObject({ name: 'After', folders: ws.folders });
      expect(renamed.updatedAt > ws.updatedAt).toBe(true);

      await server.ctx.overview.overview(renamed);
      const updated = expectStatus(
        await call<Workspace>(server, 'PATCH', `/api/workspaces/${ws.id}`, {
          folders: [other, proj, extra],
        }),
        200,
      );
      expect(updated.folders).toEqual([
        { alias: 'proj-2', path: other },
        { alias: 'proj', path: proj },
        { alias: basename(extra), path: extra },
      ]);
      // The overview cache follows the folder change.
      const overview = expectStatus(
        await call<WorkspaceOverview>(server, 'GET', `/api/workspaces/${ws.id}/overview`),
        200,
      );
      expect(overview.folders.map((f) => f.alias)).toEqual(['proj-2', 'proj', basename(extra)]);

      const bad = await call(server, 'PATCH', `/api/workspaces/${ws.id}`, {
        folders: [join(root, 'nope')],
      });
      expect(bad.status).toBe(400);
      expect((await call(server, 'PATCH', '/api/workspaces/nope', { name: 'x' })).status).toBe(404);
    } finally {
      await removeDir(extra);
    }
  });

  it('keeps folders that are missing on disk when other folders change', async () => {
    const now = new Date().toISOString();
    const missing = join(root, 'moved-away');
    const imported: Workspace = {
      id: 'imported1',
      name: 'Imported',
      folders: [{ alias: 'old', path: missing }],
      createdAt: now,
      updatedAt: now,
    };
    await server.ctx.stores.workspaces.put(imported);
    const res = await call<Workspace>(server, 'PATCH', `/api/workspaces/${imported.id}`, {
      folders: [missing, proj],
    });
    expect(expectStatus(res, 200).folders).toEqual([
      { alias: 'old', path: missing },
      { alias: 'proj', path: proj },
    ]);
    // New paths are still validated.
    const bad = await call(server, 'PATCH', `/api/workspaces/${imported.id}`, {
      folders: [missing, join(root, 'also-missing')],
    });
    expect(bad.status).toBe(400);
  });

  it('deletes a workspace together with its conversations', async () => {
    const ws = await createWorkspace(server, [proj], 'Doomed');
    const c1 = await createConversation(server, ws.id);
    const c2 = await createConversation(server, ws.id, 'Second');
    const log = recordEvents(server);
    expect(expectStatus(await call(server, 'DELETE', `/api/workspaces/${ws.id}`), 200)).toEqual({
      ok: true,
    });
    log.stop();
    expect(
      log
        .of('conversation.deleted')
        .map((e) => e.conversationId)
        .sort(),
    ).toEqual([c1.id, c2.id].sort());
    expect(log.of('workspace.deleted')).toEqual([
      { type: 'workspace.deleted', workspaceId: ws.id },
    ]);
    expect(log.events[log.events.length - 1]?.type).toBe('workspace.deleted');
    expect((await call(server, 'GET', `/api/workspaces/${ws.id}`)).status).toBe(404);
    expect((await call(server, 'GET', `/api/conversations/${c1.id}`)).status).toBe(404);
    const list = expectStatus(
      await call<{ conversations: unknown[] }>(
        server,
        'GET',
        `/api/conversations?workspaceId=${ws.id}`,
      ),
      200,
    );
    expect(list.conversations).toEqual([]);
  });
});

describe('workspace files', () => {
  let ws: Workspace;
  beforeAll(async () => {
    ws = await createWorkspace(server, [proj, other]);
  });

  it('returns the overview (cached, refreshable)', async () => {
    const first = expectStatus(
      await call<WorkspaceOverview>(server, 'GET', `/api/workspaces/${ws.id}/overview`),
      200,
    );
    expect(first.workspaceId).toBe(ws.id);
    const folder = first.folders[0]!;
    expect(folder).toMatchObject({
      alias: 'proj',
      exists: true,
      isGitRepo: true,
      truncated: false,
    });
    expect(folder.manifests).toEqual(['package.json', 'README.md']);
    expect(folder.languages[0]?.language).toBe('TypeScript');
    expect(first.totals.files).toBe(folder.fileCount + 1);
    const cached = expectStatus(
      await call<WorkspaceOverview>(server, 'GET', `/api/workspaces/${ws.id}/overview`),
      200,
    );
    expect(cached.scannedAt).toBe(first.scannedAt);
    await new Promise((r) => setTimeout(r, 5));
    const fresh = expectStatus(
      await call<WorkspaceOverview>(server, 'GET', `/api/workspaces/${ws.id}/overview?refresh=1`),
      200,
    );
    expect(fresh.scannedAt > first.scannedAt).toBe(true);
  });

  it('lists directories: folders first, ignored entries flagged, .git hidden', async () => {
    const top = expectStatus(
      await call<DirListing>(server, 'GET', `/api/workspaces/${ws.id}/dir?folder=proj&path=`),
      200,
    );
    expect(top.folder).toBe('proj');
    expect(top.truncated).toBe(false);
    const names = top.entries.map((e) => e.name);
    expect(names).not.toContain('.git');
    expect(names.slice(0, 5)).toEqual(['.hidden', 'lib', 'logs', 'node_modules', 'src']);
    const byName = new Map(top.entries.map((e) => [e.name, e]));
    expect(byName.get('node_modules')).toMatchObject({ type: 'dir', ignored: true });
    expect(byName.get('logs')).toMatchObject({ ignored: true });
    expect(byName.get('secret.txt')).toMatchObject({ type: 'file', ignored: true });
    expect(byName.get('package.json')).toMatchObject({ type: 'file', size: expect.any(Number) });
    expect(byName.get('package.json')?.ignored).toBeUndefined();

    const src = expectStatus(
      await call<DirListing>(server, 'GET', `/api/workspaces/${ws.id}/dir?folder=proj&path=src`),
      200,
    );
    expect(src.entries.map((e) => e.path)).toEqual(['src/db', 'src/app.ts']);
    const dflt = expectStatus(
      await call<DirListing>(server, 'GET', `/api/workspaces/${ws.id}/dir`),
      200,
    );
    expect(dflt.folder).toBe('proj');
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/dir?folder=proj&path=../..`)).status,
    ).toBe(400);
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/dir?folder=proj&path=package.json`))
        .status,
    ).toBe(400);
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/dir?folder=zzz&path=`)).status,
    ).toBe(404);
  });

  it('reads files (text, binary, errors)', async () => {
    const file = expectStatus(
      await call<FileContent>(
        server,
        'GET',
        `/api/workspaces/${ws.id}/file?folder=proj&path=src/app.ts`,
      ),
      200,
    );
    expect(file).toMatchObject({
      folder: 'proj',
      path: 'src/app.ts',
      absolutePath: join(proj, 'src', 'app.ts'),
      binary: false,
      truncated: false,
      language: 'typescript',
      lineCount: 16,
    });
    expect(file.content).toBe(PROJECT_FILES['src/app.ts']);
    const image = expectStatus(
      await call<FileContent>(
        server,
        'GET',
        `/api/workspaces/${ws.id}/file?folder=proj&path=image.png`,
      ),
      200,
    );
    expect(image).toMatchObject({ binary: true, content: '', size: 7 });
    const second = expectStatus(
      await call<FileContent>(
        server,
        'GET',
        `/api/workspaces/${ws.id}/file?folder=proj-2&path=main.go`,
      ),
      200,
    );
    expect(second).toMatchObject({ folder: 'proj-2', language: 'go', lineCount: 1 });
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/file?folder=proj&path=/etc/passwd`))
        .status,
    ).toBe(400);
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/file?folder=proj&path=../proj/x`))
        .status,
    ).toBe(400);
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/file?folder=proj&path=src`)).status,
    ).toBe(400);
    expect(
      (await call(server, 'GET', `/api/workspaces/${ws.id}/file?folder=proj&path=nope.ts`)).status,
    ).toBe(404);
  });

  it('truncates very large files at a line boundary', async () => {
    const big = await makeProject({ 'big.txt': `${'x'.repeat(99)}\n`.repeat(20_000) });
    try {
      const bigWs = await createWorkspace(server, [big]);
      const res = expectStatus(
        await call<FileContent>(server, 'GET', `/api/workspaces/${bigWs.id}/file?path=big.txt`),
        200,
      );
      expect(res.truncated).toBe(true);
      expect(res.size).toBe(2_000_000);
      expect(res.content.length).toBeLessThanOrEqual(1.5 * 1024 * 1024);
      expect(res.content.endsWith('\n')).toBe(true);
    } finally {
      await removeDir(big);
    }
  });

  it.runIf(process.platform !== 'win32')('opens files in the configured editor', async () => {
    await call(server, 'PUT', '/api/settings', { editorCommand: 'true --flag' });
    const res = expectStatus(
      await call<{ ok: boolean; command: string }>(
        server,
        'POST',
        `/api/workspaces/${ws.id}/open`,
        {
          folder: 'proj',
          path: 'src/app.ts',
          line: 3,
        },
      ),
      200,
    );
    expect(res).toEqual({ ok: true, command: `true --flag ${join(proj, 'src', 'app.ts')}` });
    await call(server, 'PUT', '/api/settings', { editorCommand: 'definitely-not-an-editor-cs' });
    const missing = await call(server, 'POST', `/api/workspaces/${ws.id}/open`, {
      folder: 'proj',
      path: 'src/app.ts',
    });
    expect(missing.status).toBe(400);
    expect(missing.json).toMatchObject({
      error: { message: expect.stringMatching(/Editor command not found/) },
    });
    const outside = await call(server, 'POST', `/api/workspaces/${ws.id}/open`, {
      folder: 'proj',
      path: '../x',
    });
    expect(outside.status).toBe(400);
    await call(server, 'PUT', '/api/settings', { editorCommand: '' });
  });
});

describe('local file system', () => {
  it('browses directories only', async () => {
    const res = expectStatus(
      await call<BrowseResult>(server, 'GET', `/api/fs/browse?path=${encodeURIComponent(proj)}`),
      200,
    );
    expect(res.path).toBe(proj);
    expect(res.parent).toBe(root);
    expect(res.separator).toBe(sep);
    expect(res.home).toBe(homedir());
    expect(res.entries.map((e) => e.name)).toEqual(['lib', 'logs', 'node_modules', 'src']);
    expect(res.shortcuts[0]).toEqual({ label: 'Home', path: homedir() });
    expect(res.shortcuts.some((s) => s.path === proj)).toBe(true);
    expect(res.shortcuts[res.shortcuts.length - 1]?.label).toBe('Computer');

    const hidden = expectStatus(
      await call<BrowseResult>(
        server,
        'GET',
        `/api/fs/browse?path=${encodeURIComponent(proj)}&hidden=1`,
      ),
      200,
    );
    expect(hidden.entries.map((e) => e.name)).toEqual([
      '.git',
      '.hidden',
      'lib',
      'logs',
      'node_modules',
      'src',
    ]);
    expect(hidden.entries.find((e) => e.name === '.hidden')).toMatchObject({ hidden: true });

    const up = expectStatus(
      await call<BrowseResult>(server, 'GET', `/api/fs/browse?path=${encodeURIComponent(root)}`),
      200,
    );
    expect(up.entries.find((e) => e.name === 'proj')).toMatchObject({
      isGitRepo: true,
      path: proj,
    });
    const home = expectStatus(await call<BrowseResult>(server, 'GET', '/api/fs/browse'), 200);
    expect(home.path).toBe(homedir());
    const rootDir = expectStatus(
      await call<BrowseResult>(server, 'GET', '/api/fs/browse?path=/'),
      200,
    );
    expect(rootDir.parent).toBeNull();

    expect((await call(server, 'GET', '/api/fs/browse?path=relative')).status).toBe(400);
    expect(
      (await call(server, 'GET', `/api/fs/browse?path=${encodeURIComponent(join(root, 'nope'))}`))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          server,
          'GET',
          `/api/fs/browse?path=${encodeURIComponent(join(root, 'plain-file.txt'))}`,
        )
      ).status,
    ).toBe(400);
  });

  it('checks paths', async () => {
    const res = expectStatus(
      await call<FsCheckResponse>(server, 'POST', '/api/fs/check', {
        paths: [proj, join(root, 'plain-file.txt'), join(root, 'missing')],
      }),
      200,
    );
    expect(res.results[proj]).toEqual({
      exists: true,
      isDir: true,
      readable: true,
      realPath: proj,
    });
    expect(res.results[join(root, 'plain-file.txt')]).toMatchObject({ exists: true, isDir: false });
    expect(res.results[join(root, 'missing')]).toEqual({
      exists: false,
      isDir: false,
      readable: false,
    });
    expect((await call(server, 'POST', '/api/fs/check', { paths: [] })).status).toBe(400);
  });

  it.runIf(process.platform === 'linux')(
    'returns no paths when no native dialog is available',
    async () => {
      const res = expectStatus(
        await call<{ paths: string[] }>(server, 'POST', '/api/fs/pick-folder', {}),
        200,
      );
      expect(res).toEqual({ paths: [] });
      const health = expectStatus(await call<HealthResponse>(server, 'GET', '/api/health'), 200);
      expect(health.nativePicker).toBe(false);
    },
  );
});
