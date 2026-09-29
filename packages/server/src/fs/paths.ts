/**
 * Path safety for workspace access.
 * - Workspace folder paths supplied by users are normalized: ~ expanded, absolute, existing,
 *   a readable directory, real path, deduplicated.
 * - Paths inside a folder are folder-relative with forward slashes; absolute paths, `..`
 *   segments and symlinks resolving outside the folder are rejected.
 */
import { constants, type Stats } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toPosixPath, type Workspace, type WorkspaceFolder } from '@codesplainer/shared';
import { expandTilde } from '../config';
import { badRequest, forbidden, notFound } from '../errors';

const IS_CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

/** Is `target` equal to or inside `root`? (both absolute, already normalized) */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Comparable form of an absolute path (case-folded on case-insensitive platforms). */
export function pathKey(p: string): string {
  const r = resolve(p);
  return IS_CASE_INSENSITIVE_FS ? r.toLowerCase() : r;
}

/** Same set of paths (order ignored). */
export function samePathSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(pathKey).sort();
  const right = b.map(pathKey).sort();
  return left.every((p, i) => p === right[i]);
}

/** Trim, drop wrapping quotes and trailing separators (keeps "/" and "C:\"), expand ~. */
export function cleanUserPath(input: string, home = homedir()): string {
  let p = input.trim();
  if (p.length >= 2 && /^(["']).*\1$/.test(p)) p = p.slice(1, -1).trim();
  if (p.length > 1 && !/^[A-Za-z]:[\\/]?$/.test(p)) p = p.replace(/[\\/]+$/, '') || p.slice(0, 1);
  return expandTilde(p, home);
}

/**
 * Normalize one user-supplied folder path. Relative paths are only accepted when `base` is given
 * (CLI arguments). Throws HttpError 400 with a message meant for the user.
 */
export async function normalizeFolderPath(
  input: string,
  opts: { base?: string; home?: string } = {},
): Promise<string> {
  const cleaned = cleanUserPath(input, opts.home);
  if (!cleaned) throw badRequest('Folder path is empty.');
  if (cleaned.includes('\0')) throw badRequest('Folder path contains invalid characters.');
  if (!isAbsolute(cleaned) && !opts.base) {
    throw badRequest(`Folder path must be absolute: ${input.trim()}`);
  }
  const abs = opts.base ? resolve(opts.base, cleaned) : resolve(cleaned);
  let s: Stats;
  try {
    s = await stat(abs);
  } catch {
    throw badRequest(`Folder not found: ${abs}`);
  }
  if (!s.isDirectory()) throw badRequest(`Not a folder: ${abs}`);
  try {
    await access(abs, constants.R_OK | constants.X_OK);
  } catch {
    throw badRequest(`Folder is not readable: ${abs}`);
  }
  return realpath(abs);
}

/** Normalize and deduplicate (by real path) a list of folder paths, keeping the order. */
export async function normalizeFolderPaths(
  inputs: readonly string[],
  opts: { base?: string; home?: string } = {},
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const p = await normalizeFolderPath(input, opts);
    const key = pathKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  if (!out.length) throw badRequest('At least one folder is required.');
  return out;
}

/**
 * Validate a folder-relative path: forward slashes, no leading slash, no `.`/`..` segments.
 * Returns the canonical form ('' = folder root).
 */
export function safeRelativePath(input: string): string {
  if (input.includes('\0')) throw badRequest('Path contains invalid characters.');
  const posix = toPosixPath(input.trim());
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) {
    throw badRequest('Path must be relative to the workspace folder.');
  }
  const parts = posix.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw badRequest('Path must stay inside the workspace folder.');
  return parts.join('/');
}

/** Find a folder by alias (exact, then case-insensitive). Empty alias = the first folder. */
export function findFolder(workspace: Workspace, alias: string | undefined): WorkspaceFolder {
  const folders = workspace.folders;
  if (!alias) {
    const first = folders[0];
    if (!first) throw notFound('Workspace folder');
    return first;
  }
  const hit =
    folders.find((f) => f.alias === alias) ??
    folders.find((f) => f.alias.toLowerCase() === alias.toLowerCase());
  if (!hit) throw notFound(`Folder "${alias}"`);
  return hit;
}

/** Absolute path of a folder-relative path (no checks). */
export function joinInFolder(folder: WorkspaceFolder, rel: string): string {
  return rel ? join(folder.path, ...rel.split('/')) : folder.path;
}

export interface ResolvedPath {
  folder: WorkspaceFolder;
  /** Canonical folder-relative path ('' = folder root). */
  rel: string;
  /** Absolute path below the folder as configured (what users recognize). */
  abs: string;
  /** Real path (symlinks resolved), guaranteed inside the folder's real path. */
  real: string;
  stats: Stats;
}

/** Resolve an existing file/directory inside a workspace folder (404 / 400 / 403 on problems). */
export async function resolveInFolder(
  workspace: Workspace,
  alias: string | undefined,
  relPath: string,
): Promise<ResolvedPath> {
  const folder = findFolder(workspace, alias);
  const rel = safeRelativePath(relPath);
  const abs = joinInFolder(folder, rel);
  let rootReal: string;
  try {
    rootReal = await realpath(folder.path);
  } catch {
    throw notFound(`Folder "${folder.alias}" (${folder.path})`);
  }
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    throw notFound(rel ? `"${rel}"` : `Folder "${folder.alias}"`);
  }
  if (!isInside(rootReal, real)) {
    throw forbidden('outside_folder', `"${rel}" points outside the workspace folder.`);
  }
  const stats = await stat(real);
  return { folder, rel, abs, real, stats };
}

/** Map an absolute path to the workspace folder containing it (longest folder path wins). */
export function locateAbsolute(
  workspace: Pick<Workspace, 'folders'>,
  absPath: string,
): { folder: WorkspaceFolder; rel: string } | undefined {
  if (!isAbsolute(absPath)) return undefined;
  const target = resolve(absPath);
  const folders = [...workspace.folders].sort((a, b) => b.path.length - a.path.length);
  for (const folder of folders) {
    const root = resolve(folder.path);
    const inside = IS_CASE_INSENSITIVE_FS
      ? isInside(root.toLowerCase(), target.toLowerCase())
      : isInside(root, target);
    if (inside) return { folder, rel: toPosixPath(relative(root, target)) };
  }
  return undefined;
}

export interface PathCheck {
  exists: boolean;
  isDir: boolean;
  readable: boolean;
  realPath?: string;
}

/** Existence / type / readability of an arbitrary local path (for the folder dialogs). */
export async function checkPath(input: string): Promise<PathCheck> {
  const cleaned = cleanUserPath(input);
  if (!cleaned || cleaned.includes('\0') || !isAbsolute(cleaned)) {
    return { exists: false, isDir: false, readable: false };
  }
  let s: Stats;
  try {
    s = await stat(cleaned);
  } catch {
    return { exists: false, isDir: false, readable: false };
  }
  const isDir = s.isDirectory();
  const readable = await access(cleaned, isDir ? constants.R_OK | constants.X_OK : constants.R_OK)
    .then(() => true)
    .catch(() => false);
  const realPath = await realpath(cleaned).catch(() => undefined);
  return { exists: true, isDir, readable, ...(realPath ? { realPath } : {}) };
}
