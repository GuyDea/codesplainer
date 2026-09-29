/**
 * Small pure helpers used by the panels (and handy for the app shell): activity icons, time and
 * usage formatting, scope labels, file-type icons, clipboard.
 */
import {
  Brain,
  CircleDot,
  CircleX,
  CodeXml,
  Crosshair,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FilePen,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FolderOpen,
  Globe,
  MessageSquare,
  MessagesSquare,
  Search,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  truncate,
  type ActivityItem,
  type ActivityKind,
  type CodeRef,
  type GraphEntry,
  type Usage,
} from '@codesplainer/shared';
import type { AskScope } from './types';

// ---- activity -------------------------------------------------------------------------------

export type ActivityCategory =
  | 'status'
  | 'read'
  | 'list'
  | 'search'
  | 'run'
  | 'edit'
  | 'web'
  | 'tool'
  | 'message'
  | 'thinking'
  | 'warning'
  | 'error';

export const ACTIVITY_VISUALS: Record<
  ActivityCategory,
  { icon: LucideIcon; label: string; className: string }
> = {
  status: { icon: CircleDot, label: 'Status', className: 'text-subtle' },
  read: { icon: FileText, label: 'Read', className: 'text-muted' },
  list: { icon: FolderOpen, label: 'List', className: 'text-muted' },
  search: { icon: Search, label: 'Search', className: 'text-muted' },
  run: { icon: SquareTerminal, label: 'Run', className: 'text-muted' },
  edit: { icon: FilePen, label: 'Edit', className: 'text-muted' },
  web: { icon: Globe, label: 'Web', className: 'text-muted' },
  tool: { icon: Wrench, label: 'Tool', className: 'text-muted' },
  message: { icon: MessageSquare, label: 'Message', className: 'text-accent' },
  thinking: { icon: Brain, label: 'Thinking', className: 'text-subtle' },
  warning: { icon: TriangleAlert, label: 'Warning', className: 'text-warn' },
  error: { icon: CircleX, label: 'Error', className: 'text-danger' },
};

const TOOL_PATTERNS: [ActivityCategory, RegExp][] = [
  ['edit', /\b(write|wrote|writing|edit|edited|editing|patch|create|created|modify|replace)\b/],
  ['search', /\b(grep|rg|ripgrep|search|searching|searched|find|glob|lookup|codebase search)\b/],
  ['list', /\b(ls|list|listing|listed|tree|readdir|directory|dir)\b/],
  ['read', /\b(read|reading|open|opened|view|viewing|cat|head|tail|file)\b/],
  ['web', /\b(web|fetch|http|https|url|browse|curl)\b/],
  ['run', /\b(bash|shell|exec|execute|executing|run|running|command|cmd|npm|pnpm|yarn|make|sh)\b/],
];

/** Classify an activity item (tool items are classified by their text). */
export function activityCategory(kind: ActivityKind, text: string): ActivityCategory {
  if (kind !== 'tool') return kind;
  const normalized = text.toLowerCase().replace(/[_\-./:]+/g, ' ');
  for (const [category, pattern] of TOOL_PATTERNS) {
    if (pattern.test(normalized)) return category;
  }
  return 'tool';
}

/** Icon for an activity item: read / search / run / message / thinking / warning ... */
export function activityIcon(kind: ActivityKind, text: string): LucideIcon {
  return ACTIVITY_VISUALS[activityCategory(kind, text)].icon;
}

/** Unique paths touched by the agent, in first-seen order. */
export function touchedPaths(items: ActivityItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) if (item.path) seen.add(item.path);
  return [...seen];
}

/** React keys that stay stable while an append-only (front-trimmed) activity list grows. */
export function activityKeys(items: ActivityItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.ts}|${item.kind}|${item.text.slice(0, 48)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

/** Last one or two segments of a path, for compact chips ("…/src/api.ts"). */
export function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/') || path;
  return `…/${parts.slice(-2).join('/')}`;
}

// ---- time / usage ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time "HH:MM:SS" of an ISO timestamp ('' when invalid). */
export function formatClock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Stopwatch style elapsed time: "0:07", "12:30", "1:02:03". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** "$0.12", "<$0.01", "$1.50". */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '';
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Compact count: 950, 12.3k, 1.2M. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Generation time of a diagram (usage duration, else completed - started). */
export function graphDurationMs(entry: GraphEntry): number | undefined {
  if (entry.usage?.durationMs !== undefined) return entry.usage.durationMs;
  if (!entry.startedAt || !entry.completedAt) return undefined;
  const ms = Date.parse(entry.completedAt) - Date.parse(entry.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** Total tokens (input + output), undefined when unknown. */
export function totalTokens(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined;
  const { inputTokens, outputTokens } = usage;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

// ---- refs / scopes --------------------------------------------------------------------------

/** Last path segment ('' stays ''). */
export function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/** Directory part of a posix path ('' for top-level entries). */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

/** "12", "12–40" or '' for a ref. */
export function lineRangeLabel(ref: Pick<CodeRef, 'startLine' | 'endLine'>): string {
  if (ref.startLine === undefined) return '';
  if (ref.endLine === undefined || ref.endLine === ref.startLine) return String(ref.startLine);
  return `${ref.startLine}–${ref.endLine}`;
}

/** "api.ts:12–40" style short label for a ref. */
export function shortRefLabel(ref: CodeRef): string {
  const name = fileName(ref.path) || ref.folder || '.';
  const lines = lineRangeLabel(ref);
  return lines ? `${name}:${lines}` : name;
}

/** Stable identity of a scope (for comparing / keys). */
export function scopeKey(scope: AskScope): string {
  switch (scope.type) {
    case 'new':
      return 'new';
    case 'graph':
      return `graph:${scope.graphId}`;
    case 'node':
      return `node:${scope.graphId}:${scope.nodeId}`;
    case 'code':
      return `code:${scope.ref.folder ?? ''}:${scope.ref.path}:${scope.ref.startLine ?? ''}:${scope.ref.endLine ?? ''}`;
  }
}

export const SCOPE_ICONS: Record<AskScope['type'], LucideIcon> = {
  new: MessageSquare,
  graph: MessagesSquare,
  node: Crosshair,
  code: CodeXml,
};

/** Menu label of a scope ("This diagram: Request flow"). */
export function scopeLabel(scope: AskScope, max = 40): string {
  switch (scope.type) {
    case 'new':
      return 'New question';
    case 'graph':
      return `This diagram: ${truncate(scope.title, max)}`;
    case 'node':
      return `Box: ${truncate(scope.nodeLabel, max)}`;
    case 'code':
      return `Code: ${shortRefLabel(scope.ref)}`;
  }
}

/** Compact chip label of a scope ("This diagram", "Box: API"). */
export function scopeChipLabel(scope: AskScope): string {
  switch (scope.type) {
    case 'new':
      return 'New question';
    case 'graph':
      return 'This diagram';
    case 'node':
      return truncate(scope.nodeLabel, 24);
    case 'code':
      return shortRefLabel(scope.ref);
  }
}

/** Default input placeholder for a scope. */
export function scopePlaceholder(scope: AskScope): string {
  switch (scope.type) {
    case 'new':
      return 'Ask anything about this codebase…';
    case 'graph':
      return 'Ask a follow-up about this diagram…';
    case 'node':
      return `Ask about “${truncate(scope.nodeLabel, 40)}”…`;
    case 'code':
      return 'Ask about these lines…';
  }
}

// ---- files ----------------------------------------------------------------------------------

const CODE_EXT = new Set(
  (
    'ts tsx js jsx mjs cjs mts cts py rb go rs java kt kts scala swift c h cc cpp cxx hpp hh cs fs ' +
    'php lua dart ex exs erl hs clj cljs elm ml mli r jl pl zig nim vue svelte astro html htm css ' +
    'scss sass less sql graphql gql proto wasm wat sol vb groovy gradle tf hcl'
  ).split(' '),
);
const DATA_EXT = new Set('json jsonc json5 yaml yml toml xml csv tsv ini plist lock'.split(' '));
const TEXT_EXT = new Set('md mdx markdown txt rst adoc org tex log'.split(' '));
const IMAGE_EXT = new Set('png jpg jpeg gif webp svg ico bmp avif tiff'.split(' '));
const ARCHIVE_EXT = new Set('zip tar gz tgz bz2 xz 7z rar jar war'.split(' '));
const SHELL_EXT = new Set('sh bash zsh fish ps1 bat cmd'.split(' '));
const CONFIG_NAMES =
  /^(\.env.*|\.editorconfig|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.prettierrc.*|\.eslintrc.*|dockerfile|makefile|procfile|.*\.config\.[a-z]+|.*rc)$/i;
const LOCK_NAMES = /(\.lock|-lock\.json|\.lockb)$/i;

/** File-type icon from the file name. */
export function fileIcon(name: string): LucideIcon {
  const lower = name.toLowerCase();
  if (LOCK_NAMES.test(lower)) return FileLock;
  const dot = lower.lastIndexOf('.');
  const ext = dot > 0 ? lower.slice(dot + 1) : '';
  if (IMAGE_EXT.has(ext)) return FileImage;
  if (ARCHIVE_EXT.has(ext)) return FileArchive;
  if (SHELL_EXT.has(ext)) return FileTerminal;
  if (ext === 'csv' || ext === 'tsv' || ext === 'xlsx') return FileSpreadsheet;
  if (CONFIG_NAMES.test(lower) && !CODE_EXT.has(ext)) return FileCog;
  if (DATA_EXT.has(ext)) return FileBraces;
  if (TEXT_EXT.has(ext)) return FileText;
  if (CODE_EXT.has(ext) || CONFIG_NAMES.test(lower)) return FileCode;
  return File;
}

// ---- status dots (usable as Menu item icons) -------------------------------------------------

function dotIcon(name: string, className: string): LucideIcon {
  return createLucideIcon(name, [
    ['circle', { cx: '12', cy: '12', r: '4.5', className, stroke: 'none', key: 'dot' }],
  ]);
}

/** Filled status dots, colored with design tokens. */
export const DotOk: LucideIcon = dotIcon('status-dot-ok', 'fill-ok');
export const DotWarn: LucideIcon = dotIcon('status-dot-warn', 'fill-warn');
export const DotOff: LucideIcon = dotIcon('status-dot-off', 'fill-subtle');

// ---- keyboard -------------------------------------------------------------------------------

/** "⌘" on Apple platforms, "Ctrl" elsewhere (for shortcut hints). */
export function modKeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

// ---- clipboard ------------------------------------------------------------------------------

/** Copy text to the clipboard; resolves false when not permitted. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
