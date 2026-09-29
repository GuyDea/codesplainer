import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  CircleStop,
  Ellipsis,
  ListTree,
  Pencil,
  RotateCcw,
  SearchX,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import {
  buildTree,
  descendantsOf,
  graphDisplayTitle,
  isPending,
  pathTo,
  truncate,
  type GraphEntry,
  type GraphTreeNode,
} from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { ORIGIN_VISUALS, STATUS_VISUALS } from '../graph/visuals';
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Menu,
  StatusIcon,
  Tooltip,
  type MenuItem,
} from '../ui';
import { useTreeNav, type TreeNavRow } from './hooks';
import { Highlight, InlineRename, filterTerms } from './parts';
import type { OutlineProps } from './types';

const INDENT = 14;
const PAD = 6;

interface OutlineRow extends TreeNavRow {
  entry: GraphEntry;
  depth: number;
  /** False for ancestors that are only visible because a descendant matches the filter. */
  matched: boolean;
  posinset: number;
  setsize: number;
}

function haystack(entry: GraphEntry): string {
  const parts = [graphDisplayTitle(entry), entry.question];
  if ('nodeLabel' in entry.origin) parts.push(entry.origin.nodeLabel);
  for (const node of entry.spec?.nodes ?? []) parts.push(node.label);
  return parts.join('\n').toLowerCase();
}

/** Flatten the forest into the visible rows (collapse state + filter applied). */
function flatten(
  tree: GraphTreeNode[],
  collapsed: ReadonlySet<string>,
  terms: string[],
): OutlineRow[] {
  const filtering = terms.length > 0;
  const keep = new Set<string>();
  const matched = new Set<string>();
  if (filtering) {
    const mark = (node: GraphTreeNode): boolean => {
      let below = false;
      for (const child of node.children) if (mark(child)) below = true;
      const hay = haystack(node.entry);
      const self = terms.every((t) => hay.includes(t));
      if (self) matched.add(node.entry.id);
      if (self || below) keep.add(node.entry.id);
      return self || below;
    };
    for (const root of tree) mark(root);
  }
  const rows: OutlineRow[] = [];
  const walk = (nodes: GraphTreeNode[], parentId: string | null) => {
    const visible = filtering ? nodes.filter((n) => keep.has(n.entry.id)) : nodes;
    visible.forEach((node, index) => {
      const kids = filtering ? node.children.filter((c) => keep.has(c.entry.id)) : node.children;
      const hasChildren = kids.length > 0;
      const expanded = hasChildren && (filtering || !collapsed.has(node.entry.id));
      rows.push({
        id: node.entry.id,
        parentId,
        hasChildren,
        expanded,
        entry: node.entry,
        depth: node.depth,
        matched: !filtering || matched.has(node.entry.id),
        posinset: index + 1,
        setsize: visible.length,
      });
      if (expanded) walk(node.children, node.entry.id);
    });
  };
  walk(tree, null);
  return rows;
}

function relationHint(entry: GraphEntry): string | undefined {
  const o = entry.origin;
  return o.type === 'expand' || o.type === 'ask-node' ? o.nodeLabel : undefined;
}

/**
 * The discussion tree. Scrolls itself: give it a bounded height (e.g. flex-1 min-h-0 in a
 * column). Keyboard: ↑/↓ move, Enter/Space open, ←/→ collapse/expand, F2 rename, Delete,
 * Shift+F10 / context menu key for the row menu.
 */
export function Outline({
  conversation,
  currentGraphId,
  onOpen,
  onRetry,
  onCancel,
  onDelete,
  onToggleStar,
  onRename,
  filter,
  confirmDelete = false,
  className,
}: OutlineProps) {
  const tree = useMemo(() => buildTree(conversation), [conversation]);
  const terms = useMemo(() => filterTerms(filter), [filter]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const rows = useMemo(() => flatten(tree, collapsed, terms), [tree, collapsed, terms]);

  const toggle = (id: string, expand: boolean) =>
    setCollapsed((prev) => {
      if (expand === !prev.has(id)) return prev;
      const next = new Set(prev);
      if (expand) next.delete(id);
      else next.add(id);
      return next;
    });

  const openMenu = (id: string) =>
    nav.elementOf(id)?.querySelector<HTMLElement>('[data-row-menu]')?.click();

  const requestDelete = (id: string) => {
    if (confirmDelete) setConfirmId(id);
    else onDelete?.(id);
  };

  const nav = useTreeNav(rows, {
    preferredId: currentGraphId,
    onActivate: onOpen,
    onToggle: toggle,
    onKey: (id, e: KeyboardEvent<HTMLElement>) => {
      if (e.key === ' ') {
        e.preventDefault();
        onOpen(id);
        return true;
      }
      if (e.key === 'F2' && onRename) {
        e.preventDefault();
        setEditingId(id);
        return true;
      }
      if (e.key === 'Delete' && onDelete) {
        e.preventDefault();
        requestDelete(id);
        return true;
      }
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        openMenu(id);
        return true;
      }
      return false;
    },
  });

  // Reveal the current diagram when it (or its ancestry) changes: expand its ancestors and make
  // it the keyboard focus target (without stealing DOM focus).
  const ancestorKey = useMemo(
    () =>
      currentGraphId
        ? pathTo(conversation, currentGraphId)
            .slice(0, -1)
            .map((g) => g.id)
            .join('\n')
        : '',
    [conversation, currentGraphId],
  );
  const { setFocusId, elementOf } = nav;
  useEffect(() => {
    if (!currentGraphId) return;
    const ancestors = new Set(ancestorKey ? ancestorKey.split('\n') : []);
    setCollapsed((prev) =>
      [...prev].some((id) => ancestors.has(id))
        ? new Set([...prev].filter((id) => !ancestors.has(id)))
        : prev,
    );
    setFocusId(currentGraphId);
  }, [currentGraphId, ancestorKey, setFocusId]);

  const currentVisible = rows.some((r) => r.id === currentGraphId);
  useEffect(() => {
    if (!currentGraphId || !currentVisible) return;
    elementOf(currentGraphId)?.scrollIntoView?.({ block: 'nearest' });
  }, [currentGraphId, currentVisible, elementOf]);

  const finishRename = (entry: GraphEntry, value: string | null, refocus: boolean) => {
    setEditingId(null);
    const title = value?.trim();
    if (title && title !== graphDisplayTitle(entry)) onRename?.(entry.id, title);
    if (refocus) window.setTimeout(() => nav.focusRow(entry.id), 0);
  };

  const menuItems = (entry: GraphEntry): MenuItem[] => {
    const pending = isPending(entry.status);
    const items: MenuItem[] = [
      { id: 'open', label: 'Open', icon: ArrowUpRight, onSelect: () => onOpen(entry.id) },
    ];
    if (onRetry && !pending) {
      items.push({
        id: 'retry',
        label: 'Retry',
        icon: RotateCcw,
        onSelect: () => onRetry(entry.id),
      });
    }
    if (onCancel && pending) {
      items.push({
        id: 'cancel',
        label: 'Cancel',
        icon: CircleStop,
        onSelect: () => onCancel(entry.id),
      });
    }
    if (onRename) {
      items.push({
        id: 'rename',
        label: 'Rename',
        icon: Pencil,
        shortcut: 'F2',
        onSelect: () => setEditingId(entry.id),
      });
    }
    if (onToggleStar) {
      items.push({
        id: 'star',
        label: entry.starred ? 'Unstar' : 'Star',
        icon: entry.starred ? StarOff : Star,
        onSelect: () => onToggleStar(entry.id, !entry.starred),
      });
    }
    if (onDelete) {
      items.push({ type: 'separator', id: 'sep' });
      items.push({
        id: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        shortcut: 'Del',
        onSelect: () => requestDelete(entry.id),
      });
    }
    return items;
  };

  const confirmEntry = confirmId ? conversation.graphs.find((g) => g.id === confirmId) : undefined;
  const confirmBelow = confirmEntry ? descendantsOf(conversation, confirmEntry.id).length : 0;
  const deleteDialog = (
    <Dialog
      open={Boolean(confirmEntry)}
      onClose={() => setConfirmId(null)}
      size="sm"
      title="Delete diagram?"
      description={
        confirmEntry
          ? `“${truncate(graphDisplayTitle(confirmEntry), 60)}”${
              confirmBelow
                ? ` and ${confirmBelow} ${confirmBelow === 1 ? 'diagram' : 'diagrams'} below it`
                : ''
            } will be deleted.`
          : undefined
      }
      footer={
        <>
          <Button onClick={() => setConfirmId(null)} data-autofocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => {
              if (confirmEntry) onDelete?.(confirmEntry.id);
              setConfirmId(null);
            }}
          >
            Delete
          </Button>
        </>
      }
    />
  );

  if (!conversation.graphs.length) {
    return (
      <>
        <EmptyState
          icon={ListTree}
          title="No diagrams yet"
          description="Ask a question to start."
          className={className}
        />
        {deleteDialog}
      </>
    );
  }
  if (!rows.length) {
    return (
      <>
        <EmptyState icon={SearchX} title="No matches" className={className} />
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <div
        role="tree"
        aria-label="Discussion"
        onKeyDown={nav.onKeyDown}
        className={cn('flex min-h-0 flex-col gap-px overflow-y-auto p-1.5', className)}
      >
        {rows.map((row) => {
          const { entry } = row;
          const title = graphDisplayTitle(entry);
          const active = entry.id === currentGraphId;
          const focused = entry.id === nav.focusId;
          const editing = entry.id === editingId;
          const hint = relationHint(entry);
          const OriginIcon = ORIGIN_VISUALS[entry.origin.type].icon;
          const items = menuItems(entry);
          const label = [
            title,
            hint ? `from ${hint}` : '',
            entry.status !== 'done' ? STATUS_VISUALS[entry.status].label : '',
            entry.starred ? 'starred' : '',
          ]
            .filter(Boolean)
            .join(', ');
          const inRow = (e: { currentTarget: HTMLElement; target: EventTarget }) =>
            e.currentTarget.contains(e.target as Node);
          return (
            <div
              key={entry.id}
              ref={nav.register(entry.id)}
              role="treeitem"
              data-row-id={entry.id}
              aria-level={row.depth + 1}
              aria-posinset={row.posinset}
              aria-setsize={row.setsize}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-selected={active}
              aria-label={label}
              tabIndex={focused ? 0 : -1}
              onFocus={(e) => {
                if (e.target === e.currentTarget) nav.setFocusId(entry.id);
              }}
              onClick={(e) => {
                if (!inRow(e) || editing) return;
                nav.setFocusId(entry.id);
                onOpen(entry.id);
              }}
              onDoubleClick={(e) => {
                if (!onRename || !inRow(e) || editing) return;
                e.preventDefault();
                setEditingId(entry.id);
              }}
              onContextMenu={(e) => {
                if (!inRow(e) || editing || !items.length) return;
                e.preventDefault();
                openMenu(entry.id);
              }}
              style={{ paddingLeft: PAD + row.depth * INDENT }}
              className={cn(
                'group relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none',
                'focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none focus-visible:ring-inset',
                active ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                !row.matched && 'opacity-55',
              )}
            >
              {Array.from({ length: row.depth }, (_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-px bg-border"
                  style={{ left: PAD + i * INDENT + 7 }}
                />
              ))}
              {row.hasChildren ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={row.expanded ? 'Collapse' : 'Expand'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(entry.id, !row.expanded);
                  }}
                  className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-3 hover:text-fg"
                >
                  <ChevronRight
                    size={12}
                    className={cn('transition-transform', row.expanded && 'rotate-90')}
                  />
                </button>
              ) : (
                <span aria-hidden className="w-4 shrink-0" />
              )}
              <OriginIcon
                size={14}
                aria-hidden
                className={cn('shrink-0', active ? 'text-accent' : 'text-subtle')}
              />
              {editing ? (
                <InlineRename
                  initial={title}
                  label="Diagram title"
                  onDone={(value, refocus) => finishRename(entry, value, refocus)}
                  className="h-6 text-[13px]"
                />
              ) : (
                <>
                  <Tooltip
                    label={entry.question}
                    side="right"
                    delay={700}
                    disabled={entry.question === title && title.length <= 28}
                    className="min-w-0 shrink"
                  >
                    <span className={cn('min-w-0 truncate', active && 'font-medium')}>
                      <Highlight text={title} terms={terms} />
                    </span>
                  </Tooltip>
                  {hint ? (
                    <span className="min-w-8 shrink-[3] truncate text-[11.5px] text-subtle">
                      ↳ {hint}
                    </span>
                  ) : null}
                </>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
                {entry.starred ? (
                  <Star size={12} aria-hidden className="fill-current text-warn" />
                ) : null}
                {entry.status !== 'done' ? (
                  <StatusIcon
                    status={entry.status}
                    size={13}
                    className="motion-reduce:animate-none"
                  />
                ) : null}
                {items.length && !editing ? (
                  <Menu
                    items={items}
                    align="end"
                    onOpenChange={(open) => setMenuOpenId(open ? entry.id : null)}
                  >
                    <IconButton
                      icon={Ellipsis}
                      label="More actions"
                      size="xs"
                      tabIndex={focused ? 0 : -1}
                      data-row-menu=""
                      className={cn(
                        'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100',
                        menuOpenId === entry.id && 'opacity-100',
                      )}
                    />
                  </Menu>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {deleteDialog}
    </>
  );
}
