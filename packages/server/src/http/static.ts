/**
 * The web UI. With a built UI (webDist) the files are served by @fastify/static: hashed files
 * under /assets get a long immutable cache, everything else (index.html) `no-cache`. Unknown GET
 * paths outside /api fall back to index.html (the UI uses hash routes); unknown /api paths get a
 * JSON 404. Without a built UI, GET / explains how to start the dev UI or build it.
 */
import { sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { APP_NAME, APP_VERSION } from '@codesplainer/shared';

const NO_UI_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP_NAME}</title>
<style>
  body { font: 15px/1.55 system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.25rem; color: #1f2328; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  pre { background: #f3f4f6; padding: .75rem 1rem; border-radius: 8px; overflow-x: auto; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } pre { background: #161b22; } }
</style>
</head>
<body>
<h1>${APP_NAME} ${APP_VERSION}</h1>
<p>The API server is running, but the web UI has not been built into it.</p>
<p>During development, start the server and the UI together and open the address Vite prints
(usually <a href="http://127.0.0.1:5173/">http://127.0.0.1:5173/</a>):</p>
<pre>npm run dev</pre>
<p>To serve the UI from this server, build it and start the bundled server:</p>
<pre>npm run build
npm start</pre>
<p>The API lives under <code>/api</code>, e.g. <a href="/api/health">/api/health</a>.</p>
</body>
</html>
`;

const IMMUTABLE = 'public, max-age=31536000, immutable';

function pathOf(url: string): string {
  return url.split('?')[0] ?? '/';
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

export async function registerStatic(
  app: FastifyInstance,
  webDist: string | undefined,
): Promise<void> {
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
      cacheControl: false,
      etag: true,
      lastModified: true,
      dotfiles: 'ignore',
      setHeaders(reply, filePath) {
        const immutable = filePath.includes(`${sep}assets${sep}`);
        reply.header('cache-control', immutable ? IMMUTABLE : 'no-cache');
      },
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(NO_UI_PAGE),
    );
  }

  app.setNotFoundHandler(async (request, reply) => {
    const path = pathOf(request.url);
    if (isApiPath(path)) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No API endpoint ${request.method} ${path}.` },
      });
    }
    const last = path.split('/').pop() ?? '';
    const looksLikeFile = /\.[A-Za-z0-9]+$/.test(last);
    if (webDist && (request.method === 'GET' || request.method === 'HEAD') && !looksLikeFile) {
      reply.code(200).header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply
      .status(404)
      .send({ error: { code: 'not_found', message: `Not found: ${request.method} ${path}` } });
  });
}
