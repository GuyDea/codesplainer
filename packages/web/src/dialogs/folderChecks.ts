/** Validate local folder paths with POST /api/fs/check. */
import type { FsCheckResponse } from '@codesplainer/shared';
import { api, errorMessage } from '../lib/api';

export type FolderCheck =
  | { status: 'checking' }
  | { status: 'ok'; realPath?: string }
  | { status: 'invalid'; message: string };

export function describeCheck(result: FsCheckResponse['results'][string] | undefined): FolderCheck {
  if (!result) return { status: 'invalid', message: "Couldn't check" };
  if (!result.exists) return { status: 'invalid', message: 'Not found' };
  if (!result.isDir) return { status: 'invalid', message: 'Not a folder' };
  if (!result.readable) return { status: 'invalid', message: 'Not readable' };
  return { status: 'ok', realPath: result.realPath };
}

/** Parent directory of an absolute path (undefined for roots / empty). */
export function parentDir(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const clean = cleanPath(path);
  const index = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (index <= 0) return clean.startsWith('/') ? '/' : undefined;
  const parent = clean.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export async function checkFolders(paths: string[]): Promise<Record<string, FolderCheck>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};
  try {
    const { results } = await api.checkPaths(unique);
    return Object.fromEntries(unique.map((p) => [p, describeCheck(results[p])]));
  } catch (err) {
    const message = errorMessage(err);
    return Object.fromEntries(
      unique.map((p) => [p, { status: 'invalid', message } as FolderCheck]),
    );
  }
}

/** Trim and drop a trailing separator (keeps "/" and "C:\"). */
export function cleanPath(path: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '');
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed) || trimmed === '/') return trimmed;
  return trimmed.replace(/[\\/]+$/, '');
}
