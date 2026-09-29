/**
 * Directory listings for the file explorer: directories first, alphabetical, `.git` hidden,
 * ignored entries flagged (still listed so users can browse them), capped at 2000 entries.
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DirEntry, DirListing, Workspace } from '@codesplainer/shared';
import { badRequest } from '../errors';
import type { IgnoreRulesCache } from './ignore';
import { resolveInFolder } from './paths';

export const DIR_LIMIT = 2000;
const STAT_CONCURRENCY = 32;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export async function listDirectory(
  workspace: Workspace,
  alias: string | undefined,
  relPath: string,
  rulesCache: IgnoreRulesCache,
): Promise<DirListing> {
  const target = await resolveInFolder(workspace, alias, relPath);
  if (!target.stats.isDirectory()) throw badRequest(`"${target.rel}" is not a folder.`);
  const dirents: Dirent[] = await readdir(target.real, { withFileTypes: true });
  const candidates = dirents
    .filter((d) => d.name !== '.git')
    .sort((a, b) => collator.compare(a.name, b.name));

  const typed: { name: string; type: 'file' | 'dir'; path: string }[] = [];
  let next = 0;
  const resolveTypes = async () => {
    while (next < candidates.length) {
      const d = candidates[next++] as Dirent;
      let type: 'file' | 'dir' | undefined;
      if (d.isDirectory()) type = 'dir';
      else if (d.isFile()) type = 'file';
      else if (d.isSymbolicLink()) {
        const s = await stat(join(target.real, d.name)).catch(() => undefined);
        type = s?.isDirectory() ? 'dir' : s?.isFile() ? 'file' : undefined;
      }
      if (type)
        typed.push({ name: d.name, type, path: target.rel ? `${target.rel}/${d.name}` : d.name });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(STAT_CONCURRENCY, candidates.length) }, resolveTypes),
  );
  typed.sort((a, b) =>
    a.type === b.type ? collator.compare(a.name, b.name) : a.type === 'dir' ? -1 : 1,
  );
  const truncated = typed.length > DIR_LIMIT;
  const shown = typed.slice(0, DIR_LIMIT);

  const rules = rulesCache.get(target.folder.path);
  const entries: DirEntry[] = [];
  let index = 0;
  const describe = async () => {
    while (index < shown.length) {
      const i = index++;
      const item = shown[i] as (typeof shown)[number];
      const entry: DirEntry = { name: item.name, path: item.path, type: item.type };
      if (item.type === 'file') {
        const s = await stat(join(target.real, item.name)).catch(() => undefined);
        if (s) entry.size = s.size;
      }
      if (await rules.isIgnored(item.path, item.type === 'dir')) entry.ignored = true;
      entries[i] = entry;
    }
  };
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, shown.length) }, describe));
  return { folder: target.folder.alias, path: target.rel, entries, truncated };
}
