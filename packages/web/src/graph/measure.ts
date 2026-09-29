/**
 * Text measurement used to size boxes before layout. Browsers measure with a canvas using the
 * same font stacks as the design tokens; non-browser environments (tests) use a deterministic
 * per-character width heuristic.
 */

export interface FontSpec {
  /** Font size in px. */
  size: number;
  weight: number;
  family?: 'sans' | 'mono';
}

const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO =
  "ui-monospace, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', SFMono-Regular, Menlo, Consolas, monospace";

export function cssFont(font: FontSpec): string {
  return `${font.weight} ${font.size}px ${font.family === 'mono' ? MONO : SANS}`;
}

let context: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  context = null;
  try {
    if (typeof document !== 'undefined' && typeof navigator !== 'undefined') {
      // happy-dom / jsdom report themselves in the user agent and have no real canvas.
      if (/happy-?dom|jsdom/i.test(navigator.userAgent)) return context;
      const g = document.createElement('canvas').getContext('2d');
      if (g && typeof g.measureText === 'function') {
        g.font = '10px sans-serif';
        if (g.measureText('abc').width > 0) context = g;
      }
    }
  } catch {
    context = null;
  }
  return context;
}

const NARROW = new Set("iljtfr.,:;|!'`()[]{} ".split(''));
const WIDE = new Set('mwMW@%'.split(''));

/** Deterministic width estimate (em-based) used when no canvas is available. */
function estimateWidth(text: string, font: FontSpec): number {
  if (font.family === 'mono') return text.length * font.size * 0.6;
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.3;
    else if (WIDE.has(ch)) em += 0.85;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else if (ch >= '0' && ch <= '9') em += 0.56;
    else em += 0.53;
  }
  const weightFactor = font.weight >= 600 ? 1.05 : font.weight >= 500 ? 1.02 : 1;
  return em * font.size * weightFactor;
}

const cache = new Map<string, number>();

/** Width of a single line of text in px. */
export function measureText(text: string, font: FontSpec): number {
  if (!text) return 0;
  const key = `${font.size}|${font.weight}|${font.family ?? 'sans'}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const ctx = canvasContext();
  let width: number;
  if (ctx) {
    ctx.font = cssFont(font);
    width = ctx.measureText(text).width;
  } else {
    width = estimateWidth(text, font);
  }
  if (cache.size > 4000) cache.clear();
  cache.set(key, width);
  return width;
}

/** True when real (canvas) measurement is available. Part of layout cache keys. */
export function measurementMode(): 'canvas' | 'estimate' {
  return canvasContext() ? 'canvas' : 'estimate';
}

/**
 * Number of lines `text` wraps into at `maxWidth` (greedy word wrap, long words broken like CSS
 * `overflow-wrap: anywhere`).
 */
export function countLines(text: string, maxWidth: number, font: FontSpec): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const space = measureText(' ', font);
  let lines = 1;
  let line = 0;
  for (const word of words) {
    const w = measureText(word, font);
    if (line === 0) {
      if (w <= maxWidth) {
        line = w;
      } else {
        // Break the long word across lines.
        lines += Math.ceil(w / maxWidth) - 1;
        line = w % maxWidth || maxWidth;
      }
      continue;
    }
    if (line + space + w <= maxWidth) {
      line += space + w;
    } else if (w <= maxWidth) {
      lines++;
      line = w;
    } else {
      lines += Math.ceil(w / maxWidth);
      line = w % maxWidth || maxWidth;
    }
  }
  return lines;
}
