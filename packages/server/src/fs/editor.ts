/**
 * "Open in editor": settings.editorCommand, else the first editor CLI found on PATH, else the
 * platform opener (xdg-open / open / explorer). The editor is started detached and not awaited.
 */
import { basename, extname } from 'node:path';
import crossSpawn from 'cross-spawn';
import { findOnPath } from '../agents/detect';
import { HttpError, badRequest } from '../errors';

/** Auto-detected editors, in order of preference. */
export const EDITOR_CANDIDATES = [
  'code',
  'cursor',
  'kiro',
  'codium',
  'windsurf',
  'zed',
  'subl',
  'idea',
];

const VSCODE_FAMILY = new Set([
  'code',
  'code-insiders',
  'cursor',
  'kiro',
  'codium',
  'vscodium',
  'windsurf',
  'code-oss',
]);
const PLAIN_LINE_SUFFIX = new Set(['zed', 'subl', 'sublime_text', 'zeditor']);
const JETBRAINS = new Set([
  'idea',
  'idea64',
  'webstorm',
  'pycharm',
  'goland',
  'phpstorm',
  'rider',
  'clion',
  'rubymine',
  'rustrover',
  'studio',
  'fleet',
]);

/** Split a command line into words, honouring single and double quotes. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || current) out.push(current);
      current = '';
      has = false;
    } else {
      current += ch;
    }
  }
  if (has || current) out.push(current);
  return out;
}

function family(command: string): 'vscode' | 'suffix' | 'jetbrains' | 'plain' {
  const name = basename(command, extname(command)).toLowerCase();
  if (VSCODE_FAMILY.has(name)) return 'vscode';
  if (PLAIN_LINE_SUFFIX.has(name)) return 'suffix';
  if (JETBRAINS.has(name)) return 'jetbrains';
  return 'plain';
}

/** Arguments that open `file` at `line` for the given editor command. */
export function editorArgs(command: string, file: string, line?: number): string[] {
  switch (family(command)) {
    case 'vscode':
      return line ? ['-g', `${file}:${line}`] : [file];
    case 'suffix':
      return [line ? `${file}:${line}` : file];
    case 'jetbrains':
      return line ? ['--line', String(line), file] : [file];
    default:
      return [file];
  }
}

function systemOpener(): string[] {
  if (process.platform === 'darwin') return ['open'];
  if (process.platform === 'win32') return ['explorer.exe'];
  return ['xdg-open'];
}

const quoteArg = (a: string) => (/[\s"']/.test(a) ? JSON.stringify(a) : a);

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = crossSpawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Open a file (absolute path, already validated) in an editor. Returns the command line used.
 */
export async function openInEditor(
  file: string,
  line: number | undefined,
  editorCommand: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  let words: string[];
  if (editorCommand.trim()) {
    words = splitCommand(editorCommand);
    if (!words.length) throw badRequest('The editor command in settings is empty.');
  } else {
    let found: string | undefined;
    for (const name of EDITOR_CANDIDATES) {
      if (await findOnPath(name, env)) {
        found = name;
        break;
      }
    }
    words = found ? [found] : systemOpener();
  }
  const [command, ...extra] = words as [string, ...string[]];
  const args = [...extra, ...editorArgs(command, file, line)];
  try {
    await spawnDetached(command, args);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw badRequest(
        editorCommand.trim()
          ? `Editor command not found: ${command}. Check "Editor command" in settings.`
          : `No editor found (tried ${EDITOR_CANDIDATES.join(', ')} and ${command}). Set "Editor command" in settings.`,
      );
    }
    throw new HttpError(500, 'editor_failed', `Could not start ${command}: ${String(e)}`);
  }
  return [command, ...args].map(quoteArg).join(' ');
}
