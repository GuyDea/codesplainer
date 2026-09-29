/** GET /api/health */
import { homedir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { APP_NAME, APP_VERSION, type HealthResponse } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { nativePickerAvailable } from '../fs/picker';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    const startup = ctx.startupWorkspaceId;
    return {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      dataDir: ctx.config.dataDir,
      pid: process.pid,
      platform: process.platform,
      homeDir: homedir(),
      nativePicker: await nativePickerAvailable(),
      ...(startup && ctx.stores.workspaces.get(startup) ? { startupWorkspaceId: startup } : {}),
    };
  });
}
