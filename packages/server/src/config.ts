/**
 * Command line + environment configuration.
 *
 *   codesplainer [folder...] [--port N] [--host H] [--data-dir D] [--no-open] [--help] [--version]
 *
 * Environment: CODESPLAINER_PORT, CODESPLAINER_HOST, CODESPLAINER_HOME (data dir),
 * CODESPLAINER_NO_OPEN=1, CODESPLAINER_WEB_DIST (built web UI to serve). Flags win over env.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, APP_VERSION, DEFAULT_PORT } from '@codesplainer/shared';

export const DEFAULT_HOST = '127.0.0.1';

export interface ServerConfig {
  host: string;
  port: number;
  /** Absolute data directory (settings, workspaces, conversations, raw agent outputs). */
  dataDir: string;
  /** Open the UI after start: in an app window (Electron) when possible, else the browser. */
  open: boolean;
  /** Open the UI in the browser even when an app window is possible. */
  browser: boolean;
  /** Folders given on the command line (absolute, not yet validated). */
  folders: string[];
  /** Built web UI directory (contains index.html), when available. */
  webDist?: string;
  /** Working directory of the server process (browse shortcut, relative folder args). */
  cwd: string;
  /** Problems worth printing loudly (e.g. listening on a non-loopback interface). */
  warnings: string[];
}

export type ConfigResult =
  | { action: 'run'; config: ServerConfig }
  | { action: 'help'; text: string }
  | { action: 'version'; text: string }
  | { action: 'error'; message: string };

export interface ConfigOptions {
  cwd?: string;
  home?: string;
  /** Candidate web UI directories (default: ./public next to the server bundle). */
  webDistCandidates?: string[];
}

export const HELP_TEXT = `${APP_NAME} ${APP_VERSION}: understand any codebase through small, expandable diagrams.

Usage: codesplainer [folder...] [options]

Arguments:
  folder...          Folders to open as a workspace (optional; add folders in the UI otherwise)

Options:
  --port <n>         Port to listen on (default ${DEFAULT_PORT}, env CODESPLAINER_PORT)
  --host <host>      Interface to bind (default ${DEFAULT_HOST}, env CODESPLAINER_HOST)
  --data-dir <dir>   Settings and conversations (default ~/.codesplainer, env CODESPLAINER_HOME)
  --browser          Open the UI in the browser instead of an app window
                     (env CODESPLAINER_BROWSER=1)
  --no-open          Open neither (env CODESPLAINER_NO_OPEN=1)
  -h, --help         Show this help
  -v, --version      Print the version
`;

/** Expand a leading "~" to the home directory. */
export function expandTilde(p: string, home = homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

/** True for addresses that only accept connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function parsePort(value: string, source: string): number | string {
  if (!/^\d{1,5}$/.test(value.trim()))
    return `Invalid port "${value}" (${source}): expected 0-65535.`;
  const port = Number(value);
  return port <= 65535 ? port : `Invalid port "${value}" (${source}): expected 0-65535.`;
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());
}

function defaultWebDistCandidates(): string[] {
  return [fileURLToPath(new URL('./public', import.meta.url))];
}

function findWebDist(
  env: NodeJS.ProcessEnv,
  candidates: string[],
  cwd: string,
): string | undefined {
  const fromEnv = env.CODESPLAINER_WEB_DIST?.trim();
  const list = fromEnv ? [resolve(cwd, fromEnv)] : candidates;
  return list.find((dir) => existsSync(join(dir, 'index.html')));
}

/** Parse argv (without node and script) and the environment into a ServerConfig. */
export function resolveConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  opts: ConfigOptions = {},
): ConfigResult {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  let port: number | undefined;
  let host: string | undefined;
  let dataDir: string | undefined;
  let noOpen = false;
  let browser = false;
  const folders: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      folders.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      folders.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) return undefined;
      i++;
      return next;
    };
    switch (name) {
      case '-h':
      case '--help':
        return { action: 'help', text: HELP_TEXT };
      case '-v':
      case '--version':
        return { action: 'version', text: `${APP_VERSION}\n` };
      case '--no-open':
        noOpen = true;
        break;
      case '--browser':
        browser = true;
        break;
      case '-p':
      case '--port': {
        const v = value();
        if (v === undefined) return { action: 'error', message: `${name} needs a value.` };
        const parsed = parsePort(v, name);
        if (typeof parsed === 'string') return { action: 'error', message: parsed };
        port = parsed;
        break;
      }
      case '--host': {
        const v = value()?.trim();
        if (!v) return { action: 'error', message: '--host needs a value.' };
        host = v;
        break;
      }
      case '--data-dir': {
        const v = value()?.trim();
        if (!v) return { action: 'error', message: '--data-dir needs a value.' };
        dataDir = v;
        break;
      }
      default:
        return { action: 'error', message: `Unknown option: ${arg}` };
    }
  }

  if (port === undefined && env.CODESPLAINER_PORT?.trim()) {
    const parsed = parsePort(env.CODESPLAINER_PORT, 'CODESPLAINER_PORT');
    if (typeof parsed === 'string') return { action: 'error', message: parsed };
    port = parsed;
  }
  host ??= env.CODESPLAINER_HOST?.trim() || DEFAULT_HOST;
  dataDir ??= env.CODESPLAINER_HOME?.trim() || '~/.codesplainer';
  const resolvePath = (p: string) => {
    const expanded = expandTilde(p, home);
    return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
  };

  const warnings: string[] = [];
  if (!isLoopbackHost(host)) {
    warnings.push(
      `Listening on ${host}, which is reachable from other machines. Codesplainer has no login: ` +
        'anyone who can reach this port can read the files of your workspaces and run your agents. ' +
        `Use --host ${DEFAULT_HOST} unless you know what you are doing.`,
    );
  }

  return {
    action: 'run',
    config: {
      host,
      port: port ?? DEFAULT_PORT,
      dataDir: resolvePath(dataDir),
      open: !noOpen && !truthy(env.CODESPLAINER_NO_OPEN),
      browser: browser || truthy(env.CODESPLAINER_BROWSER),
      folders: folders.map(resolvePath),
      webDist: findWebDist(env, opts.webDistCandidates ?? defaultWebDistCandidates(), cwd),
      cwd,
      warnings,
    },
  };
}
