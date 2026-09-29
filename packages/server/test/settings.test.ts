import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_NAME,
  APP_VERSION,
  PROVIDER_IDS,
  defaultSettings,
  type HealthResponse,
  type ProviderInfo,
  type ProviderTestResponse,
  type Settings,
} from '@codesplainer/shared';
import {
  call,
  expectStatus,
  makeProject,
  recordEvents,
  removeDir,
  startServer,
  waitFor,
  type TestServer,
} from './support';

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server.close();
  await removeDir(server.dataDir);
});

describe('settings', () => {
  it('returns defaults, merges patches and persists them', async () => {
    expect(expectStatus(await call<Settings>(server, 'GET', '/api/settings'), 200)).toEqual(
      defaultSettings(),
    );
    const log = recordEvents(server);
    const updated = expectStatus(
      await call<Settings>(server, 'PUT', '/api/settings', {
        detail: 'detailed',
        providers: { claude: { model: 'opus', extraArgs: ['--verbose'] } },
        acp: { command: 'opencode', args: ['acp'] },
      }),
      200,
    );
    expect(updated.detail).toBe('detailed');
    expect(updated.providers.claude).toMatchObject({
      model: 'opus',
      extraArgs: ['--verbose'],
      enabled: true,
      reuseSessions: true,
    });
    expect(updated.providers.codex).toEqual(defaultSettings().providers.codex);
    expect(updated.acp).toMatchObject({
      command: 'opencode',
      args: ['acp'],
      name: 'Custom ACP agent',
    });

    // A second patch merges into the first one.
    const merged = expectStatus(
      await call<Settings>(server, 'PUT', '/api/settings', {
        providers: { claude: { effort: 'high' } },
      }),
      200,
    );
    // Regression: omitted nested keys must not be reset to their defaults.
    expect(merged.providers.claude).toMatchObject({
      model: 'opus',
      extraArgs: ['--verbose'],
      effort: 'high',
    });
    expect(merged.detail).toBe('detailed');
    const acp = expectStatus(
      await call<Settings>(server, 'PUT', '/api/settings', { acp: { allowExecute: true } }),
      200,
    );
    expect(acp.acp).toEqual({
      name: 'Custom ACP agent',
      command: 'opencode',
      args: ['acp'],
      allowExecute: true,
    });
    expect(acp.providers.claude.model).toBe('opus');

    expect(log.of('settings.updated').map((e) => e.settings.providers.claude.effort)).toEqual([
      '',
      'high',
      'high',
    ]);
    await waitFor(() => log.of('providers.updated').length >= 3);
    log.stop();

    await server.ctx.stores.settings.flush();
    const onDisk = JSON.parse(
      await readFile(join(server.dataDir, 'settings.json'), 'utf8'),
    ) as Settings;
    expect(onDisk.providers.claude.effort).toBe('high');
    expect(onDisk.acp.allowExecute).toBe(true);
    expect(expectStatus(await call<Settings>(server, 'GET', '/api/settings'), 200)).toEqual(acp);
  });

  it('only re-detects providers when provider settings change', async () => {
    const log = recordEvents(server);
    await call(server, 'PUT', '/api/settings', { theme: 'dark' });
    await new Promise((r) => setTimeout(r, 30));
    expect(log.of('settings.updated')).toHaveLength(1);
    expect(log.of('providers.updated')).toHaveLength(0);
    await call(server, 'PUT', '/api/settings', { defaultProvider: 'mock' });
    await waitFor(() => log.of('providers.updated').length === 1);
    log.stop();
  });

  it('rejects invalid settings', async () => {
    const res = await call(server, 'PUT', '/api/settings', { maxConcurrentJobs: 99 });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      error: { code: 'invalid_request', details: expect.any(String) },
    });
    expect(
      (await call(server, 'PUT', '/api/settings', { providers: { claude: { enabled: 'yes' } } }))
        .status,
    ).toBe(400);
    expect((await call(server, 'PUT', '/api/settings', { defaultProvider: 'gpt' })).status).toBe(
      400,
    );
    expect(
      expectStatus(await call<Settings>(server, 'GET', '/api/settings'), 200).maxConcurrentJobs,
    ).toBe(2);
  });
});

describe('providers', () => {
  it('lists providers in contract order', async () => {
    const { providers } = expectStatus(
      await call<{ providers: ProviderInfo[] }>(server, 'GET', '/api/providers'),
      200,
    );
    expect(providers.map((p) => p.id)).toEqual([...PROVIDER_IDS]);
    expect(providers.find((p) => p.id === 'mock')).toMatchObject({
      available: true,
      enabled: true,
    });
    expect(providers.find((p) => p.id === 'kiro')).toMatchObject({
      available: false,
      reason: 'not installed (test)',
    });
  });

  it('refreshes detection and broadcasts the result', async () => {
    const log = recordEvents(server);
    const res = expectStatus(
      await call<{ providers: ProviderInfo[] }>(server, 'POST', '/api/providers/refresh', {}),
      200,
    );
    log.stop();
    expect(res.providers).toHaveLength(PROVIDER_IDS.length);
    expect(log.of('providers.updated')).toHaveLength(1);
  });

  it('runs provider smoke tests', async () => {
    const res = expectStatus(
      await call<ProviderTestResponse>(server, 'POST', '/api/providers/mock/test', {}),
      200,
    );
    expect(res).toMatchObject({ ok: true, provider: 'mock' });
    const unknown = await call(server, 'POST', '/api/providers/gpt/test', {});
    expect(unknown.status).toBe(404);
  });
});

describe('health', () => {
  it('describes the server', async () => {
    const health = expectStatus(await call<HealthResponse>(server, 'GET', '/api/health'), 200);
    expect(health).toMatchObject({
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      dataDir: server.dataDir,
      pid: process.pid,
      platform: process.platform,
      nativePicker: expect.any(Boolean),
    });
    expect(health.startupWorkspaceId).toBeUndefined();
  });

  it('reports the workspace made from command line folders', async () => {
    const project = await makeProject();
    try {
      const first = await server.ctx.workspaces.openOrCreate(['.'], project);
      const again = await server.ctx.workspaces.openOrCreate([project, `${project}/`], '/');
      expect(again.id).toBe(first.id);
      expect(first.folders).toEqual([{ alias: first.folders[0]!.alias, path: project }]);
      server.ctx.startupWorkspaceId = first.id;
      const health = expectStatus(await call<HealthResponse>(server, 'GET', '/api/health'), 200);
      expect(health.startupWorkspaceId).toBe(first.id);
      await expect(server.ctx.workspaces.openOrCreate(['missing-folder'], project)).rejects.toThrow(
        /Folder not found/,
      );
    } finally {
      server.ctx.startupWorkspaceId = undefined;
      await removeDir(project);
    }
  });
});
