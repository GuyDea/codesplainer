/**
 * Start the server inside another program (the desktop app). Like the CLI (index.ts) it keeps one
 * server per data directory (instance.ts): when another Codesplainer already owns the directory,
 * nothing is started and that server is reported instead. Folders in `config.folders` are not
 * opened here (the CLI turns them into a startup workspace).
 */
import { createApp, type CodesplainerApp } from './app';
import type { ServerConfig } from './config';
import type { FolderPicker } from './fs/picker';
import { acquireInstanceLock, type InstanceInfo } from './instance';
import { consoleLogger, type Logger } from './log';
import { portIsFree, serverUrl } from './net';

export { DEFAULT_HOST, isLoopbackHost, resolveConfig, type ServerConfig } from './config';
export type { FolderPicker } from './fs/picker';
export type { InstanceInfo } from './instance';
export { consoleLogger, type Logger } from './log';

export interface EmbeddedServer {
  /** Address of the UI, e.g. http://127.0.0.1:4777/ */
  url: string;
  app: CodesplainerApp;
  /** Graceful shutdown, then the data directory is released. Idempotent. */
  close(): Promise<void>;
}

export type StartResult =
  | { status: 'started'; server: EmbeddedServer; warnings: string[] }
  | { status: 'running'; owner: InstanceInfo; lockPath: string };

export interface StartOptions {
  config: ServerConfig;
  log?: Logger;
  folderPicker?: FolderPicker;
  /** Recorded in the data directory lock, e.g. "desktop". */
  kind?: string;
}

export async function startServer(opts: StartOptions): Promise<StartResult> {
  const { config } = opts;
  const log = opts.log ?? consoleLogger;
  const locked = await acquireInstanceLock(config.dataDir, opts.kind ? { kind: opts.kind } : {});
  if (!locked.ok) return { status: 'running', owner: locked.owner, lockPath: locked.path };
  const lock = locked.lock;
  const warnings: string[] = [];
  let server: CodesplainerApp | undefined;
  try {
    // The usual port keeps the UI's address (and with it the browser storage: theme, panel
    // sizes, ask settings) the same between runs; when another program uses it, any port does.
    let port = config.port;
    if (!(await portIsFree(config.host, port))) {
      warnings.push(`Port ${port} is used by another program; listening on a random port.`);
      port = 0;
    }
    server = await createApp(config, {
      log,
      ...(opts.folderPicker ? { folderPicker: opts.folderPicker } : {}),
    });
    await server.app.listen({ host: config.host, port });
    const address = server.app.server.address();
    const url = serverUrl(
      config.host,
      typeof address === 'object' && address ? address.port : port,
    );
    await lock.setUrl(url);
    const app = server;
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= app.close().finally(() => lock.release()));
    return { status: 'started', server: { url, app, close }, warnings };
  } catch (e) {
    await server?.close().catch(() => undefined);
    await lock.release().catch(() => undefined);
    throw e;
  }
}
