/** Diagrams of a conversation: ask, retry, cancel, edit, delete, activity, raw output. */
import type { FastifyInstance } from 'fastify';
import {
  askBodySchema,
  retryBodySchema,
  updateGraphBodySchema,
  type AskResponse,
  type RawOutputResponse,
} from '@codesplainer/shared';
import type { AppContext } from '../context';
import { parseWith } from '../http/validate';

type ConvParams = { Params: { id: string } };
type GraphParams = { Params: { id: string; gid: string } };

export function registerGraphRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<ConvParams>('/api/conversations/:id/ask', async (request): Promise<AskResponse> => {
    const body = parseWith(askBodySchema, request.body);
    return { graph: await ctx.generation.ask(request.params.id, body) };
  });

  app.post<GraphParams>('/api/conversations/:id/graphs/:gid/retry', async (request) => {
    const body = parseWith(retryBodySchema, request.body);
    return { graph: ctx.generation.retry(request.params.id, request.params.gid, body) };
  });

  app.post<GraphParams>('/api/conversations/:id/graphs/:gid/cancel', async (request) => ({
    graph: ctx.generation.cancel(request.params.id, request.params.gid),
  }));

  app.patch<GraphParams>('/api/conversations/:id/graphs/:gid', async (request) => {
    const body = parseWith(updateGraphBodySchema, request.body);
    return { graph: ctx.generation.updateGraph(request.params.id, request.params.gid, body) };
  });

  app.delete<GraphParams>('/api/conversations/:id/graphs/:gid', async (request) => ({
    deleted: ctx.generation.deleteGraph(request.params.id, request.params.gid),
  }));

  app.get<GraphParams>('/api/conversations/:id/graphs/:gid/activity', async (request) => ({
    activity: ctx.generation.activity(request.params.id, request.params.gid),
  }));

  app.get<GraphParams>(
    '/api/conversations/:id/graphs/:gid/raw',
    async (request): Promise<RawOutputResponse> => ({
      text: await ctx.generation.rawOutput(request.params.id, request.params.gid),
    }),
  );
}
