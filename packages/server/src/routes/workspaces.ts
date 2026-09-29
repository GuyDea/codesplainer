/** Workspaces: CRUD, overview, bundle export. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWorkspaceBodySchema, updateWorkspaceBodySchema } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { parseWith, queryFlag } from '../http/validate';
import { sendDownload } from './download';

type IdParams = { Params: { id: string } };

const overviewQuery = z.object({ refresh: queryFlag });

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/workspaces', async () => ({ workspaces: ctx.workspaces.list() }));

  app.post('/api/workspaces', async (request, reply) => {
    const body = parseWith(createWorkspaceBodySchema, request.body);
    return reply.status(201).send(await ctx.workspaces.create(body));
  });

  app.get<IdParams>('/api/workspaces/:id', async (request) =>
    ctx.workspaces.open(request.params.id),
  );

  app.patch<IdParams>('/api/workspaces/:id', async (request) => {
    const body = parseWith(updateWorkspaceBodySchema, request.body);
    return ctx.workspaces.update(request.params.id, body);
  });

  app.delete<IdParams>('/api/workspaces/:id', async (request) => {
    await ctx.workspaces.remove(request.params.id);
    return { ok: true as const };
  });

  app.get<IdParams>('/api/workspaces/:id/overview', async (request) => {
    const query = parseWith(overviewQuery, request.query, 'query');
    const workspace = ctx.workspaces.get(request.params.id);
    return ctx.overview.overview(workspace, { refresh: query.refresh });
  });

  app.get<IdParams>('/api/workspaces/:id/export', async (request, reply) =>
    sendDownload(reply, ctx.exchange.exportWorkspace(request.params.id)),
  );
}
