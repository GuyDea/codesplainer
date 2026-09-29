import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_HEADER } from '@codesplainer/shared';
import { allowedHostnames, hostnameOf, isAllowedOrigin } from '../src/http/security';
import { call, removeDir, startServer, tempDir, writeTree, type TestServer } from './support';

let server: TestServer;

beforeAll(async () => {
  server = await startServer({ config: { host: '127.0.0.1' } });
});

afterAll(async () => {
  await server.close();
  await removeDir(server.dataDir);
});

describe('host / origin parsing', () => {
  it('extracts host names from Host headers', () => {
    expect(hostnameOf('localhost:4777')).toBe('localhost');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:4777')).toBe('::1');
    expect(hostnameOf('LOCALHOST')).toBe('localhost');
    expect(hostnameOf('::1')).toBeUndefined();
    expect(hostnameOf('localhost:abc')).toBeUndefined();
    expect(hostnameOf('')).toBeUndefined();
  });

  it('accepts only same-machine origins', () => {
    const hosts = allowedHostnames('127.0.0.1');
    expect(isAllowedOrigin('http://localhost:5173', hosts)).toBe(true);
    expect(isAllowedOrigin('https://127.0.0.1:4777', hosts)).toBe(true);
    expect(isAllowedOrigin('http://[::1]:4777', hosts)).toBe(true);
    expect(isAllowedOrigin('http://evil.example.com', hosts)).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com', hosts)).toBe(false);
    expect(isAllowedOrigin('null', hosts)).toBe(false);
    expect(isAllowedOrigin('file:///x', hosts)).toBe(false);
    expect(allowedHostnames('my-box.local').has('my-box.local')).toBe(true);
  });
});

describe('request guard', () => {
  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const res = await call(server, 'GET', '/api/health', undefined, { host: 'evil.example.com' });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: { code: 'forbidden_host' } });
    const events = await call(server, 'GET', '/api/events', undefined, {
      host: 'evil.example.com:4777',
    });
    expect(events.status).toBe(403);
    const ui = await call(server, 'GET', '/', undefined, { host: 'attacker.test' });
    expect(ui.status).toBe(403);
  });

  it('accepts loopback hosts on any port', async () => {
    for (const host of ['localhost:4777', '127.0.0.1', '[::1]:9999', 'LocalHost:1']) {
      expect((await call(server, 'GET', '/api/health', undefined, { host })).status).toBe(200);
    }
  });

  it('rejects foreign Origin headers, accepts local ones', async () => {
    const bad = await call(server, 'GET', '/api/settings', undefined, {
      origin: 'http://evil.example.com',
    });
    expect(bad.status).toBe(403);
    expect(bad.json).toMatchObject({ error: { code: 'forbidden_origin' } });
    const nul = await call(server, 'GET', '/api/settings', undefined, { origin: 'null' });
    expect(nul.status).toBe(403);
    const good = await call(server, 'GET', '/api/settings', undefined, {
      origin: 'http://localhost:5173',
    });
    expect(good.status).toBe(200);
  });

  it('requires the client header on requests that change data', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/providers/refresh',
      headers: { host: '127.0.0.1:4777', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'missing_client_header' } });
    const wrong = await call(
      server,
      'POST',
      '/api/providers/refresh',
      {},
      { [CLIENT_HEADER]: '0' },
    );
    expect(wrong.status).toBe(403);
    const del = await server.app.inject({
      method: 'DELETE',
      url: '/api/conversations/nope',
      headers: { host: 'localhost' },
    });
    expect(del.statusCode).toBe(403);
    // Percent-encoded paths reach the same routes, so they must not skip the check.
    const encoded = await server.app.inject({
      method: 'POST',
      url: '/%61pi/providers/refresh',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(encoded.statusCode).toBe(403);
    // GET requests do not need it.
    const get = await server.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'localhost' },
    });
    expect(get.statusCode).toBe(200);
  });

  it('accepts empty JSON bodies and body-less requests', async () => {
    const empty = await call(server, 'POST', '/api/providers/refresh', '', {});
    expect(empty.status).toBe(200);
    expect((empty.json as { providers: unknown[] }).providers).toHaveLength(5);
    const noType = await server.app.inject({
      method: 'POST',
      url: '/api/providers/refresh',
      headers: { host: 'localhost', [CLIENT_HEADER]: '1' },
    });
    expect(noType.statusCode).toBe(200);
    const bodyless = await server.app.inject({
      method: 'DELETE',
      url: '/api/conversations/missing',
      headers: { host: 'localhost', [CLIENT_HEADER]: '1' },
    });
    expect(bodyless.statusCode).toBe(404);
    expect(bodyless.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('renders errors as ApiError', async () => {
    const badJson = await call(server, 'POST', '/api/conversations', '{not json');
    expect(badJson.status).toBe(400);
    expect(badJson.json).toMatchObject({ error: { code: 'invalid_request' } });
    const invalid = await call(server, 'POST', '/api/workspaces', { folders: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.json).toMatchObject({
      error: { code: 'invalid_request', message: expect.stringMatching(/folders/) },
    });
    expect((invalid.json as { error: { details?: unknown } }).error.details).toEqual(
      expect.any(String),
    );
    const unknown = await call(server, 'GET', '/api/does-not-exist');
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ error: { code: 'not_found' } });
    const media = await call(server, 'POST', '/api/conversations', '<x/>', {
      'content-type': 'application/xml',
    });
    expect(media.status).toBe(415);
    expect(media.json).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it('never sends CORS headers', async () => {
    const res = await call(server, 'GET', '/api/health', undefined, {
      origin: 'http://localhost:5173',
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await call(server, 'OPTIONS', '/api/settings', undefined, {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'PUT',
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('accepts the configured host', async () => {
    const custom = await startServer({ config: { host: 'my-box.local' } });
    try {
      expect(
        (await call(custom, 'GET', '/api/health', undefined, { host: 'my-box.local:4777' })).status,
      ).toBe(200);
      expect(
        (await call(custom, 'GET', '/api/health', undefined, { host: 'other.local:4777' })).status,
      ).toBe(403);
      expect(
        (await call(custom, 'GET', '/api/health', undefined, { host: 'localhost:4777' })).status,
      ).toBe(200);
    } finally {
      await custom.close();
      await removeDir(custom.dataDir);
    }
  });
});

describe('web UI', () => {
  it('explains how to get the UI when it is not built', async () => {
    const res = await call(server, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('npm run dev');
    expect(res.body).toContain('npm run build');
    expect((await call(server, 'GET', '/some/page')).status).toBe(404);
  });

  it('serves the built UI with SPA fallback and caching rules', async () => {
    const webDist = await tempDir('cs-web-');
    await writeTree(webDist, {
      'index.html': '<!doctype html><title>Codesplainer UI</title>',
      'assets/index-abc123.js': 'console.log(1)',
      'favicon.svg': '<svg/>',
    });
    const ui = await startServer({ config: { webDist } });
    try {
      const index = await call(ui, 'GET', '/');
      expect(index.status).toBe(200);
      expect(index.body).toContain('Codesplainer UI');
      expect(index.headers['cache-control']).toBe('no-cache');
      const asset = await call(ui, 'GET', '/assets/index-abc123.js');
      expect(asset.status).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      const icon = await call(ui, 'GET', '/favicon.svg');
      expect(icon.status).toBe(200);
      const deep = await call(ui, 'GET', '/w/abc/c/def');
      expect(deep.status).toBe(200);
      expect(deep.body).toContain('Codesplainer UI');
      expect(deep.headers['cache-control']).toBe('no-cache');
      expect((await call(ui, 'GET', '/missing.png')).status).toBe(404);
      const api = await call(ui, 'GET', '/api/nope');
      expect(api.status).toBe(404);
      expect(api.json).toMatchObject({ error: { code: 'not_found' } });
      expect((await call(ui, 'POST', '/somewhere', {})).status).toBe(404);
      expect((await call(ui, 'GET', '/api/health')).status).toBe(200);
    } finally {
      await ui.close();
      await removeDir(ui.dataDir);
      await removeDir(webDist);
    }
  });
});
