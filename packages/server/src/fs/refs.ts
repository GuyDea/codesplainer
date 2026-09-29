/**
 * Validation of the code refs in a generated diagram: every ref must point to an existing file or
 * directory inside a workspace folder. Refs are matched by folder alias, by absolute path, or by
 * trying each folder; line ranges are fixed (inverted) and clamped to the file; directories are
 * flagged; refs to missing files are dropped with one summary warning.
 */
import type { Stats } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  toPosixPath,
  type CodeRef,
  type GraphSpec,
  type Workspace,
  type WorkspaceFolder,
} from '@codesplainer/shared';
import { countFileLines } from './file';
import { isInside, joinInFolder, locateAbsolute } from './paths';

/** Files larger than this are not line-counted (their line ranges are kept as given). */
const MAX_COUNT_BYTES = 32 * 1024 * 1024;
const LINE_CACHE_LIMIT = 1000;

/** Line counts keyed by real path + mtime + size, shared across runs. */
const lineCache = new Map<string, number>();

async function lineCountOf(real: string, s: Stats): Promise<number | undefined> {
  if (s.size > MAX_COUNT_BYTES) return undefined;
  const key = `${real}|${s.mtimeMs}|${s.size}`;
  const hit = lineCache.get(key);
  if (hit !== undefined) return hit;
  const count = await countFileLines(real).catch(() => undefined);
  if (count === undefined) return undefined;
  if (lineCache.size >= LINE_CACHE_LIMIT) {
    const oldest = lineCache.keys().next().value;
    if (oldest !== undefined) lineCache.delete(oldest);
  }
  lineCache.set(key, count);
  return count;
}

export interface ResolvedRef {
  folder: WorkspaceFolder;
  /** Folder-relative path, forward slashes ('' = folder root). */
  rel: string;
  abs: string;
  real: string;
  isDir: boolean;
  /** Number of lines (files only; undefined when too large to count). */
  lineCount?: number;
}

/** Per-run memo of real paths / probes. */
export class RefResolver {
  private readonly roots = new Map<string, Promise<string | undefined>>();
  private readonly probes = new Map<string, Promise<ResolvedRef | undefined>>();

  constructor(private readonly workspace: Workspace) {}

  private rootReal(folder: WorkspaceFolder): Promise<string | undefined> {
    let p = this.roots.get(folder.path);
    if (!p) {
      p = realpath(folder.path).catch(() => undefined);
      this.roots.set(folder.path, p);
    }
    return p;
  }

  private probe(folder: WorkspaceFolder, rel: string): Promise<ResolvedRef | undefined> {
    const key = `${folder.alias}\u0000${rel}`;
    let p = this.probes.get(key);
    if (!p) {
      p = (async () => {
        const root = await this.rootReal(folder);
        if (!root) return undefined;
        const abs = joinInFolder(folder, rel);
        const real = await realpath(abs).catch(() => undefined);
        if (!real || !isInside(root, real)) return undefined;
        const s = await stat(real).catch(() => undefined);
        if (!s || (!s.isDirectory() && !s.isFile())) return undefined;
        const isDir = s.isDirectory();
        const lineCount = isDir ? undefined : await lineCountOf(real, s);
        return { folder, rel, abs, real, isDir, ...(lineCount !== undefined ? { lineCount } : {}) };
      })();
      this.probes.set(key, p);
    }
    return p;
  }

  private matchFolder(name: string | undefined): WorkspaceFolder | undefined {
    if (!name) return undefined;
    const folders = this.workspace.folders;
    const lower = name.toLowerCase();
    return (
      folders.find((f) => f.alias === name) ??
      folders.find((f) => f.alias.toLowerCase() === lower) ??
      folders.find((f) => toPosixPath(f.path) === toPosixPath(name))
    );
  }

  /** Candidate (folder, relative path) pairs for a ref, most likely first. */
  private candidates(ref: CodeRef): { folder: WorkspaceFolder; rel: string }[] {
    const folders = this.workspace.folders;
    const rawPath = ref.path.trim().replace(/^file:\/\//, '');
    if (isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)) {
      const hit = locateAbsolute(this.workspace, rawPath);
      return hit ? [hit] : [];
    }
    const rel = toPosixPath(rawPath).replace(/^\/+/, '');
    const parts = rel.split('/').filter((p) => p && p !== '.');
    if (parts.includes('..')) return [];
    const clean = parts.join('/');
    const out: { folder: WorkspaceFolder; rel: string }[] = [];
    const named = this.matchFolder(ref.folder);
    if (named) out.push({ folder: named, rel: clean });
    // "alias/rest" when the agent put the folder alias into the path.
    for (const f of folders) {
      if (clean.startsWith(`${f.alias}/`))
        out.push({ folder: f, rel: clean.slice(f.alias.length + 1) });
      else if (clean === f.alias) out.push({ folder: f, rel: '' });
    }
    for (const f of folders) out.push({ folder: f, rel: clean });
    const seen = new Set<string>();
    return out.filter((c) => {
      const key = `${c.folder.alias}\u0000${c.rel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Find the file/directory a ref points to (undefined when missing or outside the folders). */
  async resolve(ref: CodeRef): Promise<ResolvedRef | undefined> {
    for (const c of this.candidates(ref)) {
      const hit = await this.probe(c.folder, c.rel);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** Resolve one ref against a workspace. */
export function resolveCodeRef(
  ref: CodeRef,
  workspace: Workspace,
): Promise<ResolvedRef | undefined> {
  return new RefResolver(workspace).resolve(ref);
}

/** The canonical ref for a resolved target (folder alias set, lines fixed and clamped). */
export function normalizedRef(ref: CodeRef, target: ResolvedRef): CodeRef {
  const out: CodeRef = { folder: target.folder.alias, path: target.rel };
  if (ref.symbol) out.symbol = ref.symbol;
  if (target.isDir) {
    out.isDir = true;
    return out;
  }
  let start = ref.startLine;
  let end = ref.endLine;
  if (start === undefined && end !== undefined) start = end;
  if (start !== undefined && end !== undefined && end < start) [start, end] = [end, start];
  if (start !== undefined && target.lineCount !== undefined) {
    if (start > target.lineCount) {
      start = undefined;
      end = undefined;
    } else if (end !== undefined && end > target.lineCount) {
      end = target.lineCount;
    }
  }
  if (start !== undefined) out.startLine = start;
  if (start !== undefined && end !== undefined) out.endLine = end;
  return out;
}

const refKey = (r: CodeRef) =>
  `${r.folder ?? ''}|${r.path}|${r.startLine ?? ''}|${r.endLine ?? ''}`;

/** Validate and normalize every node ref of a diagram. Returns a new spec. */
export async function resolveSpecRefs(
  spec: GraphSpec,
  workspace: Workspace,
): Promise<{ spec: GraphSpec; warnings: string[] }> {
  const resolver = new RefResolver(workspace);
  let removed = 0;
  const nodes = await Promise.all(
    spec.nodes.map(async (node) => {
      const refs: CodeRef[] = [];
      const seen = new Set<string>();
      for (const ref of node.refs) {
        const target = await resolver.resolve(ref);
        if (!target) {
          removed++;
          continue;
        }
        const fixed = normalizedRef(ref, target);
        const key = refKey(fixed);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(fixed);
      }
      return { ...node, refs };
    }),
  );
  const warnings = removed > 0 ? [`Removed ${removed} reference(s) to missing files`] : [];
  return { spec: { ...structuredClone(spec), nodes }, warnings };
}
