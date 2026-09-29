/**
 * Compact indented tree of a workspace for agent prompts:
 *
 *   web/  (/home/me/proj/web)
 *     package.json
 *     src/  (120 files)
 *       main.tsx
 *       components/  (64 files)
 *
 * Directories down to depth 3 with file counts; per directory all files when there are few,
 * else only notable ones (manifests, READMEs, entry points). The line budget is spent breadth
 * first, larger directories first, so huge repositories still get a balanced overview.
 */
import type { Workspace } from '@codesplainer/shared';
import { scanWorkspace, type DirNode, type FolderScan, type ScanOptions } from './scan';

export const TREE_MAX_LINES = 250;
/** Deepest directory whose contents are listed (its subdirectories are then not shown). */
const MAX_EXPAND_DEPTH = 3;
/** Directories with at most this many files list all of them. */
const LIST_ALL_FILES = 12;
/** More subdirectories than this are collapsed into a "… N more folders" line. */
const MAX_SUBDIRS = 25;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Contents {
  files: string[];
  moreFiles: number;
  dirs: DirNode[];
  moreDirs: number;
}

function contentsOf(node: DirNode): Contents {
  const files = node.files <= LIST_ALL_FILES ? node.fileNames : node.notable;
  const moreFiles = files.length ? node.files - files.length : 0;
  if (node.depth >= MAX_EXPAND_DEPTH) return { files, moreFiles, dirs: [], moreDirs: 0 };
  let dirs = node.dirs.filter(
    (d) => d.total > 0 && (!d.name.startsWith('.') || d.name === '.github'),
  );
  let moreDirs = 0;
  if (dirs.length > MAX_SUBDIRS) {
    const keep = new Set([...dirs].sort((a, b) => b.total - a.total).slice(0, MAX_SUBDIRS));
    moreDirs = dirs.length - keep.size;
    dirs = dirs.filter((d) => keep.has(d));
  }
  return { files, moreFiles, dirs, moreDirs };
}

const cost = (c: Contents) =>
  c.files.length + (c.moreFiles > 0 ? 1 : 0) + c.dirs.length + (c.moreDirs > 0 ? 1 : 0);

function headerLines(scan: FolderScan): string[] {
  const { folder, overview, tree } = scan;
  if (!tree) return [`${folder.alias}/  (${folder.path})  [missing on disk]`];
  const lines = [`${folder.alias}/  (${folder.path})`];
  if (overview.truncated) lines.push('  (large folder: scan stopped early, counts are partial)');
  return lines;
}

/** Decide which directories get their contents listed within the line budget. */
function plan(scans: FolderScan[], maxLines: number): { expanded: Set<DirNode>; lines: number } {
  const expanded = new Set<DirNode>();
  let lines = 0;
  let level: DirNode[] = [];
  for (const scan of scans) {
    lines += headerLines(scan).length;
    if (!scan.tree) continue;
    const contents = contentsOf(scan.tree);
    lines += cost(contents);
    expanded.add(scan.tree);
    level.push(...contents.dirs);
  }
  for (let depth = 1; depth <= MAX_EXPAND_DEPTH && level.length; depth++) {
    const next: DirNode[] = [];
    for (const node of [...level].sort((a, b) => b.total - a.total)) {
      const contents = contentsOf(node);
      const c = cost(contents);
      if (c === 0 || lines + c > maxLines) continue;
      lines += c;
      expanded.add(node);
      next.push(...contents.dirs);
    }
    level = next;
  }
  return { expanded, lines };
}

function renderDir(
  node: DirNode,
  expanded: Set<DirNode>,
  indent: string,
  partial: boolean,
  out: string[],
): void {
  const contents = contentsOf(node);
  for (const name of contents.files) out.push(`${indent}${name}`);
  if (contents.moreFiles > 0) out.push(`${indent}… ${plural(contents.moreFiles, 'more file')}`);
  for (const dir of contents.dirs) {
    const count = partial ? `${dir.total}+ files` : plural(dir.total, 'file');
    out.push(`${indent}${dir.name}/  (${count})`);
    if (expanded.has(dir)) renderDir(dir, expanded, `${indent}  `, partial, out);
  }
  if (contents.moreDirs > 0) out.push(`${indent}… ${plural(contents.moreDirs, 'more folder')}`);
}

/** Render scanned folders as a compact tree of at most `maxLines` lines. */
export function renderCompactTree(scans: FolderScan[], maxLines = TREE_MAX_LINES): string {
  const { expanded } = plan(scans, maxLines);
  const out: string[] = [];
  for (const scan of scans) {
    out.push(...headerLines(scan));
    if (scan.tree) renderDir(scan.tree, expanded, '  ', scan.overview.truncated, out);
  }
  if (out.length <= maxLines) return out.join('\n');
  const keep = Math.max(1, maxLines - 1);
  return [...out.slice(0, keep), `… (${out.length - keep} more lines)`].join('\n');
}

/** Scan a workspace and render its compact tree. */
export async function compactTree(
  workspace: Workspace,
  opts: ScanOptions & { maxLines?: number } = {},
): Promise<string> {
  const scan = await scanWorkspace(workspace, opts);
  return renderCompactTree(scan.folders, opts.maxLines);
}
