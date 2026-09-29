/** Conversations: list, CRUD, duplicate, export. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createConversationBodySchema, updateConversationBodySchema } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { parseWith } from '../http/validate';
import { sendDownload } from './download';

type IdParams = { Params: { id: string } };

const listQuery = z.object({ workspaceId: z.string().optional() });
const exportQuery = z.object({ format: z.enum(['json', 'md']).default('json') });

export function registerConversationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/conversations', async (request) => {
    const query = parseWith(listQuery, request.query, 'query');
    return { conversations: ctx.conversations.list(query.workspaceId || undefined) };
  });

  app.post('/api/conversations', async (request, reply) => {
    const body = parseWith(createConversationBodySchema, request.body);
    return reply.status(201).send(await ctx.conversations.create(body));
  });

  app.get<IdParams>('/api/conversations/:id', async (request) =>
    ctx.conversations.get(request.params.id),
  );

  app.patch<IdParams>('/api/conversations/:id', async (request) => {
    const body = parseWith(updateConversationBodySchema, request.body);
    return ctx.conversations.update(request.params.id, body);
  });

  app.delete<IdParams>('/api/conversations/:id', async (request) => {
    await ctx.conversations.remove(request.params.id);
    return { ok: true as const };
  });

  app.post<IdParams>('/api/conversations/:id/duplicate', async (request, reply) =>
    reply.status(201).send(await ctx.conversations.duplicate(request.params.id)),
  );

  app.get<IdParams>('/api/conversations/:id/export', async (request, reply) => {
    const query = parseWith(exportQuery, request.query, 'query');
    return sendDownload(reply, ctx.exchange.exportConversation(request.params.id, query.format));
  });
}
