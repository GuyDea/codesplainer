/**
 * The Codesplainer window and menu, shared by the desktop app (main.ts) and the CLI's app window
 * (cli-window.ts). The window only ever shows the app; other links open in the default browser.
 */
import { BrowserWindow, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';

export const APP_NAME = 'Codesplainer';
const REPO_URL = 'https://github.com/GuyDea/codesplainer';

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function openExternal(url: string): void {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
}

export function createAppWindow(url: string, options: { icon?: string } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 880,
    minHeight: 560,
    title: APP_NAME,
    show: false,
    // The app's --bg, so there is no white flash before the UI paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c1016' : '#f5f6f8',
    autoHideMenuBar: true,
    ...(options.icon ? { icon: options.icon } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  const origin = originOf(url);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    if (originOf(event.url) === origin) return;
    event.preventDefault();
    openExternal(event.url);
  });
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once('ready-to-show', show);
  // Never stay invisible, e.g. when the page fails to load.
  setTimeout(show, 3_000);
  void win.loadURL(url);
  return win;
}

export function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} on GitHub`, click: () => void shell.openExternal(REPO_URL) },
        {
          label: 'Report a Problem',
          click: () => void shell.openExternal(`${REPO_URL}/issues`),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
