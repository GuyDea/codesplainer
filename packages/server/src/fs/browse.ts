/**
 * In-app folder browser (GET /api/fs/browse): directories only, of any absolute path on this
 * machine (the user is choosing workspace folders), default = home.
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import type { BrowseEntry, BrowseResult, Workspace } from '@codesplainer/shared';
import { badRequest, notFound } from '../errors';
import { cleanUserPath, pathKey } from './paths';

export const BROWSE_LIMIT = 2000;
const STAT_CONCURRENCY = 32;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface BrowseOptions {
  path?: string;
  hidden?: boolean;
  /** Recent workspaces, most recent first (for shortcuts). */
  workspaces?: Workspace[];
  cwd?: string;
  home?: string;
}

async function isGitRepo(dir: string): Promise<boolean> {
  return stat(join(dir, '.git')).then(
    () => true,
    () => false,
  );
}

function shortcuts(opts: BrowseOptions, home: string, current: string): BrowseResult['shortcuts'] {
  const out: BrowseResult['shortcuts'] = [];
  const seen = new Set<string>();
  const add = (label: string, path: string) => {
    const key = pathKey(path);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, path });
  };
  add('Home', home);
  let recent = 0;
  for (const w of opts.workspaces ?? []) {
    for (const f of w.folders) {
      if (recent >= 5) break;
      const before = out.length;
      add(basename(f.path) || f.path, f.path);
      if (out.length > before) recent++;
    }
  }
  if (opts.cwd) add('Server folder', opts.cwd);
  add('Computer', parse(current).root || sep);
  return out;
}

export async function browseDirectories(opts: BrowseOptions = {}): Promise<BrowseResult> {
  const home = opts.home ?? homedir();
  const raw = opts.path?.trim() ? cleanUserPath(opts.path, home) : home;
  if (raw.includes('\0') || !isAbsolute(raw)) throw badRequest('Path must be absolute.');
  const path = resolve(raw);
  const s = await stat(path).catch(() => undefined);
  if (!s) throw notFound(`Folder ${path}`);
  if (!s.isDirectory()) throw badRequest(`Not a folder: ${path}`);

  let dirents: Dirent[];
  try {
    dirents = await readdir(path, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw badRequest(
      code === 'EACCES' || code === 'EPERM'
        ? `No permission to read ${path}`
        : `Cannot read ${path}`,
    );
  }
  const candidates = dirents
    .filter((d) => opts.hidden || !d.name.startsWith('.'))
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .sort((a, b) => collator.compare(a.name, b.name))
    .slice(0, BROWSE_LIMIT);

  const entries: (BrowseEntry | undefined)[] = new Array(candidates.length);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      const d = candidates[i] as Dirent;
      const full = join(path, d.name);
      if (d.isSymbolicLink()) {
        const target = await stat(full).catch(() => undefined);
        if (!target?.isDirectory()) continue;
      }
      entries[i] = {
        name: d.name,
        path: full,
        hidden: d.name.startsWith('.'),
        isGitRepo: await isGitRepo(full),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, candidates.length) }, worker));

  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    home,
    separator: sep,
    entries: entries.filter((e): e is BrowseEntry => e !== undefined),
    shortcuts: shortcuts(opts, home, path),
  };
}
