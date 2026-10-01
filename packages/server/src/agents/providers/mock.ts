/**
 * Offline demo provider (no AI). Builds believable diagrams from the real file tree:
 * - question: top-level modules of the workspace folders, edges from import statements
 * - expand:   a directory → its parts; a file → its symbols (with line ranges); a line range → steps
 * - ask-*:    a short flow derived from the parent box / diagram / selected code
 * Every step emits an activity item and waits CODESPLAINER_MOCK_DELAY_MS (default 250 ms).
 */
import { stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import {
  APP_VERSION,
  DETAIL_LEVEL_INFO,
  PROVIDER_LABELS,
  findNode,
  neighbours,
  slugify,
  toPosixPath,
  type CodeRef,
  type EdgeKind,
  type GraphKind,
  type GraphNode,
  type NodeKind,
} from '@codesplainer/shared';
import type { ProviderContext, ProviderFactory } from '../context';
import {
  AgentError,
  type AgentRunRequest,
  type AgentRunResult,
  type DetectedProvider,
} from '../types';
import { clip, sleep, type FolderRef } from '../util';
import {
  NOTABLE_FILES,
  findSymbols,
  isSource,
  importSites,
  languageOf,
  listEntries,
  pathHits,
  readText,
  resolveRelative,
  specifierNames,
  walkFiles,
  type Lang,
  type SymbolInfo,
} from './mock-scan';

// ---- raw output shape (same as GRAPH_OUTPUT_SCHEMA) -------------------------------------------

interface RawRef {
  folder: string | null;
  path: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
}
interface RawNode {
  id: string;
  label: string;
  kind: NodeKind;
  detail: string;
  group: string | null;
  expandable: boolean;
  highlight: boolean;
  refs: RawRef[];
}
interface RawEdge {
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
  step: number | null;
  refs: RawRef[];
}
interface RawSpec {
  title: string;
  summary: string;
  kind: GraphKind;
  direction: 'LR' | 'TB';
  nodes: RawNode[];
  edges: RawEdge[];
  groups: { id: string; label: string }[];
}

type NodeInput = Partial<Omit<RawNode, 'label' | 'kind'>> & { label: string; kind: NodeKind };

class Draft {
  readonly nodes: RawNode[] = [];
  readonly edges: RawEdge[] = [];
  readonly groups: { id: string; label: string }[] = [];
  private readonly ids = new Set<string>();

  node(input: NodeInput): string {
    const base = slugify(input.id ?? input.label, 'node');
    let id = base;
    let n = 2;
    while (this.ids.has(id)) id = `${base}-${n++}`;
    this.ids.add(id);
    this.nodes.push({
      id,
      label: clip(input.label, 40),
      kind: input.kind,
      detail: clip(input.detail ?? '', 80),
      group: input.group ?? null,
      expandable: input.expandable ?? false,
      highlight: input.highlight ?? false,
      refs: input.refs ?? [],
    });
    return id;
  }

  edge(
    from: string,
    to: string,
    label: string,
    kind: EdgeKind,
    step: number | null = null,
    refs: RawRef[] = [],
  ): void {
    if (from === to || this.edges.some((e) => e.from === from && e.to === to)) return;
    this.edges.push({ from, to, label, kind, step, refs });
  }

  highlight(ids: string[]): void {
    for (const n of this.nodes) n.highlight = ids.includes(n.id);
  }

  spec(meta: Omit<RawSpec, 'nodes' | 'edges' | 'groups'>): RawSpec {
    return { ...meta, nodes: this.nodes, edges: this.edges, groups: this.groups };
  }
}

const ref = (
  folder: FolderRef,
  path: string,
  startLine?: number,
  endLine?: number,
  symbol?: string,
): RawRef => ({
  folder: folder.alias,
  path,
  startLine: startLine ?? null,
  endLine: endLine ?? startLine ?? null,
  symbol: symbol ?? null,
});

function words(text: string, max: number): string {
  const parts = text.replace(/\s+/g, ' ').trim().split(' ');
  return parts.slice(0, max).join(' ') + (parts.length > max ? '…' : '');
}

const LANGUAGE_NAMES: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
};

const CONTAINER_DIRS = new Set([
  'src',
  'packages',
  'apps',
  'services',
  'libs',
  'lib',
  'crates',
  'cmd',
  'internal',
  'modules',
  'pkg',
  'projects',
  'app',
]);

// ---- scanning context -----------------------------------------------------------------------

interface Scan {
  req: AgentRunRequest;
  folders: FolderRef[];
  delayMs: number;
  step(text: string, path?: string): Promise<void>;
  check(): void;
}

function makeScan(req: AgentRunRequest): Scan {
  const raw = Number(process.env.CODESPLAINER_MOCK_DELAY_MS ?? 250);
  const delayMs = Number.isFinite(raw) && raw >= 0 ? raw : 250;
  const check = () => {
    if (req.signal.aborted) throw new AgentError('cancelled', 'Cancelled.');
  };
  return {
    req,
    folders: req.folders,
    delayMs,
    check,
    async step(text, path) {
      check();
      req.onActivity({ kind: 'tool', text, ...(path ? { path } : {}) });
      if (delayMs > 0) await sleep(delayMs, req.signal);
    },
  };
}

// ---- items (modules / files) ------------------------------------------------------------------

interface Item {
  label: string;
  kind: NodeKind;
  folder: FolderRef;
  rel: string;
  abs: string;
  isDir: boolean;
  weight: number;
  names: string[];
  detail: string;
}

async function dirStats(
  abs: string,
): Promise<{ files: number; language?: string; truncated: boolean }> {
  const files = await walkFiles(abs, { limit: 2000, maxDirs: 300 });
  const counts = new Map<string, number>();
  for (const f of files) {
    const lang = LANGUAGE_NAMES[extname(f).toLowerCase()];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const language = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { files: files.length, language, truncated: files.length >= 2000 };
}

async function packageName(dirAbs: string): Promise<string | undefined> {
  const text = await readText(join(dirAbs, 'package.json'), 64 * 1024);
  if (!text) return undefined;
  try {
    const json = JSON.parse(text) as { name?: unknown };
    return typeof json.name === 'string' ? json.name : undefined;
  } catch {
    return undefined;
  }
}

/** Parts of one directory level (unwrapping thin wrapper levels such as a lone src/). */
async function levelItems(
  scan: Scan,
  folder: FolderRef,
  dirAbs: string,
  max: number,
  unwrap: boolean,
): Promise<{ items: Item[]; hidden: number }> {
  let entries = await listEntries(dirAbs, folder.path);
  for (let depth = 0; unwrap && depth < 2; depth++) {
    const dirs = entries.filter((e) => e.isDir);
    const sources = entries.filter((e) => !e.isDir && isSource(e.name));
    if (sources.length > 1) break;
    const candidates =
      dirs.length === 1
        ? dirs
        : dirs.length <= 3
          ? dirs.filter((d) => CONTAINER_DIRS.has(d.name))
          : [];
    let unwrapped = false;
    for (const target of candidates) {
      const inner = await listEntries(target.abs, folder.path);
      if (inner.filter((e) => e.isDir || isSource(e.name)).length < 2) continue;
      await scan.step(`Listing ${target.rel}`, target.abs);
      entries = [...entries.filter((e) => e !== target), ...inner];
      unwrapped = true;
      break;
    }
    if (!unwrapped) break;
  }

  const dirItems: Item[] = [];
  for (const e of entries.filter((x) => x.isDir)) {
    scan.check();
    const stats = await dirStats(e.abs);
    if (stats.files === 0) continue;
    const pkg = await packageName(e.abs);
    dirItems.push({
      label: `${e.name}/`,
      kind: 'module',
      folder,
      rel: e.rel,
      abs: e.abs,
      isDir: true,
      weight: stats.files,
      names: [e.name.toLowerCase(), ...(pkg ? [pkg.toLowerCase()] : [])],
      detail: `${stats.files}${stats.truncated ? '+' : ''} ${stats.language ? `${stats.language} ` : ''}files`,
    });
  }
  const fileItems: Item[] = entries
    .filter((e) => !e.isDir && isSource(e.name))
    .map((e) => ({
      label: e.name,
      kind: 'file' as NodeKind,
      folder,
      rel: e.rel,
      abs: e.abs,
      isDir: false,
      weight: e.size,
      names: [basename(e.name, extname(e.name)).toLowerCase()],
      detail: /^(index|main|app|server|cli|__main__)\./i.test(e.name) ? 'Entry point' : '',
    }));
  const configItems: Item[] = entries
    .filter((e) => !e.isDir && NOTABLE_FILES[e.name.toLowerCase()])
    .map((e) => ({
      label: e.name,
      kind: 'config' as NodeKind,
      folder,
      rel: e.rel,
      abs: e.abs,
      isDir: false,
      weight: 0,
      names: [],
      detail: NOTABLE_FILES[e.name.toLowerCase()] ?? '',
    }));

  dirItems.sort((a, b) => b.weight - a.weight);
  fileItems.sort((a, b) => b.weight - a.weight);
  const selected: Item[] = dirItems.slice(0, max);
  if (selected.length < max) selected.push(...fileItems.slice(0, max - selected.length));
  const room = max - selected.length;
  if (room > 0 && selected.length < 5) selected.push(...configItems.slice(0, Math.min(room, 1)));
  const total = dirItems.length + fileItems.length;
  const shown = selected.filter((i) => i.kind !== 'config').length;
  selected.sort((a, b) => a.rel.localeCompare(b.rel));
  return { items: selected, hidden: Math.max(0, total - shown) };
}

/** Imports from one item into another: how many, and where the first one is. */
interface ImportLink {
  count: number;
  site: RawRef;
}

/** Import statements between items. Key "i>j" → link. */
async function importEdges(
  scan: Scan,
  items: Item[],
  budget = 300,
): Promise<Map<string, ImportLink>> {
  const links = new Map<string, ImportLink>();
  let scanned = 0;
  let announced = 0;
  const perItem = Math.max(10, Math.floor(budget / Math.max(1, items.length)));
  for (let i = 0; i < items.length && scanned < budget; i++) {
    const item = items[i] as Item;
    if (item.kind === 'config') continue;
    const files = item.isDir
      ? await walkFiles(item.abs, { limit: perItem, filter: isSource, maxDirs: 100 })
      : isSource(item.abs)
        ? [item.abs]
        : [];
    for (const file of files) {
      if (scanned >= budget) break;
      scanned++;
      scan.check();
      if (announced < 2) {
        announced++;
        await scan.step(`Reading ${toPosixPath(relative(item.folder.path, file))}`, file);
      }
      const lang = languageOf(file);
      if (!lang) continue;
      const text = await readText(file, 64 * 1024);
      for (const site of importSites(text, lang)) {
        if (site.spec.startsWith('node:')) continue;
        const target = resolveTarget(site.spec, file, lang, items);
        if (target === undefined || target === i) continue;
        const key = `${i}>${target}`;
        const link = links.get(key);
        if (link) link.count++;
        else {
          const rel = toPosixPath(relative(item.folder.path, file));
          links.set(key, { count: 1, site: ref(item.folder, rel, site.startLine, site.endLine) });
        }
      }
    }
  }
  if (scanned > 2) await scan.step(`Scanning imports in ${scanned} files`);
  return links;
}

function resolveTarget(spec: string, file: string, lang: Lang, items: Item[]): number | undefined {
  const rel = resolveRelative(spec, file, lang);
  if (rel) {
    const idx = items.findIndex((it) => it.kind !== 'config' && pathHits(rel, it.abs, it.isDir));
    return idx >= 0 ? idx : undefined;
  }
  const names = specifierNames(spec, lang);
  const idx = items.findIndex((it) => it.names.some((n) => names.includes(n)));
  return idx >= 0 ? idx : undefined;
}

function itemNodes(draft: Draft, items: Item[], group?: (item: Item) => string | null): string[] {
  return items.map((it) =>
    draft.node({
      id: it.label.replace(/\/$/, ''),
      label: it.label,
      kind: it.kind,
      detail: it.detail,
      group: group?.(it) ?? null,
      expandable: it.kind !== 'config',
      refs: [ref(it.folder, it.rel)],
    }),
  );
}

function addImportEdges(
  draft: Draft,
  ids: string[],
  links: Map<string, ImportLink>,
  maxEdges: number,
): Map<string, number> {
  const degree = new Map<string, number>();
  const sorted = [...links.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, maxEdges);
  for (const [key, link] of sorted) {
    const [a, b] = key.split('>').map(Number);
    const from = ids[a as number];
    const to = ids[b as number];
    if (!from || !to) continue;
    draft.edge(from, to, 'imports', 'dependency', null, [link.site]);
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 2); // being imported matters more
  }
  return degree;
}

function topIds(draft: Draft, degree: Map<string, number>, count: number): string[] {
  const ranked = draft.nodes
    .filter((n) => n.kind !== 'config' && n.kind !== 'external' && n.kind !== 'actor')
    .map((n, i) => ({ id: n.id, score: degree.get(n.id) ?? 0, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const best = ranked.filter((r) => r.score > 0).slice(0, count);
  return (best.length ? best : ranked.slice(0, 1)).map((r) => r.id);
}

function labelOf(draft: Draft, id: string | undefined): string {
  return draft.nodes.find((n) => n.id === id)?.label ?? '';
}

// ---- diagrams -------------------------------------------------------------------------------

async function overviewDiagram(scan: Scan, max: number, workspaceName: string): Promise<RawSpec> {
  const draft = new Draft();
  const folders = scan.folders;
  let items: Item[] = [];
  let hidden = 0;
  if (folders.length === 1) {
    const folder = folders[0] as FolderRef;
    await scan.step(`Listing ${folder.alias}`, folder.path);
    ({ items, hidden } = await levelItems(scan, folder, folder.path, max, true));
  } else {
    const per = Math.floor(max / folders.length);
    if (per >= 2 && folders.length <= 4) {
      for (const folder of folders) {
        await scan.step(`Listing ${folder.alias}`, folder.path);
        const level = await levelItems(scan, folder, folder.path, per, true);
        items.push(...level.items);
        hidden += level.hidden;
        draft.groups.push({ id: slugify(folder.alias, 'folder'), label: clip(folder.alias, 40) });
      }
    } else {
      for (const folder of folders.slice(0, max)) {
        await scan.step(`Listing ${folder.alias}`, folder.path);
        const stats = await dirStats(folder.path);
        const pkg = await packageName(folder.path);
        items.push({
          label: folder.alias,
          kind: 'module',
          folder,
          rel: '',
          abs: folder.path,
          isDir: true,
          weight: stats.files,
          names: [
            folder.alias.toLowerCase(),
            basename(folder.path).toLowerCase(),
            ...(pkg ? [pkg.toLowerCase()] : []),
          ],
          detail: `${stats.files}${stats.truncated ? '+' : ''} ${stats.language ? `${stats.language} ` : ''}files`,
        });
      }
    }
  }
  if (!items.length)
    return genericFlow(scan, workspaceName, 'The folders contain no source files.');
  const grouped = draft.groups.length > 0;
  const ids = itemNodes(
    draft,
    items,
    grouped ? (it) => slugify(it.folder.alias, 'folder') : undefined,
  );
  const degree = addImportEdges(
    draft,
    ids,
    await importEdges(scan, items),
    Math.max(6, ids.length * 2),
  );
  const top = topIds(draft, degree, 2);
  draft.highlight(top);
  await scan.step('Drawing diagram');
  const main = labelOf(draft, top[0]);
  const more = hidden > 0 ? ` ${hidden} smaller part${hidden === 1 ? '' : 's'} not shown.` : '';
  return draft.spec({
    title: words(`${workspaceName} overview`, 6),
    summary:
      `Demo diagram built from folders and imports, no AI. ${main ? `${main} is the most connected part.` : ''}${more}`.trim(),
    kind: 'architecture',
    direction: 'LR',
  });
}

async function dirDiagram(
  scan: Scan,
  folder: FolderRef,
  rel: string,
  abs: string,
  box: string,
  max: number,
  boundary?: string,
): Promise<RawSpec> {
  const draft = new Draft();
  await scan.step(`Listing ${rel || folder.alias}`, abs);
  const { items, hidden } = await levelItems(
    scan,
    folder,
    abs,
    Math.max(2, max - (boundary ? 1 : 0)),
    false,
  );
  if (!items.length) return genericFlow(scan, box, `${box} contains no source files.`);
  const ids = itemNodes(draft, items);
  const degree = addImportEdges(
    draft,
    ids,
    await importEdges(scan, items, 150),
    Math.max(6, ids.length * 2),
  );
  const top = topIds(draft, degree, 2);
  draft.highlight(top);
  if (boundary && top[0]) {
    const b = draft.node({
      label: boundary,
      kind: 'external',
      detail: 'Caller in the parent diagram',
    });
    draft.edge(b, top[0], 'uses', 'call');
  }
  await scan.step('Drawing diagram');
  const main = labelOf(draft, top[0]);
  return draft.spec({
    title: words(`Inside ${box}`, 6),
    summary: `Demo (no AI): the parts of ${box} and their imports.${main ? ` ${main} is the most connected.` : ''}${hidden ? ` ${hidden} more not shown.` : ''}`,
    kind: 'architecture',
    direction: 'LR',
  });
}

function symbolDetail(s: SymbolInfo): string {
  const what = s.kind === 'function' ? 'function' : s.kind === 'class' ? 'class' : 'type';
  const lines = s.endLine - s.startLine + 1;
  return `${s.exported ? 'Exported ' : ''}${what}, ${lines} line${lines === 1 ? '' : 's'}`;
}

function symbolDiagram(
  folder: FolderRef,
  rel: string,
  text: string,
  symbols: SymbolInfo[],
  max: number,
  title: string,
  summary: string,
): RawSpec {
  const draft = new Draft();
  const chosen = [...symbols]
    .sort(
      (a, b) =>
        Number(b.exported) - Number(a.exported) ||
        b.endLine - b.startLine - (a.endLine - a.startLine),
    )
    .slice(0, max)
    .sort((a, b) => a.startLine - b.startLine);
  const ids = chosen.map((s) =>
    draft.node({
      id: s.name,
      label: s.name,
      kind: s.kind === 'function' ? 'function' : s.kind === 'class' ? 'class' : 'data',
      detail: symbolDetail(s),
      expandable: s.kind !== 'data' && s.endLine - s.startLine >= 3,
      refs: [ref(folder, rel, s.startLine, s.endLine, s.name)],
    }),
  );
  const lines = text.split(/\r?\n/);
  const degree = new Map<string, number>();
  chosen.forEach((a, i) => {
    // The body without the declaration line: body[k] is file line a.startLine + 1 + k.
    const body = lines.slice(a.startLine, a.endLine);
    chosen.forEach((b, j) => {
      if (i === j || b.name.length < 3) return;
      const mention = new RegExp(`\\b${b.name.replace(/[$]/g, '\\$')}\\b`);
      const at = body.findIndex((line) => mention.test(line));
      if (at >= 0) {
        const from = ids[i] as string;
        const to = ids[j] as string;
        const line = a.startLine + 1 + at;
        draft.edge(
          from,
          to,
          b.kind === 'function' ? 'calls' : 'uses',
          b.kind === 'function' ? 'call' : 'dependency',
          null,
          [ref(folder, rel, line, line, b.name)],
        );
        degree.set(from, (degree.get(from) ?? 0) + 1);
        degree.set(to, (degree.get(to) ?? 0) + 1);
      }
    });
  });
  const top = topIds(draft, degree, 2);
  draft.highlight(top);
  const allTypes = chosen.every((s) => s.kind !== 'function');
  return draft.spec({
    title: words(title, 6),
    summary,
    kind: allTypes ? 'structure' : 'architecture',
    direction: allTypes ? 'TB' : 'LR',
  });
}

async function fileDiagram(
  scan: Scan,
  folder: FolderRef,
  rel: string,
  abs: string,
  box: string,
  max: number,
): Promise<RawSpec> {
  await scan.step(`Reading ${rel}`, abs);
  const text = await readText(abs);
  const lang = languageOf(abs);
  const symbols = lang ? findSymbols(text, lang) : [];
  if (symbols.length < 2) {
    const total = Math.max(1, text.split(/\r?\n/).length);
    return rangeFlow(scan, folder, rel, text, 1, Math.min(total, 120), box, max);
  }
  await scan.step(`Finding symbols in ${basename(rel)}`);
  const name = basename(rel);
  return symbolDiagram(
    folder,
    rel,
    text,
    symbols,
    max,
    `Inside ${name}`,
    `Demo (no AI): the main symbols of ${name}, linked where one mentions another.`,
  );
}

interface Statement {
  line: number;
  label: string;
  kind: NodeKind;
  code: string;
}

function statementOf(code: string, line: number): Statement | undefined {
  const t = code.trim();
  if (!t || /^(\/\/|#|\/\*|\*|--|}|\)|]|{)/.test(t)) return undefined;
  const firstIdent = (s: string) => s.match(/[A-Za-z_$][\w$]*/)?.[0];
  let m: RegExpMatchArray | null;
  if (
    (m = t.match(/^(?:}\s*)?(?:else\s+if|elif|if|switch|match|case|when)\b\s*\(?\s*!?\s*(.*)$/))
  ) {
    const what = firstIdent(m[1] ?? '') ?? 'condition';
    return { line, label: `Check ${what}`, kind: 'decision', code: t };
  }
  if ((m = t.match(/^(?:for|while|foreach|loop)\b\s*\(?\s*(?:const|let|var)?\s*(.*)$/))) {
    return { line, label: `Loop ${firstIdent(m[1] ?? '') ?? 'items'}`, kind: 'step', code: t };
  }
  if (/^return\b/.test(t)) return { line, label: 'Return result', kind: 'step', code: t };
  if (/^(?:throw|raise)\b/.test(t)) return { line, label: 'Raise error', kind: 'step', code: t };
  if ((m = t.match(/^(?:await\s+|yield\s+)?([A-Za-z_$][\w$.]*)\s*\(/))) {
    const name = (m[1] ?? '').split('.').pop() ?? '';
    if (name && !['function', 'if', 'for', 'while', 'switch', 'catch'].includes(name)) {
      return { line, label: `Call ${name}`, kind: 'step', code: t };
    }
  }
  if (
    (m = t.match(
      /^(?:const|let|var|val|auto)?\s*([A-Za-z_$][\w$]*)\s*(?::[^=]+)?\s*:?=\s*(?:await\s+)?(?:new\s+)?([A-Za-z_$][\w$.]*)?/,
    ))
  ) {
    const target = m[1] ?? '';
    const call = (m[2] ?? '').split('.').pop();
    if (target && !['return'].includes(target)) {
      return {
        line,
        label: call && /\(/.test(t) ? `Call ${call}` : `Set ${target}`,
        kind: 'step',
        code: t,
      };
    }
  }
  return undefined;
}

async function rangeFlow(
  scan: Scan,
  folder: FolderRef,
  rel: string,
  text: string,
  start: number,
  end: number,
  box: string,
  max: number,
): Promise<RawSpec> {
  await scan.step(`Reading ${rel}:${start}-${end}`);
  const lines = text.split(/\r?\n/);
  const last = Math.min(end, lines.length);
  const found: Statement[] = [];
  for (let n = start; n <= last; n++) {
    const s = statementOf(lines[n - 1] ?? '', n);
    if (s && found[found.length - 1]?.label !== s.label) found.push(s);
  }
  let chosen: Statement[];
  if (found.length > max) {
    // Keep the first and last, sample evenly in between.
    chosen = Array.from(
      { length: max },
      (_, i) => found[Math.round((i * (found.length - 1)) / (max - 1))] as Statement,
    );
  } else {
    chosen = found;
  }
  const draft = new Draft();
  if (chosen.length < 2) {
    const size = Math.max(1, Math.ceil((last - start + 1) / 3));
    for (let a = start, i = 1; a <= last && i <= 3; a += size, i++) {
      const b = Math.min(last, a + size - 1);
      draft.node({
        label: `Part ${i}`,
        kind: 'step',
        detail: `Lines ${a}-${b}`,
        refs: [ref(folder, rel, a, b)],
      });
    }
  } else {
    chosen.forEach((s, i) => {
      const next = chosen[i + 1];
      const until = next ? Math.max(s.line, next.line - 1) : last;
      draft.node({
        label: s.label,
        kind: s.kind,
        detail: words(s.code.replace(/[{};]+\s*$/, ''), 8),
        refs: [ref(folder, rel, s.line, Math.min(until, s.line + 30))],
      });
    });
  }
  draft.nodes.forEach((n, i) => {
    const next = draft.nodes[i + 1];
    if (next) draft.edge(n.id, next.id, n.kind === 'decision' ? 'yes' : '', 'flow', i + 1);
  });
  draft.highlight(
    draft.nodes
      .filter((n) => n.kind === 'decision')
      .slice(0, 2)
      .map((n) => n.id),
  );
  if (!draft.nodes.some((n) => n.highlight) && draft.nodes[0]) draft.nodes[0].highlight = true;
  await scan.step('Drawing diagram');
  return draft.spec({
    title: words(`${box} step by step`, 6),
    summary: `Demo (no AI): the main statements of lines ${start}-${last}, in order.`,
    kind: 'flow',
    direction: 'TB',
  });
}

function genericFlow(scan: Scan, label: string, why?: string): RawSpec {
  scan.check();
  const draft = new Draft();
  const caller = draft.node({ label: 'Caller', kind: 'actor' });
  const input = draft.node({ label: 'Receive input', kind: 'step' });
  const core = draft.node({
    label,
    kind: 'step',
    highlight: true,
    detail: 'No code location known',
  });
  const out = draft.node({ label: 'Return result', kind: 'step' });
  draft.edge(caller, input, 'calls', 'flow', 1);
  draft.edge(input, core, '', 'flow', 2);
  draft.edge(core, out, '', 'flow', 3);
  return draft.spec({
    title: words(`${label} (sketch)`, 6),
    summary: `Demo (no AI): ${why ?? `"${label}" has no code location, so this is a generic sketch.`}`,
    kind: 'flow',
    direction: 'TB',
  });
}

// ---- refs → files ---------------------------------------------------------------------------

interface Target {
  folder: FolderRef;
  rel: string;
  abs: string;
  isDir: boolean;
  ref: CodeRef;
}

async function resolveRef(r: CodeRef, folders: FolderRef[]): Promise<Target | undefined> {
  const folder = folders.find((f) => f.alias === r.folder) ?? folders[0];
  if (!folder) return undefined;
  const abs = isAbsolute(r.path) ? r.path : join(folder.path, r.path);
  const rel = toPosixPath(relative(folder.path, abs));
  if (rel.startsWith('..')) return undefined;
  const s = await stat(abs).catch(() => undefined);
  if (!s) return undefined;
  return { folder, rel, abs, isDir: s.isDirectory(), ref: r };
}

async function firstTarget(refs: CodeRef[], folders: FolderRef[]): Promise<Target | undefined> {
  for (const r of refs) {
    const t = await resolveRef(r, folders);
    if (t) return t;
  }
  return undefined;
}

async function explainBox(
  scan: Scan,
  node: GraphNode | undefined,
  fallback: string,
  max: number,
  boundary?: string,
): Promise<RawSpec> {
  const label = node?.label ?? fallback;
  const target = node ? await firstTarget(node.refs, scan.folders) : undefined;
  if (!target) return genericFlow(scan, label);
  if (target.isDir)
    return dirDiagram(scan, target.folder, target.rel, target.abs, label, max, boundary);
  if (target.ref.startLine !== undefined) {
    const text = await readText(target.abs);
    const end = target.ref.endLine ?? target.ref.startLine + 40;
    return rangeFlow(scan, target.folder, target.rel, text, target.ref.startLine, end, label, max);
  }
  return fileDiagram(scan, target.folder, target.rel, target.abs, label, max);
}

/** A short flow: You → box → a few of its parts. */
async function askAboutBox(
  scan: Scan,
  node: GraphNode | undefined,
  fallback: string,
  question: string,
  max: number,
): Promise<RawSpec> {
  const inner = await explainBox(scan, node, fallback, Math.max(2, Math.min(3, max - 2)));
  const draft = new Draft();
  const you = draft.node({ label: 'You', kind: 'actor' });
  const box = draft.node({
    label: node?.label ?? fallback,
    kind: node?.kind ?? 'component',
    detail: node?.detail ?? '',
    highlight: true,
    expandable: true,
    refs: (node?.refs ?? []).map((r) => ({
      folder: r.folder ?? null,
      path: r.path,
      startLine: r.startLine ?? null,
      endLine: r.endLine ?? null,
      symbol: r.symbol ?? null,
    })),
  });
  draft.edge(you, box, 'asks', 'flow', 1);
  let step = 2;
  for (const part of inner.nodes
    .filter((n) => n.kind !== 'actor' && n.kind !== 'external')
    .slice(0, Math.max(1, max - 2))) {
    const id = draft.node({ ...part, id: part.id, highlight: false });
    draft.edge(box, id, 'uses', 'flow', step++);
  }
  return draft.spec({
    title: words(question || `About ${node?.label ?? fallback}`, 6),
    summary: `Demo answer (no AI), sketched from the code of ${node?.label ?? fallback}.`,
    kind: 'flow',
    direction: 'LR',
  });
}

// ---- provider -------------------------------------------------------------------------------

export const createMockProvider: ProviderFactory = (_ctx: ProviderContext) => {
  async function detect(): Promise<DetectedProvider> {
    return {
      id: 'mock',
      name: PROVIDER_LABELS.mock,
      description: 'Offline demo built from the folder structure and imports. No AI involved.',
      available: true,
      version: APP_VERSION,
      warnings: [],
      models: [],
      capabilities: { fork: false, structuredOutput: false, cost: false, streaming: true },
      experimental: false,
    };
  }

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const started = Date.now();
    const scan = makeScan(req);
    if (req.purpose === 'test') {
      await scan.step('Answering the connectivity test');
      const output = { ok: true };
      return {
        output,
        rawText: JSON.stringify(output),
        usage: { durationMs: Date.now() - started },
        warnings: [],
      };
    }
    const { task } = req;
    const max = DETAIL_LEVEL_INFO[task.graph.detail].max;
    const origin = task.graph.origin;
    const parentSpec = task.parent?.spec;
    let output: RawSpec;
    switch (origin.type) {
      case 'question':
        output = await overviewDiagram(scan, max, task.workspace.name);
        break;
      case 'expand': {
        const node = findNode(parentSpec, origin.nodeId);
        const incoming =
          node && parentSpec ? neighbours(parentSpec, node.id).incoming[0] : undefined;
        const boundary = incoming ? findNode(parentSpec, incoming.from)?.label : undefined;
        output = await explainBox(scan, node, origin.nodeLabel || 'Box', max, boundary);
        break;
      }
      case 'ask-node':
        output = await askAboutBox(
          scan,
          findNode(parentSpec, origin.nodeId),
          origin.nodeLabel || 'Box',
          task.graph.question,
          max,
        );
        break;
      case 'ask-graph': {
        const focus = parentSpec?.nodes.find((n) => n.highlight) ?? parentSpec?.nodes[0];
        output = await askAboutBox(
          scan,
          focus,
          parentSpec?.title ?? 'Diagram',
          task.graph.question,
          max,
        );
        break;
      }
      case 'ask-code': {
        const target = await resolveRef(origin.ref, scan.folders);
        if (!target || target.isDir) {
          output = target
            ? await dirDiagram(
                scan,
                target.folder,
                target.rel,
                target.abs,
                basename(target.rel) || target.folder.alias,
                max,
              )
            : genericFlow(scan, basename(origin.ref.path) || 'Selection');
          break;
        }
        const text = await readText(target.abs);
        const start = origin.ref.startLine ?? 1;
        const end =
          origin.ref.endLine ?? (origin.ref.startLine ? start + 40 : text.split(/\r?\n/).length);
        const lang = languageOf(target.abs);
        const selected = text
          .split(/\r?\n/)
          .slice(start - 1, end)
          .join('\n');
        const symbols = lang
          ? findSymbols(selected, lang).map((s) => ({
              ...s,
              startLine: s.startLine + start - 1,
              endLine: s.endLine + start - 1,
            }))
          : [];
        const name = basename(target.rel);
        output =
          symbols.length >= 2
            ? symbolDiagram(
                target.folder,
                target.rel,
                text,
                symbols,
                max,
                `Selected code in ${name}`,
                `Demo (no AI): the symbols in the selected lines of ${name}.`,
              )
            : await rangeFlow(
                scan,
                target.folder,
                target.rel,
                text,
                start,
                end,
                words(task.graph.question, 3) || name,
                max,
              );
        break;
      }
    }
    const rawText = JSON.stringify(output);
    return { output, rawText, usage: { durationMs: Date.now() - started }, warnings: [] };
  }

  return { id: 'mock', detect, run };
};
