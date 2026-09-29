import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react';
import {
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderRoot,
  RefreshCw,
  Search,
  SearchX,
} from 'lucide-react';
import type { CodeRef, DirEntry, DirListing } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { ORIGIN_VISUALS } from '../graph/visuals';
import { EmptyState, IconButton, Input, Spinner, Tooltip } from '../ui';
import { dirName, fileIcon } from './helpers';
import { useTreeNav, type TreeNavRow } from './hooks';
import { Highlight, filterTerms } from './parts';
import type { FileExplorerProps } from './types';

const INDENT = 12;
const PAD = 6;
/** Directories with more ignored entries than this fold them behind a toggle row. */
const IGNORED_FOLD = 3;
const MAX_RESULTS = 200;
const ASK_ICON = ORIGIN_VISUALS['ask-code'].icon;

type Key = string;
const SEP = '\u0000';
const keyOf = (folder: string, path: string): Key => `${folder}${SEP}${path}`;

/** Keys of the folder root and every directory above `path` (excluding `path` itself). */
function ancestorKeys(folder: string, path: string): Key[] {
  const parts = path.split('/').filter(Boolean);
  const keys = [keyOf(folder, '')];
  for (let i = 1; i < parts.length; i++) keys.push(keyOf(folder, parts.slice(0, i).join('/')));
  return keys;
}

interface DirState {
  status: 'loading' | 'ready' | 'error';
  listing?: DirListing;
  error?: string;
}

type RowKind = 'root' | 'dir' | 'file' | 'loading' | 'error' | 'empty' | 'more' | 'ignored';

interface Row extends TreeNavRow {
  kind: RowKind;
  folder: string;
  /** Entry path (for info rows: the directory they belong to). */
  path: string;
  name: string;
  depth: number;
  ignored?: boolean;
  count?: number;
  /** Rows that take keyboard focus. */
  nav: boolean;
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) =>
    a.type !== b.type
      ? a.type === 'dir'
        ? -1
        : 1
      : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Lazy file tree of the workspace folders. Scrolls itself: give it a bounded height. State
 * (cache, expansion) resets when the workspace id changes.
 */
export function FileExplorer(props: FileExplorerProps) {
  return <Explorer key={props.workspace.id} {...props} />;
}

function Explorer({
  workspace,
  loadDir,
  onOpenFile,
  onAskAbout,
  activeRef,
  className,
}: FileExplorerProps) {
  const folders = workspace.folders;
  const multi = folders.length > 1;
  const defaultFolder = folders[0]?.alias ?? '';
  const [dirs, setDirs] = useState<ReadonlyMap<Key, DirState>>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<Key>>(
    () => new Set(folders.map((f) => keyOf(f.alias, ''))),
  );
  const [showIgnored, setShowIgnored] = useState<ReadonlySet<Key>>(() => new Set());
  const [filter, setFilter] = useState('');
  const terms = useMemo(() => filterTerms(filter), [filter]);
  const filtering = terms.length > 0;

  const dirsRef = useRef(dirs);
  const loadDirRef = useRef(loadDir);
  useLayoutEffect(() => {
    dirsRef.current = dirs;
    loadDirRef.current = loadDir;
  });
  /** Directory key -> generation of the request in flight. */
  const inflight = useRef(new Map<Key, number>());
  const generation = useRef(0);
  const filterInput = useRef<HTMLInputElement>(null);

  const load = useCallback((folder: string, path: string, force = false) => {
    const key = keyOf(folder, path);
    if (inflight.current.has(key)) return;
    if (!force && dirsRef.current.get(key)?.status === 'ready') return;
    const gen = generation.current;
    inflight.current.set(key, gen);
    setDirs((prev) =>
      new Map(prev).set(key, { status: 'loading', listing: prev.get(key)?.listing }),
    );
    const settle = (state: DirState) => {
      if (inflight.current.get(key) === gen) inflight.current.delete(key);
      if (gen !== generation.current) return;
      setDirs((prev) => new Map(prev).set(key, state));
    };
    Promise.resolve()
      .then(() => loadDirRef.current(folder, path))
      .then(
        (listing) => settle({ status: 'ready', listing }),
        (err: unknown) =>
          settle({ status: 'error', error: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  // Load every expanded directory that has not been requested yet.
  useEffect(() => {
    for (const key of expanded) {
      if (dirs.has(key)) continue;
      const [folder = '', path = ''] = key.split(SEP);
      load(folder, path);
    }
  }, [expanded, dirs, load]);

  const refresh = () => {
    generation.current++;
    inflight.current.clear();
    // Keep expanded listings on screen while they reload; forget collapsed ones.
    setDirs((prev) => {
      const next = new Map<Key, DirState>();
      for (const [key, state] of prev) if (expanded.has(key)) next.set(key, state);
      return next;
    });
    for (const key of expanded) {
      const [folder = '', path = ''] = key.split(SEP);
      load(folder, path, true);
    }
  };

  const collapseAll = () => setExpanded(new Set(folders.map((f) => keyOf(f.alias, ''))));

  const toggle = useCallback((key: Key, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // Reveal the active file: expand its ancestors (they load lazily).
  const activeFolder = activeRef ? (activeRef.folder ?? defaultFolder) : '';
  const activePath = activeRef?.path ?? '';
  const activeKey = activeRef ? keyOf(activeFolder, activePath) : null;
  useEffect(() => {
    if (!activeKey) return;
    const ancestors = ancestorKeys(activeFolder, activePath);
    setExpanded((prev) =>
      ancestors.every((a) => prev.has(a)) ? prev : new Set([...prev, ...ancestors]),
    );
  }, [activeKey, activeFolder, activePath]);

  /** Directory revealed from the filter results (kept visible even if ignored/folded). */
  const [revealed, setRevealed] = useState<{ folder: string; path: string } | null>(null);
  const unfold = useMemo(() => {
    const keys = new Set<Key>();
    const add = (folder: string, path: string) => {
      keys.add(keyOf(folder, path));
      for (const k of ancestorKeys(folder, path)) keys.add(k);
    };
    if (activeKey) add(activeFolder, activePath);
    if (revealed) add(revealed.folder, revealed.path);
    return keys;
  }, [activeKey, activeFolder, activePath, revealed]);

  // ---- rows ----
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (filtering) {
      const seen = new Set<Key>();
      for (const [dirKey, state] of dirs) {
        const folder = dirKey.split(SEP)[0] ?? '';
        for (const entry of state.listing?.entries ?? []) {
          const name = entry.name.toLowerCase();
          if (!terms.every((t) => name.includes(t))) continue;
          const key = keyOf(folder, entry.path);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: key,
            parentId: null,
            hasChildren: false,
            expanded: false,
            kind: entry.type === 'dir' ? 'dir' : 'file',
            folder,
            path: entry.path,
            name: entry.name,
            depth: 0,
            ignored: entry.ignored,
            nav: true,
          });
        }
      }
      const first = terms[0] ?? '';
      out.sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(first) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(first) ? 0 : 1;
        return ap - bp || a.path.length - b.path.length || a.path.localeCompare(b.path);
      });
      return out.slice(0, MAX_RESULTS);
    }

    const info = (
      kind: RowKind,
      folder: string,
      path: string,
      depth: number,
      extra?: Partial<Row>,
    ) =>
      out.push({
        id: `${keyOf(folder, path)}${SEP}${kind}`,
        parentId: keyOf(folder, path),
        hasChildren: false,
        expanded: false,
        kind,
        folder,
        path,
        name: '',
        depth,
        nav: kind === 'error' || kind === 'ignored',
        ...extra,
      });

    const walk = (folder: string, path: string, depth: number) => {
      const dirKey = keyOf(folder, path);
      const state = dirs.get(dirKey);
      if (!state || (!state.listing && state.status === 'loading')) {
        info('loading', folder, path, depth);
        return;
      }
      if (!state.listing) {
        info('error', folder, path, depth, { name: state.error ?? 'Failed to load' });
        return;
      }
      const entries = sortEntries(state.listing.entries);
      const ignoredCount = entries.filter((e) => e.ignored).length;
      const fold = ignoredCount > IGNORED_FOLD && !showIgnored.has(dirKey);
      for (const entry of entries) {
        const key = keyOf(folder, entry.path);
        if (fold && entry.ignored && !unfold.has(key)) continue;
        const isDir = entry.type === 'dir';
        const open = isDir && expanded.has(key);
        out.push({
          id: key,
          parentId: dirKey,
          hasChildren: isDir,
          expanded: open,
          kind: isDir ? 'dir' : 'file',
          folder,
          path: entry.path,
          name: entry.name,
          depth,
          ignored: entry.ignored,
          nav: true,
        });
        if (open) walk(folder, entry.path, depth + 1);
      }
      if (ignoredCount > IGNORED_FOLD) {
        info('ignored', folder, path, depth, { count: ignoredCount, expanded: !fold });
      }
      if (state.listing.truncated) info('more', folder, path, depth);
      if (!entries.length) info('empty', folder, path, depth);
    };

    for (const f of folders) {
      const rootKey = keyOf(f.alias, '');
      const open = expanded.has(rootKey);
      out.push({
        id: rootKey,
        parentId: null,
        hasChildren: true,
        expanded: open,
        kind: 'root',
        folder: f.alias,
        path: '',
        name: f.alias,
        depth: 0,
        nav: true,
      });
      if (open) walk(f.alias, '', 1);
    }
    return out;
  }, [filtering, terms, dirs, folders, expanded, showIgnored, unfold]);

  const navRows = useMemo(() => rows.filter((r) => r.nav), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const activate = (row: Row) => {
    switch (row.kind) {
      case 'file':
        onOpenFile({ folder: row.folder, path: row.path });
        break;
      case 'root':
      case 'dir':
        if (filtering) {
          // Leave the filter and reveal the directory (expanded) in the tree.
          setFilter('');
          setRevealed({ folder: row.folder, path: row.path });
          const keys = [...ancestorKeys(row.folder, row.path), row.id];
          setExpanded((prev) => new Set([...prev, ...keys]));
          nav.setFocusId(row.id);
          window.setTimeout(() => nav.focusRow(row.id), 0);
        } else toggle(row.id, !row.expanded);
        break;
      case 'ignored': {
        const dirKey = keyOf(row.folder, row.path);
        setShowIgnored((prev) => {
          const next = new Set(prev);
          if (next.has(dirKey)) next.delete(dirKey);
          else next.add(dirKey);
          return next;
        });
        break;
      }
      case 'error':
        load(row.folder, row.path, true);
        break;
      default:
        break;
    }
  };

  const nav = useTreeNav(navRows, {
    preferredId: activeKey,
    onActivate: (id) => {
      const row = byId.get(id);
      if (row) activate(row);
    },
    onToggle: (id, open) => toggle(id, open),
    onKey: (id, e) => {
      if (e.key === ' ') {
        e.preventDefault();
        const row = byId.get(id);
        if (row) activate(row);
        return true;
      }
      if (e.key === 'ArrowUp' && navRows[0]?.id === id) {
        // From the first row back up into the filter box.
        e.preventDefault();
        filterInput.current?.focus();
        return true;
      }
      return false;
    },
  });

  const activeVisible = activeKey ? byId.has(activeKey) : false;
  const { elementOf } = nav;
  useEffect(() => {
    if (activeKey && activeVisible) elementOf(activeKey)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey, activeVisible, elementOf]);

  const refOf = (row: Row): CodeRef => ({
    folder: row.folder,
    path: row.path,
    ...(row.kind === 'file' ? {} : { isDir: true }),
  });

  const renderRow = (row: Row) => {
    const pad = PAD + row.depth * INDENT;
    const guides = filtering
      ? null
      : Array.from({ length: Math.max(0, row.depth - 1) }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-border"
            style={{ left: PAD + (i + 1) * INDENT + 7 }}
          />
        ));

    if (row.kind === 'loading' || row.kind === 'more' || row.kind === 'empty') {
      return (
        <div
          key={row.id}
          role="none"
          className="relative flex h-[26px] shrink-0 items-center gap-1.5 text-xs text-subtle"
          style={{ paddingLeft: pad + 16 + 6 }}
        >
          {guides}
          {row.kind === 'loading' ? (
            <>
              <Spinner size={12} className="text-subtle" />
              <span>Loading…</span>
            </>
          ) : row.kind === 'more' ? (
            <span className="italic">More entries not shown</span>
          ) : (
            <span className="italic">Empty</span>
          )}
        </div>
      );
    }

    const focused = row.id === nav.focusId;
    const common = {
      ref: nav.register(row.id),
      'data-row-id': row.id,
      tabIndex: focused ? 0 : -1,
      onFocus: (e: FocusEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) nav.setFocusId(row.id);
      },
      onClick: (e: MouseEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        nav.setFocusId(row.id);
        activate(row);
      },
      style: { paddingLeft: row.kind === 'error' || row.kind === 'ignored' ? pad + 22 : pad },
    };
    const rowClass =
      'group relative flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none focus-visible:ring-inset';

    if (row.kind === 'error') {
      return (
        <div
          key={row.id}
          role="treeitem"
          aria-level={row.depth + 1}
          {...common}
          className={cn(rowClass, 'text-xs text-danger hover:bg-danger-soft')}
        >
          {guides}
          <CircleAlert size={13} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">{row.name}</span>
          <span className="ml-auto shrink-0 font-medium underline-offset-2 group-hover:underline">
            Retry
          </span>
        </div>
      );
    }
    if (row.kind === 'ignored') {
      const Icon = row.expanded ? EyeOff : Eye;
      return (
        <div
          key={row.id}
          role="treeitem"
          aria-level={row.depth + 1}
          {...common}
          className={cn(rowClass, 'text-xs text-subtle hover:bg-surface-2 hover:text-muted')}
        >
          {guides}
          <Icon size={13} aria-hidden className="shrink-0" />
          <span>{row.expanded ? 'Hide ignored' : `${row.count} ignored`}</span>
        </div>
      );
    }

    const isDir = row.kind === 'dir' || row.kind === 'root';
    const active = activeKey === row.id;
    const Icon =
      row.kind === 'root'
        ? FolderRoot
        : row.kind === 'dir'
          ? row.expanded
            ? FolderOpen
            : Folder
          : fileIcon(row.name);
    const loadingDir = isDir && dirs.get(row.id)?.status === 'loading' && row.expanded;
    const folderPath = folders.find((f) => f.alias === row.folder)?.path ?? row.folder;
    const tooltip =
      row.kind === 'root'
        ? folderPath
        : filtering
          ? `${multi ? `${row.folder}:` : ''}${row.path}`
          : null;
    const nameNode = (
      <span className={cn('min-w-0 truncate', row.kind === 'root' && 'font-medium text-fg')}>
        {filtering ? <Highlight text={row.name} terms={terms} /> : row.name}
      </span>
    );

    return (
      <div
        key={row.id}
        role="treeitem"
        aria-level={filtering ? 1 : row.depth + 1}
        aria-expanded={isDir && !filtering ? row.expanded : undefined}
        aria-selected={active}
        {...common}
        className={cn(
          rowClass,
          active ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
          row.ignored && !active && 'opacity-50',
        )}
      >
        {guides}
        {isDir && !filtering ? (
          <ChevronRight
            size={12}
            aria-hidden
            className={cn(
              'w-4 shrink-0 text-subtle transition-transform',
              row.expanded && 'rotate-90',
            )}
          />
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}
        <Icon
          size={14}
          aria-hidden
          className={cn('shrink-0', row.kind === 'root' || active ? 'text-accent' : 'text-subtle')}
        />
        {tooltip ? (
          <Tooltip label={tooltip} delay={600} side="right" className="min-w-0">
            {nameNode}
          </Tooltip>
        ) : (
          nameNode
        )}
        {filtering && row.kind !== 'root' ? (
          <span className="min-w-0 shrink-[3] truncate text-[11px] text-subtle">
            {[multi ? row.folder : '', dirName(row.path)].filter(Boolean).join(':')}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
          {loadingDir ? <Spinner size={11} className="text-subtle" /> : null}
          <IconButton
            icon={ASK_ICON}
            label="Ask about this"
            size="xs"
            tabIndex={focused ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              onAskAbout(refOf(row));
            }}
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </span>
      </div>
    );
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1 p-1.5 pb-1">
        <Input
          ref={filterInput}
          icon={Search}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filter) {
              e.preventDefault();
              e.stopPropagation();
              setFilter('');
            } else if (e.key === 'ArrowDown') {
              const first = navRows[0];
              if (first) {
                e.preventDefault();
                nav.focusRow(first.id);
              }
            } else if (e.key === 'Enter' && filtering) {
              const first = navRows[0];
              if (first) {
                e.preventDefault();
                activate(first);
              }
            }
          }}
          placeholder="Filter files"
          aria-label="Filter loaded files"
          className="h-7"
        />
        <IconButton icon={ChevronsDownUp} label="Collapse all" onClick={collapseAll} />
        <IconButton icon={RefreshCw} label="Refresh" onClick={refresh} />
      </div>
      {filtering && !rows.length ? (
        <EmptyState
          icon={SearchX}
          title="No matches"
          description="Only loaded folders are searched."
        />
      ) : (
        <div
          role="tree"
          aria-label="Files"
          onKeyDown={nav.onKeyDown}
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-1.5"
        >
          {rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}
