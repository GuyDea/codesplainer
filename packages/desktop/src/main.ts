/**
 * Codesplainer desktop app: runs the local server in the Electron main process and shows its UI
 * in a window. It shares the data directory with the CLI (~/.codesplainer, or CODESPLAINER_HOME).
 * When another Codesplainer server already owns it (e.g. `npm start` in a terminal), the window
 * shows that server instead of starting a second one.
 */
import { homedir } from 'node:os';
import { BrowserWindow, Menu, app, dialog, type OpenDialogOptions } from 'electron';
import {
  DEFAULT_HOST,
  consoleLogger,
  isLoopbackHost,
  resolveConfig,
  startServer,
  type EmbeddedServer,
  type FolderPicker,
} from '@codesplainer/server/start';
import { applyLoginShellPath, stripAppImageEnv } from './shell-env';
import { APP_NAME, buildAppMenu, createAppWindow } from './window';

const APP_ID = 'io.github.guydea.codesplainer';
/** How long to wait for another instance that is still starting up or shutting down. */
const ATTACH_TIMEOUT_MS = 8_000;
/** Graceful shutdown limit (running diagrams are cancelled, agents stopped, data saved). */
const QUIT_TIMEOUT_MS = 10_000;

let mainWindow: BrowserWindow | null = null;
/** Our own server; undefined when the window shows another instance's server. */
let server: EmbeddedServer | undefined;
let uiUrl: string | undefined;
let quitting = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- folder dialog --------------------------------------------------------------------------

/** Electron's folder dialog for "Choose folder…" (POST /api/fs/pick-folder), one at a time. */
let picking: Promise<string[]> | undefined;
const folderPicker: FolderPicker = {
  available: async () => true,
  pick: () =>
    (picking ??= (async () => {
      const options: OpenDialogOptions = {
        title: 'Choose folders for Codesplainer',
        properties: ['openDirectory', 'multiSelections', 'createDirectory'],
      };
      const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    })().finally(() => {
      picking = undefined;
    })),
};

// ---- server ---------------------------------------------------------------------------------

/** http on a loopback address (the lock file's URL is not trusted blindly). */
function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

async function responds(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('api/health', url), { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start our server, or find the Codesplainer server that already owns the data directory. */
async function startOrAttach(): Promise<string> {
  const resolved = resolveConfig([], process.env, { cwd: homedir() });
  if (resolved.action !== 'run') {
    throw new Error(resolved.action === 'error' ? resolved.message : 'Unexpected configuration.');
  }
  if (!resolved.config.webDist) throw new Error('This build of Codesplainer has no UI files.');
  // Loopback only: the desktop app never exposes the server to the network.
  const config = { ...resolved.config, host: DEFAULT_HOST, open: false, folders: [], warnings: [] };
  const deadline = Date.now() + ATTACH_TIMEOUT_MS;
  for (;;) {
    const result = await startServer({ config, log: consoleLogger, folderPicker, kind: 'desktop' });
    if (result.status === 'started') {
      server = result.server;
      for (const warning of result.warnings) consoleLogger.warn(warning);
      consoleLogger.info(`${APP_NAME} server at ${result.server.url} (data: ${config.dataDir})`);
      return result.server.url;
    }
    const { owner } = result;
    if (owner.url && isLocalUrl(owner.url) && (await responds(owner.url))) {
      consoleLogger.info(`Using the running ${APP_NAME} server (pid ${owner.pid}) at ${owner.url}`);
      return owner.url;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Another ${APP_NAME} (pid ${owner.pid}) is using ${config.dataDir} but does not ` +
          `respond${owner.url ? ` at ${owner.url}` : ''}. Stop it, then open ${APP_NAME} again.`,
      );
    }
    // It is starting up (no address yet) or shutting down (address no longer answers).
    await sleep(300);
  }
}

// ---- window ---------------------------------------------------------------------------------

function openWindow(url: string): BrowserWindow {
  const win = createAppWindow(url);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

function showWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (uiUrl) {
    mainWindow = openWindow(uiUrl);
  }
}

// ---- lifecycle ------------------------------------------------------------------------------

async function main(): Promise<void> {
  // The environment first: the server looks for the agent CLIs on PATH and passes the
  // environment on to every program it starts.
  stripAppImageEnv();
  await Promise.all([app.whenReady(), applyLoginShellPath()]);
  Menu.setApplicationMenu(buildAppMenu());
  try {
    uiUrl = await startOrAttach();
  } catch (e) {
    dialog.showErrorBox(`${APP_NAME} could not start`, errorText(e));
    app.exit(1);
    return;
  }
  mainWindow = openWindow(uiUrl);
}

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  // This app is already open: that instance comes to the front (second-instance) and this exits.
  app.quit();
} else {
  app.on('second-instance', showWindow);
  // macOS: the Dock icon was clicked while no window is open.
  app.on('activate', showWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    if (!server || quitting) return;
    // Let the server cancel running diagrams, stop agents and save before the process ends.
    event.preventDefault();
    quitting = true;
    const running = server;
    const force = setTimeout(() => app.exit(0), QUIT_TIMEOUT_MS);
    void running
      .close()
      .catch((e: unknown) => consoleLogger.error('Shutting down failed', e))
      .finally(() => {
        clearTimeout(force);
        server = undefined;
        app.quit();
      });
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
  void main();
}
