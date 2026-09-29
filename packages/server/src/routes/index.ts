/** All API routes (the SSE stream is registered from events.ts, the UI from http/static.ts). */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { registerConversationRoutes } from './conversations';
import { registerFileRoutes } from './files';
import { registerFsRoutes } from './fs';
import { registerGraphRoutes } from './graphs';
import { registerHealthRoutes } from './health';
import { registerImportRoutes } from './import';
import { registerProviderRoutes } from './providers';
import { registerSettingsRoutes } from './settings';
import { registerWorkspaceRoutes } from './workspaces';

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerHealthRoutes(app, ctx);
  registerProviderRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerFsRoutes(app, ctx);
  registerWorkspaceRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerConversationRoutes(app, ctx);
  registerGraphRoutes(app, ctx);
  registerImportRoutes(app, ctx);
}
