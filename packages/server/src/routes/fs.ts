/** Local file system helpers for choosing workspace folders (browse, check, native picker). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fsCheckBodySchema, type FsCheckResponse } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { browseDirectories } from '../fs/browse';
import { checkPath } from '../fs/paths';
import { parseWith, queryFlag } from '../http/validate';

const browseQuery = z.object({ path: z.string().optional(), hidden: queryFlag });

export function registerFsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/fs/browse', async (request) => {
    const query = parseWith(browseQuery, request.query, 'query');
    return browseDirectories({
      ...(query.path ? { path: query.path } : {}),
      hidden: query.hidden,
      workspaces: ctx.stores.workspaces.list(),
      cwd: ctx.config.cwd,
    });
  });

  app.post('/api/fs/check', async (request): Promise<FsCheckResponse> => {
    const body = parseWith(fsCheckBodySchema, request.body);
    const checks = await Promise.all(body.paths.map(async (p) => [p, await checkPath(p)] as const));
    return { results: Object.fromEntries(checks) };
  });

  app.post('/api/fs/pick-folder', async () => ({ paths: await ctx.folderPicker.pick() }));
}
