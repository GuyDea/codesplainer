/** Timestamp helpers. All stored timestamps are ISO 8601 strings in UTC. */

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * An ISO timestamp strictly later than `previous` (or now). Used for `updatedAt` fields the web
 * client orders by: they must only ever increase, even when two changes land in the same ms.
 */
export function laterIso(previous?: string): string {
  const now = Date.now();
  const prev = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
}

/** Milliseconds since an ISO timestamp (Infinity when missing or invalid). */
export function ageMs(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}
