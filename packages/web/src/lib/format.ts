/** Small formatting helpers for the UI (relative times, counts). */

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "Mar 3", "Mar 3, 2023". */
export function relativeTime(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  );
}

/** Full local date/time for tooltips. */
export function absoluteTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : '';
}

/** "1 diagram", "3 diagrams". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Locale thousands separators ("12,345"). */
export function formatCount(count: number): string {
  return Number.isFinite(count) ? count.toLocaleString() : '—';
}

/** Percentage with at most one decimal for small shares ("0.4%", "37%"). */
export function formatPercent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const pct = share * 100;
  return pct < 10 ? `${pct.toFixed(1).replace(/\.0$/, '')}%` : `${Math.round(pct)}%`;
}
