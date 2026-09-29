/** GET / PUT /api/settings */
import type { FastifyInstance } from 'fastify';
import { settingsPatchSchema, type Settings } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { parseWith } from '../http/validate';
import { explicitSettingsPatch } from '../storage/settings';
import { broadcastProviders } from './providers';

function providerSettingsChanged(before: Settings, after: Settings): boolean {
  return (
    before.defaultProvider !== after.defaultProvider ||
    JSON.stringify(before.providers) !== JSON.stringify(after.providers) ||
    JSON.stringify(before.acp) !== JSON.stringify(after.acp)
  );
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async () => ctx.stores.settings.get());

  app.put('/api/settings', async (request) => {
    const patch = explicitSettingsPatch(
      parseWith(settingsPatchSchema, request.body, 'settings'),
      request.body,
    );
    const before = ctx.stores.settings.get();
    const settings = await ctx.stores.settings.update(patch);
    ctx.bus.emit({ type: 'settings.updated', settings });
    ctx.generation.settingsChanged();
    if (providerSettingsChanged(before, settings)) {
      // Detection is cached per relevant setting, so changed commands are re-detected here.
      void broadcastProviders(ctx).catch((e: unknown) =>
        ctx.log.warn(`Provider detection failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
    return settings;
  });
}
