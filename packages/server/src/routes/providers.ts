/** Provider detection and smoke tests. */
import type { FastifyInstance } from 'fastify';
import { providerIdSchema, type ProviderId, type ProviderInfo } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { notFound } from '../errors';

function providerId(value: string): ProviderId {
  const parsed = providerIdSchema.safeParse(value);
  if (!parsed.success) throw notFound(`Provider "${value}"`);
  return parsed.data;
}

/** Re-list providers in the background and broadcast the result. */
export function broadcastProviders(ctx: AppContext, refresh = false): Promise<ProviderInfo[]> {
  return ctx.registry.list(ctx.stores.settings.get(), { refresh }).then((providers) => {
    ctx.bus.emit({ type: 'providers.updated', providers });
    return providers;
  });
}

export function registerProviderRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/providers', async () => ({
    providers: await ctx.registry.list(ctx.stores.settings.get()),
  }));

  app.post('/api/providers/refresh', async () => ({
    providers: await broadcastProviders(ctx, true),
  }));

  app.post<{ Params: { id: string } }>('/api/providers/:id/test', async (request) => {
    const id = providerId(request.params.id);
    const result = await ctx.registry.test(id, ctx.stores.settings.get());
    // A test re-detects an unavailable provider: let every client see the new state.
    void broadcastProviders(ctx).catch(() => undefined);
    return result;
  });
}
