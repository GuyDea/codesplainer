/** Animation duration helper: viewport animations are skipped for users who prefer reduced motion. */
export function motion(duration: number): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return duration;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
}
