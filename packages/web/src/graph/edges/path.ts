/** Geometry helpers for edges: rounded polylines, midpoints, arrowheads. */
import type { Point } from '../layout';

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Remove consecutive duplicates and collinear middle points. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1] as Point;
    const b = out[i] as Point;
    const c = out[i + 1] as Point;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.01 && dot > 0) out.splice(i, 1);
  }
  return out;
}

const f = (n: number) => Math.round(n * 100) / 100;

/** SVG path through the points with rounded corners (quadratic joins). */
export function roundedPath(points: Point[], radius = 8): string {
  const pts = simplify(points);
  const first = pts[0];
  if (!first) return '';
  let d = `M ${f(first.x)} ${f(first.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1] as Point;
    const cur = pts[i] as Point;
    const next = pts[i + 1] as Point;
    const inLen = dist(prev, cur);
    const outLen = dist(cur, next);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${f(cur.x)} ${f(cur.y)}`;
      continue;
    }
    const a = {
      x: cur.x - ((cur.x - prev.x) / inLen) * r,
      y: cur.y - ((cur.y - prev.y) / inLen) * r,
    };
    const b = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    };
    d += ` L ${f(a.x)} ${f(a.y)} Q ${f(cur.x)} ${f(cur.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const last = pts[pts.length - 1] as Point;
  if (pts.length > 1) d += ` L ${f(last.x)} ${f(last.y)}`;
  return d;
}

/** Point at half of the polyline's length. */
export function polylineMidpoint(points: Point[]): Point {
  const pts = simplify(points);
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0] as Point;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1] as Point, pts[i] as Point);
  let remaining = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = dist(a, b);
    if (remaining <= len && len > 0) {
      const t = remaining / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  return pts[pts.length - 1] as Point;
}

/** Shorten the last segment by `by` px (so a stroke does not poke through an arrowhead). */
export function trimEnd(points: Point[], by: number): Point[] {
  const pts = simplify(points);
  if (pts.length < 2 || by <= 0) return pts;
  const end = pts[pts.length - 1] as Point;
  const prev = pts[pts.length - 2] as Point;
  const len = dist(prev, end);
  if (len <= by + 0.5) return pts;
  const t = (len - by) / len;
  return [
    ...pts.slice(0, -1),
    { x: prev.x + (end.x - prev.x) * t, y: prev.y + (end.y - prev.y) * t },
  ];
}

/** Filled arrowhead with its tip at the last point, aligned with the last segment. */
export function arrowHead(points: Point[], length = 8, halfWidth = 4.2): string {
  const pts = simplify(points);
  const tip = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (!tip || !prev) return '';
  const len = dist(prev, tip) || 1;
  const ux = (tip.x - prev.x) / len;
  const uy = (tip.y - prev.y) / len;
  const bx = tip.x - ux * length;
  const by = tip.y - uy * length;
  const nx = -uy * halfWidth;
  const ny = ux * halfWidth;
  // Slightly concave base reads crisper than a flat triangle.
  const cx = tip.x - ux * length * 0.72;
  const cy = tip.y - uy * length * 0.72;
  return `M ${f(tip.x)} ${f(tip.y)} L ${f(bx + nx)} ${f(by + ny)} L ${f(cx)} ${f(cy)} L ${f(bx - nx)} ${f(by - ny)} Z`;
}
