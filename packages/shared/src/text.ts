/** Small, dependency-free text helpers shared by server and web. */

/** Collapse whitespace and trim. */
export function squish(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Truncate to `max` characters, preferring a word boundary, appending an ellipsis when cut.
 * Returns the squished input unchanged when it already fits.
 */
export function truncate(value: string, max: number): string {
  const text = squish(value);
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  const hard = text.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.replace(/[\s,;:.-]+$/, '')}…`;
}

/** Lower-case kebab slug limited to [a-z0-9-]. Never returns an empty string. */
export function slugify(value: string, fallback = 'item'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Word count of a string (used to enforce "few words" rules in tests and UI hints). */
export function wordCount(value: string): number {
  const text = squish(value);
  return text ? text.split(' ').length : 0;
}

/** Normalise a path to forward slashes without leading "./" or trailing slash. */
export function toPosixPath(value: string): string {
  let p = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p === '.' ? '' : p;
}

/** Last path segment of a POSIX or Windows path. */
export function baseName(value: string): string {
  const parts = value.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || value;
}

/** Make unique, filesystem/URL-friendly aliases for workspace folders (derived from base names). */
export function makeFolderAliases(paths: string[], existing: string[] = []): string[] {
  const used = new Set(existing.map((a) => a.toLowerCase()));
  return paths.map((p) => {
    const base =
      baseName(p)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'folder';
    let alias = base;
    let n = 2;
    while (used.has(alias.toLowerCase())) alias = `${base}-${n++}`;
    used.add(alias.toLowerCase());
    return alias;
  });
}

/** Human readable byte size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** Human readable duration from milliseconds ("850 ms", "12 s", "3 m 05 s"). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m} m ${String(rest).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} m`;
}
