import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@codesplainer/shared';
import { api, ApiRequestError, apiUrl, download, fileNameFromDisposition } from '../src/lib/api';

type FetchArgs = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...args: FetchArgs) => Promise<Response>>>;

  beforeEach(() => {
    fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const headersOf = (call: FetchArgs | undefined) =>
    (call?.[1]?.headers ?? {}) as Record<string, string>;

  it('sends the client header and a JSON body on POST', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'w1', name: 'x', folders: [], createdAt: '', updatedAt: '' }),
    );
    await api.createWorkspace({ folders: ['/code/app'] });
    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe('/api/workspaces');
    expect(init?.method).toBe('POST');
    expect(headersOf(fetchMock.mock.calls[0])[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE);
    expect(headersOf(fetchMock.mock.calls[0])['content-type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ folders: ['/code/app'] });
  });

  it('sends an empty JSON object for body-less POSTs and nothing for DELETE', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ providers: [] }));
    await api.refreshProviders();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{}');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.deleteWorkspace('w/1');
    const [url, init] = fetchMock.mock.calls[1] as FetchArgs;
    expect(url).toBe('/api/workspaces/w%2F1');
    expect(init?.body).toBeUndefined();
    expect(headersOf(fetchMock.mock.calls[1])[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE);
    expect(headersOf(fetchMock.mock.calls[1])['content-type']).toBeUndefined();
  });

  it('does not send the client header on GET and encodes the query', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ folder: 'app', path: '', entries: [], truncated: false }),
    );
    await api.listDir('w1', 'app', 'src/a b');
    const [url] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe('/api/workspaces/w1/dir?folder=app&path=src%2Fa+b');
    expect(headersOf(fetchMock.mock.calls[0])[CLIENT_HEADER]).toBeUndefined();
    expect(apiUrl('/fs/browse', { path: undefined, hidden: true })).toBe('/api/fs/browse?hidden=1');
    expect(apiUrl('/x', { refresh: false, n: 3, skip: null })).toBe('/api/x?refresh=0&n=3');
  });

  it('maps ApiError bodies to ApiRequestError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'not_found', message: 'No such workspace' } }, 404),
    );
    const err = await api.getWorkspace('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'No such workspace' });
  });

  it('maps Fastify-style and non-JSON errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { statusCode: 400, error: 'Bad Request', message: 'body/folders required' },
        400,
      ),
    );
    await expect(api.createWorkspace({ folders: [] })).rejects.toMatchObject({
      status: 400,
      code: 'http_400',
      message: 'body/folders required',
    });
    fetchMock.mockResolvedValue(
      new Response('oops', { status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(api.listWorkspaces()).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    });
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    const proxy = await api.health().catch((e: unknown) => e);
    expect(proxy).toMatchObject({ status: 502, unreachable: true });
  });

  it('maps network failures to status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 0, code: 'network', unreachable: true });
  });

  it('returns undefined for empty responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteConversation('c1')).resolves.toBeUndefined();
  });

  it('parses Content-Disposition file names', () => {
    expect(fileNameFromDisposition('attachment; filename="a b.json"')).toBe('a b.json');
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.md")).toBe('café.md');
    expect(fileNameFromDisposition('attachment; filename=plain.md; foo=bar')).toBe('plain.md');
    expect(fileNameFromDisposition('attachment; filename="../../evil.json"')).toBe(
      '.._.._evil.json',
    );
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(fileNameFromDisposition('inline')).toBeNull();
  });

  it('downloads with the client header and saves a blob', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(
      new Response('{"a":1}', {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="server.codesplainer.json"' },
      }),
    );
    const name = await download('/api/conversations/c1/export?format=json', 'fallback.json');
    expect(name).toBe('server.codesplainer.json');
    expect(headersOf(fetchMock.mock.calls[0])[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();

    fetchMock.mockResolvedValue(new Response('x', { status: 200 }));
    await expect(download('/api/x', 'fallback.md')).resolves.toBe('fallback.md');

    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'gone', message: 'Gone' } }, 410));
    await expect(download('/api/x', 'f')).rejects.toMatchObject({ status: 410, code: 'gone' });
  });
});
