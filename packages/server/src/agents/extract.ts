/**
 * Robust JSON extraction from free-form agent answers: the whole text, ```json fences (last valid
 * wins), then a balanced-brace scan that respects strings and escapes. Objects that look like a
 * diagram (have a node list, possibly inside a wrapper key) are preferred. Cheap repairs: trailing
 * commas, comments, smart quotes.
 */
import { isObject } from './util';

const NODE_LIST_KEYS = [
  'nodes',
  'boxes',
  'components',
  'items',
  'elements',
  'participants',
  'states',
  'steps',
];
const WRAPPER_KEYS = [
  'graph',
  'diagram',
  'result',
  'data',
  'output',
  'response',
  'structured_output',
  'spec',
  'answer',
];
const MAX_TEXT = 2_000_000;
const MAX_SCAN_STARTS = 400;

/** True when the value is (or wraps) an object with a node list. */
export function looksLikeDiagram(value: unknown, depth = 0): boolean {
  if (!isObject(value)) return false;
  if (NODE_LIST_KEYS.some((k) => Array.isArray(value[k]))) return true;
  if (depth >= 2) return false;
  return WRAPPER_KEYS.some((k) => looksLikeDiagram(value[k], depth + 1));
}

export interface ExtractOptions {
  /** Preferred candidates (default: looksLikeDiagram). */
  prefer?: (value: unknown) => boolean;
}

interface Candidate {
  value: unknown;
  start: number;
  length: number;
  source: 'whole' | 'fence' | 'scan';
}

/** Apply `fn` to every character outside of JSON strings (strings are copied verbatim). */
function outsideStrings(
  text: string,
  fn: (text: string, i: number) => { emit: string; skip: number },
): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    const r = fn(text, i);
    out += r.emit;
    i += r.skip;
  }
  return out;
}

/** Remove // and /* *\/ comments, then trailing commas, outside of strings. */
function loosen(text: string): string {
  const noComments = outsideStrings(text, (t, i) => {
    if (t[i] === '/' && t[i + 1] === '/') {
      const end = t.indexOf('\n', i);
      return { emit: '\n', skip: (end < 0 ? t.length : end) - i };
    }
    if (t[i] === '/' && t[i + 1] === '*') {
      const end = t.indexOf('*/', i + 2);
      return { emit: ' ', skip: (end < 0 ? t.length : end + 2) - i - 1 };
    }
    return { emit: t[i] as string, skip: 0 };
  });
  return outsideStrings(noComments, (t, i) => {
    if (t[i] === ',') {
      let j = i + 1;
      while (j < t.length && /\s/.test(t[j] as string)) j++;
      if (t[j] === '}' || t[j] === ']') return { emit: '', skip: 0 };
    }
    return { emit: t[i] as string, skip: 0 };
  });
}

const SMART_DOUBLE = /[\u201C\u201D\u201E\u201F\u2033\u2036]/;
const SMART_DOUBLE_ALL = new RegExp(SMART_DOUBLE.source, 'g');

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // fall through to cheap repairs
  }
  const loose = loosen(trimmed);
  if (loose !== trimmed) {
    try {
      return { ok: true, value: JSON.parse(loose) };
    } catch {
      // ignore
    }
  }
  if (SMART_DOUBLE.test(trimmed)) {
    try {
      return { ok: true, value: JSON.parse(loosen(trimmed.replace(SMART_DOUBLE_ALL, '"'))) };
    } catch {
      // ignore
    }
  }
  return { ok: false };
}

/** End index (inclusive) of the balanced {...} starting at `start`, or -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function fenceCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lang = (m[1] ?? '').toLowerCase();
    if (lang && !['json', 'jsonc', 'json5', 'javascript', 'js', 'ts', 'text'].includes(lang))
      continue;
    const body = m[2] ?? '';
    const parsed = tryParse(body);
    if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
      out.push({ value: parsed.value, start: m.index, length: m[0].length, source: 'fence' });
    }
  }
  return out;
}

function scanCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  let starts = 0;
  let i = text.indexOf('{');
  while (i >= 0 && starts < MAX_SCAN_STARTS) {
    starts++;
    const end = balancedEnd(text, i);
    if (end > i) {
      const parsed = tryParse(text.slice(i, end + 1));
      if (parsed.ok && isObject(parsed.value)) {
        out.push({ value: parsed.value, start: i, length: end + 1 - i, source: 'scan' });
        i = text.indexOf('{', end + 1);
        continue;
      }
    }
    i = text.indexOf('{', i + 1);
  }
  return out;
}

/**
 * Extract the most plausible JSON value from an agent answer. Returns undefined when nothing
 * parseable is found.
 */
export function extractJson(text: string, opts: ExtractOptions = {}): unknown {
  if (typeof text !== 'string') return undefined;
  const prefer = opts.prefer ?? looksLikeDiagram;
  const input = (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text).replace(/^\uFEFF/, '');

  // The whole answer is JSON: that is the answer.
  const whole = tryParse(input);
  if (whole.ok && typeof whole.value === 'object' && whole.value !== null) return whole.value;

  const fences = fenceCandidates(input);
  const preferredFence = [...fences].reverse().find((c) => prefer(c.value));
  if (preferredFence) return preferredFence.value;

  const scanned = scanCandidates(input);
  const preferredScan = [...scanned].reverse().find((c) => prefer(c.value));
  if (preferredScan) return preferredScan.value;

  const lastFence = fences[fences.length - 1];
  if (lastFence) return lastFence.value;
  // Largest object found by the scan (the answer is usually the biggest block).
  let best: Candidate | undefined;
  for (const c of scanned) if (!best || c.length >= best.length) best = c;
  return best?.value;
}
