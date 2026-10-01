/**
 * CLI entry point (`codesplainer [folder...] [options]`; the shebang is added by tsup).
 * Starts the local server, opens the browser and shuts down gracefully on SIGINT/SIGTERM
 * (a second signal forces the exit).
 */
import { homedir } from 'node:os';
import open from 'open';
import { APP_NAME, APP_VERSION, type ProviderInfo } from '@codesplainer/shared';
import { createApp, type CodesplainerApp } from './app';
import { resolveConfig, type ServerConfig } from './config';
import { isHttpError } from './errors';
import { acquireInstanceLock, type InstanceInfo } from './instance';
import { consoleLogger } from './log';
import { portIsFree, serverUrl, urlHost } from './net';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const cyan = paint(36);

function tildify(p: string): string {
  const home = homedir();
  return p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

function providerLine(p: ProviderInfo): string {
  const version = p.version ? dim(` ${p.version}`) : '';
  if (!p.enabled) return `   ${dim('–')} ${p.name}${dim(': disabled')}`;
  if (p.available) return `   ${green('✓')} ${p.name}${version}`;
  return `   ${red('✗')} ${p.name}${dim(`: ${p.reason ?? 'not available'}`)}`;
}

async function printProviders(server: CodesplainerApp): Promise<void> {
  try {
    const providers = await server.ctx.registry.list(server.ctx.stores.settings.get());
    console.log(`\n  ${bold('Providers')}`);
    for (const p of providers) console.log(providerLine(p));
    console.log('');
  } catch (e) {
    console.warn(
      yellow(`  Provider detection failed: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
}

function portInUseMessage(config: ServerConfig): string {
  return (
    `${red('error:')} port ${config.port} is already in use. Is ${APP_NAME} already running ` +
    `(http://${urlHost(config.host)}:${config.port}/)? Start it on another port with --port ${config.port + 1}.`
  );
}

/** Another server (CLI, dev server or desktop app) owns the data directory. */
function alreadyRunningMessage(config: ServerConfig, owner: InstanceInfo): string {
  const who =
    owner.kind === 'desktop' ? `The ${APP_NAME} desktop app` : `Another ${APP_NAME} server`;
  const where = owner.url ? ` at ${owner.url}` : '';
  return (
    `${red('error:')} ${who} (pid ${owner.pid}) is already running${where} with the data ` +
    `directory ${tildify(config.dataDir)}. Use that one, stop it, or start this one with ` +
    '--data-dir <another directory>.'
  );
}

async function startupWorkspace(server: CodesplainerApp, config: ServerConfig) {
  if (!config.folders.length) return undefined;
  const workspace = await server.ctx.workspaces.openOrCreate(config.folders, config.cwd);
  server.ctx.startupWorkspaceId = workspace.id;
  return workspace;
}

async function main(): Promise<void> {
  const result = resolveConfig(process.argv.slice(2), process.env);
  if (result.action === 'help' || result.action === 'version') {
    process.stdout.write(result.text);
    return;
  }
  if (result.action === 'error') {
    console.error(`${red('error:')} ${result.message}\nRun "codesplainer --help" for usage.`);
    process.exitCode = 2;
    return;
  }
  const config = result.config;
  for (const warning of config.warnings) {
    console.warn(`\n${yellow(bold('  WARNING'))} ${yellow(warning)}\n`);
  }
  // Both checks run before the data directory is opened, so a second instance started by accident
  // never touches the files of the running one (it would mark that instance's running diagrams as
  // interrupted and overwrite its saves).
  if (!(await portIsFree(config.host, config.port))) {
    console.error(portInUseMessage(config));
    process.exitCode = 1;
    return;
  }
  // A short wait covers restarts (e.g. the dev server's watch mode), where the old process is
  // still saving.
  const locked = await acquireInstanceLock(config.dataDir, { kind: 'cli', waitMs: 2_000 });
  if (!locked.ok) {
    console.error(alreadyRunningMessage(config, locked.owner));
    process.exitCode = 1;
    return;
  }
  const lock = locked.lock;

  let server: CodesplainerApp;
  try {
    server = await createApp(config, { log: consoleLogger });
  } catch (e) {
    await lock.release().catch(() => undefined);
    throw e;
  }
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(code || 1), 10_000);
    force.unref();
    void server
      .close()
      .finally(() => lock.release())
      .finally(() => process.exit(code));
  };
  const onSignal = () => {
    if (stopping) {
      console.log(dim('  Forcing exit.'));
      process.exit(1);
    }
    console.log(dim('\n  Shutting down…'));
    stop(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('unhandledRejection', (e) => consoleLogger.error('Unhandled rejection', e));

  let workspace;
  try {
    workspace = await startupWorkspace(server, config);
  } catch (e) {
    console.error(`${red('error:')} ${isHttpError(e) ? e.message : String(e)}`);
    stop(1);
    return;
  }

  try {
    await server.app.listen({ port: config.port, host: config.host });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(portInUseMessage(config));
    } else if (code === 'EACCES') {
      console.error(
        `${red('error:')} no permission to listen on port ${config.port}. Try --port ${config.port < 1024 ? 4777 : config.port + 1}.`,
      );
    } else if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND') {
      console.error(`${red('error:')} cannot listen on host "${config.host}": ${String(e)}`);
    } else {
      console.error(`${red('error:')} could not start the server: ${String(e)}`);
    }
    stop(1);
    return;
  }

  const address = server.app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const url = serverUrl(config.host, port);
  await lock
    .setUrl(url)
    .catch((e: unknown) => consoleLogger.warn(`Could not record the server address: ${String(e)}`));
  const target = workspace ? `${url}#/w/${encodeURIComponent(workspace.id)}` : url;
  console.log(`\n  ${bold(`${APP_NAME} ${APP_VERSION}`)}\n`);
  console.log(`  ${green('➜')}  ${cyan(url)}`);
  console.log(`     ${dim('Data')}       ${tildify(config.dataDir)}`);
  if (workspace) console.log(`     ${dim('Workspace')}  ${workspace.name}`);
  if (!config.webDist) {
    console.log(
      `     ${dim('UI')}         ${yellow('not built here: in "npm run dev" the UI is the Vite URL; or run "npm run build"')}`,
    );
  }
  await printProviders(server);
  if (config.open && !stopping) {
    try {
      await open(target);
    } catch {
      console.log(`  Open ${target} in your browser.`);
    }
  }
  console.log(dim('  Press Ctrl+C to stop.\n'));
}

main().catch((e: unknown) => {
  consoleLogger.error('Failed to start', e);
  process.exit(1);
});
