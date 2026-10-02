/**
 * Electron main process for the CLI (`npx codesplainer`): a window and nothing else. The CLI runs
 * the server and starts `electron cli-window.js --url=<server url>` (packages/server/src/window.ts).
 * It prints "ready" once the window shows and quits when the window is closed, which makes the
 * CLI stop the server.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, Menu } from 'electron';
import { APP_NAME, buildAppMenu, createAppWindow } from './window';

const url = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length);
const iconPath = fileURLToPath(new URL('./icon.png', import.meta.url));
const icon = existsSync(iconPath) ? iconPath : undefined;

app.setName(APP_NAME);
// Not the desktop app's profile: both may be open at the same time.
app.setPath('userData', join(app.getPath('appData'), `${APP_NAME} CLI`));

if (!url) {
  console.error('Usage: electron cli-window.js --url=<Codesplainer server URL>');
  app.exit(2);
} else {
  app.on('window-all-closed', () => app.quit());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(buildAppMenu());
    if (icon && process.platform === 'darwin') app.dock?.setIcon(icon);
    const win = createAppWindow(url, { icon });
    win.once('show', () => process.stdout.write('ready\n'));
  });
}
