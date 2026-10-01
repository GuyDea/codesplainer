/**
 * Application factory: opens the stores, wires services and routes into a Fastify instance.
 * `close()` stops everything in order: SSE streams, jobs (marked cancelled "Server stopped"),
 * agent processes, the HTTP server, then flushes the stores.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { createProviderRegistry } from './agents/registry';
import type { ProviderRegistry } from './agents/types';
import type { ServerConfig } from './config';
import type { AppContext } from './context';
import { EventBus, SseHub, registerEventRoutes } from './events';
import { IgnoreRulesCache } from './fs/ignore';
import { OverviewCache } from './fs/overview';
import { systemFolderPicker, type FolderPicker } from './fs/picker';
import type { ScanOptions } from './fs/scan';
import { registerJsonParser } from './http/body';
import { registerErrorHandler } from './http/errors';
import { registerSecurity } from './http/security';
import { registerStatic } from './http/static';
import { GenerationService } from './jobs/generation';
import { consoleLogger, type Logger } from './log';
import { registerRoutes } from './routes';
import { ConversationService } from './services/conversations';
import { ExchangeService } from './services/exchange';
import { WorkspaceService } from './services/workspaces';
import { ConversationStore } from './storage/conversations';
import { RunStore } from './storage/runs';
import { SettingsStore } from './storage/settings';
import { WorkspaceStore } from './storage/workspaces';

export interface AppOverrides {
  /** Provider registry (tests inject fakes). Default: createProviderRegistry({ dataDir }). */
  registry?: ProviderRegistry;
  log?: Logger;
  /** Debounce of conversation saves (default 300 ms). */
  saveDebounceMs?: number;
  scanOptions?: ScanOptions;
  /** Native folder dialog (default: zenity / kdialog / osascript / PowerShell). */
  folderPicker?: FolderPicker;
}

export interface CodesplainerApp {
  app: FastifyInstance;
  ctx: AppContext;
  /** Graceful shutdown (idempotent). */
  close(): Promise<void>;
}

/** Default body limit; POST /api/import allows more. */
const BODY_LIMIT = 8 * 1024 * 1024;

export async function createApp(
  config: ServerConfig,
  overrides: AppOverrides = {},
): Promise<CodesplainerApp> {
  const log = overrides.log ?? consoleLogger;
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const [settings, workspaces, conversations] = await Promise.all([
    SettingsStore.open(config.dataDir, log),
    WorkspaceStore.open(config.dataDir, log),
    ConversationStore.open(config.dataDir, log, { debounceMs: overrides.saveDebounceMs }),
  ]);
  const runs = new RunStore(join(config.dataDir, 'runs'));
  const registry = overrides.registry ?? createProviderRegistry({ dataDir: config.dataDir });
  const bus = new EventBus();
  const hub = new SseHub();
  const overview = new OverviewCache(undefined, overrides.scanOptions);
  const ignoreRules = new IgnoreRulesCache();

  const generation = new GenerationService({
    conversations,
    workspaces,
    settings,
    registry,
    bus,
    overview,
    runs,
    log,
  });
  const interrupted = generation.repairInterrupted();
  if (interrupted > 0) {
    log.info(`Marked ${interrupted} diagram(s) left unfinished by the last run as interrupted.`);
  }
  const conversationService = new ConversationService({
    conversations,
    workspaces,
    generation,
    runs,
    bus,
  });
  const workspaceService = new WorkspaceService({
    workspaces,
    conversations: conversationService,
    overview,
    bus,
  });
  const exchange = new ExchangeService({ conversations, workspaces, workspaceService, bus });

  const ctx: AppContext = {
    config,
    log,
    bus,
    hub,
    registry,
    stores: { settings, workspaces, conversations, runs },
    overview,
    ignoreRules,
    generation,
    workspaces: workspaceService,
    conversations: conversationService,
    exchange,
    folderPicker: overrides.folderPicker ?? systemFolderPicker,
  };

  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT,
    forceCloseConnections: true,
    return503OnClosing: true,
  });
  registerJsonParser(app);
  registerErrorHandler(app, log);
  registerSecurity(app, config.host);
  registerRoutes(app, ctx);
  registerEventRoutes(app, { bus, hub });
  await registerStatic(app, config.webDist);
  await app.ready();

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      hub.closeAll();
      generation.shutdown();
      await registry
        .dispose()
        .catch((e: unknown) => log.error('Stopping agent processes failed', e));
      await app.close().catch((e: unknown) => log.error('Stopping the HTTP server failed', e));
      await generation.drain(5_000);
      const results = await Promise.allSettled([
        conversations.close(),
        settings.flush(),
        workspaces.flush(),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') log.error('Saving data on shutdown failed', r.reason);
      }
    })();
    return closing;
  };

  return { app, ctx, close };
}
