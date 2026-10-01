/**
 * Apps started from the Dock, Finder or a desktop menu get a minimal PATH (on macOS
 * /usr/bin:/bin:/usr/sbin:/sbin), so agent CLIs installed with Homebrew, npm -g, nvm or fnm, and
 * the `node` their launch scripts need, would not be found. Read PATH the way the user's login
 * shell sets it (as in a terminal) and put it in front of the inherited one.
 */
import { execFile } from 'node:child_process';
import { delimiter } from 'node:path';

const MARKER = '__CODESPLAINER_ENV__';
const TIMEOUT_MS = 4_000;

/** The entries of `first`, then those of `second`, without empty or repeated ones. */
export function mergePath(first: string | undefined, second: string | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(first ?? '').split(delimiter), ...(second ?? '').split(delimiter)]) {
    const dir = raw.trim();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(delimiter);
}

/** Run the shell, print the environment between markers and pick PATH out of it. */
function pathFromShell(
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      shell,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env, windowsHide: true },
      (_error, stdout) => {
        // Start-up files may print anything before the first marker.
        const block = String(stdout ?? '').split(MARKER)[1];
        const line = block?.split(/\r?\n/).find((l) => l.startsWith('PATH='));
        resolve(line ? line.slice('PATH='.length).trim() || undefined : undefined);
      },
    );
  });
}

/** PATH as the user's login shell sets it (undefined on Windows, or when the shell fails). */
export async function loginShellPath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined;
  const shell = env.SHELL?.trim() || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const script = `echo ${MARKER}; /usr/bin/env; echo ${MARKER}`;
  // Keep Oh My Zsh from asking about updates and tmux plugins from attaching.
  const quiet = { ...env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true' };
  // Interactive + login also reads .zshrc / .bashrc, where nvm and friends usually live. Some
  // shells refuse that combination with -c, so fall back to a plain login shell.
  return (
    (await pathFromShell(shell, ['-ilc', script], quiet)) ??
    (await pathFromShell(shell, ['-lc', script], quiet))
  );
}

/** Put the login shell's PATH in front of process.env.PATH (no-op when it can't be read). */
export async function applyLoginShellPath(): Promise<void> {
  const login = await loginShellPath().catch(() => undefined);
  if (login) process.env.PATH = mergePath(login, process.env.PATH);
}

/** Search-path variables that AppImage's AppRun script points into the mounted image. */
const APPIMAGE_PATH_VARS = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR'];

/**
 * Inside an AppImage, drop the image's entries from those variables (and the AppImage markers),
 * so the agents, editors and file openers we start see the user's normal environment instead of
 * the image's bundled libraries. This process is unaffected: the dynamic linker read
 * LD_LIBRARY_PATH at startup. (An auto-updater would need APPIMAGE: keep it if one is added.)
 */
export function stripAppImageEnv(env: NodeJS.ProcessEnv = process.env): void {
  const appDir = env.APPDIR;
  if (!env.APPIMAGE || !appDir) return;
  for (const key of APPIMAGE_PATH_VARS) {
    const value = env[key];
    if (value === undefined) continue;
    const kept = value.split(delimiter).filter((p) => p && !p.startsWith(appDir));
    if (kept.length) env[key] = kept.join(delimiter);
    else delete env[key];
  }
  for (const key of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD']) delete env[key];
}
