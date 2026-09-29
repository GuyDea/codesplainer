import { useLayoutEffect, useRef, useState } from 'react';
import {
  Braces,
  Download,
  FileImage,
  Image,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Shapes,
  Star,
  StickyNote,
  Trash2,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import {
  DETAIL_LEVELS,
  DETAIL_LEVEL_INFO,
  GRAPH_KIND_INFO,
  PROVIDER_LABELS,
  formatDuration,
  graphDisplayTitle,
  truncate,
} from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { GRAPH_KIND_ICONS, ORIGIN_VISUALS, STATUS_VISUALS } from '../graph/visuals';
import {
  Badge,
  Button,
  Dialog,
  Divider,
  IconButton,
  Menu,
  StatusIcon,
  Textarea,
  Tooltip,
  type MenuItem,
} from '../ui';
import { DotOk, formatCost, formatCount, graphDurationMs, totalTokens } from './helpers';
import { ACTIVE_ICON_BUTTON, DotList, InlineRename } from './parts';
import type { DiagramHeaderProps } from './types';

/**
 * Title row + meta + actions + summary of a diagram. Has no outer padding: place it in a padded
 * header area above the canvas.
 */
export function DiagramHeader({
  graph,
  providers,
  onRename,
  onRetry,
  onExport,
  onToggleStar,
  onDelete,
  onSaveNote,
  onShowActivity,
  legendVisible,
  onToggleLegend,
  descendantCount,
  confirmDelete: confirmBeforeDelete = true,
  className,
}: DiagramHeaderProps) {
  const spec = graph.spec;
  const title = graphDisplayTitle(graph);
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleButton = useRef<HTMLButtonElement>(null);

  const KindIcon = spec ? GRAPH_KIND_ICONS[spec.kind] : ORIGIN_VISUALS[graph.origin.type].icon;
  const kindLabel = spec
    ? `${GRAPH_KIND_INFO[spec.kind].label} diagram`
    : ORIGIN_VISUALS[graph.origin.type].label;
  const note = graph.note?.trim() ?? '';
  const starred = Boolean(graph.starred);

  // ---- meta line ----
  const providerName =
    providers.find((p) => p.id === graph.provider)?.name ?? PROVIDER_LABELS[graph.provider];
  const model = graph.usage?.model ?? graph.model;
  const duration = graphDurationMs(graph);
  const usage = graph.usage;
  const tokens = totalTokens(usage);
  const tokenDetail = usage
    ? [
        usage.inputTokens !== undefined ? `${usage.inputTokens.toLocaleString()} in` : '',
        usage.outputTokens !== undefined ? `${usage.outputTokens.toLocaleString()} out` : '',
        usage.cachedTokens ? `${usage.cachedTokens.toLocaleString()} cached` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const meta = [
    graph.status !== 'done' ? (
      <span key="status" className="flex items-center gap-1">
        <StatusIcon status={graph.status} size={12} />
        {STATUS_VISUALS[graph.status].label}
      </span>
    ) : null,
    <span key="provider">{providerName}</span>,
    model ? (
      <span key="model" className="max-w-[14rem] truncate">
        {model}
      </span>
    ) : null,
    duration !== undefined ? (
      <span key="duration" className="tabular-nums">
        {formatDuration(duration)}
      </span>
    ) : null,
    usage?.costUsd !== undefined ? (
      <span key="cost" className="tabular-nums">
        {formatCost(usage.costUsd)}
      </span>
    ) : usage?.credits !== undefined ? (
      <span key="credits" className="tabular-nums">
        {formatCount(usage.credits)} {usage.credits === 1 ? 'credit' : 'credits'}
      </span>
    ) : null,
    tokens !== undefined ? (
      <Tooltip key="tokens" label={tokenDetail} disabled={!tokenDetail}>
        <span className="tabular-nums">{formatCount(tokens)} tokens</span>
      </Tooltip>
    ) : null,
    graph.warnings.length ? (
      <Tooltip
        key="warnings"
        label={
          <ul className="flex list-disc flex-col gap-0.5 pl-3.5 text-left font-normal">
            {graph.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        }
      >
        <Badge
          tone="warn"
          icon={TriangleAlert}
          tabIndex={0}
          aria-label={`${graph.warnings.length} ${graph.warnings.length === 1 ? 'warning' : 'warnings'}`}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn/40"
        >
          {graph.warnings.length}
        </Badge>
      </Tooltip>
    ) : null,
  ];

  // ---- menus ----
  const others = providers.filter((p) => p.enabled && p.available && p.id !== graph.provider);
  const retryItems: MenuItem[] = [
    { id: 'retry', label: 'Retry', icon: RotateCcw, onSelect: () => onRetry({}) },
  ];
  if (graph.origin.type !== 'question') {
    retryItems.push({
      id: 'fresh',
      label: 'Retry with fresh session',
      icon: RefreshCw,
      onSelect: () => onRetry({ fresh: true }),
    });
  }
  if (others.length) {
    retryItems.push({ type: 'separator', id: 'sep-providers' });
    for (const p of others) {
      retryItems.push({
        id: `provider-${p.id}`,
        label: `Retry with ${p.name}`,
        icon: DotOk,
        onSelect: () => onRetry({ provider: p.id }),
      });
    }
  }
  retryItems.push({ type: 'label', id: 'label-detail', label: 'Detail' });
  for (const level of DETAIL_LEVELS) {
    const info = DETAIL_LEVEL_INFO[level];
    retryItems.push({
      id: `detail-${level}`,
      label: info.label,
      hint: `${info.min}–${info.max} boxes`,
      checked: graph.detail === level,
      onSelect: () => onRetry({ detail: level }),
    });
  }

  const exportItems: MenuItem[] = [
    { id: 'png', label: 'PNG image', icon: Image, onSelect: () => onExport('png') },
    { id: 'svg', label: 'SVG image', icon: FileImage, onSelect: () => onExport('svg') },
    { type: 'separator', id: 'sep-copy' },
    { id: 'mermaid', label: 'Copy Mermaid', icon: Workflow, onSelect: () => onExport('mermaid') },
    { id: 'json', label: 'Copy JSON', icon: Braces, onSelect: () => onExport('json') },
  ];

  const below =
    descendantCount === undefined
      ? ' and any diagrams created from it'
      : descendantCount > 0
        ? ` and ${descendantCount} ${descendantCount === 1 ? 'diagram' : 'diagrams'} below it`
        : '';

  return (
    <header className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Tooltip label={kindLabel} className="mt-0.5 shrink-0">
          <span
            role="img"
            aria-label={kindLabel}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"
          >
            <KindIcon size={16} aria-hidden />
          </span>
        </Tooltip>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="flex h-7 min-w-0 items-center text-[15px] leading-tight font-semibold text-fg">
            {editing ? (
              <InlineRename
                initial={title}
                label="Diagram title"
                className="h-7 text-[15px] font-semibold"
                onDone={(value, refocus) => {
                  setEditing(false);
                  const next = value?.trim();
                  if (next && next !== title) onRename(next);
                  if (refocus) window.setTimeout(() => titleButton.current?.focus(), 0);
                }}
              />
            ) : (
              <Tooltip label="Rename" delay={700} className="min-w-0">
                <button
                  ref={titleButton}
                  type="button"
                  onClick={() => setEditing(true)}
                  className="group -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                >
                  <span className="truncate">{title}</span>
                  <Pencil
                    size={12}
                    aria-hidden
                    className="shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </button>
              </Tooltip>
            )}
          </h2>
          <DotList items={meta} className="text-xs text-muted" />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            icon={Star}
            label={starred ? 'Unstar' : 'Star'}
            onClick={onToggleStar}
            className={cn(starred && 'text-warn! [&_svg]:fill-current')}
          />
          {onToggleLegend ? (
            <IconButton
              icon={Shapes}
              label="Legend"
              active={Boolean(legendVisible)}
              onClick={onToggleLegend}
              className={cn(legendVisible && ACTIVE_ICON_BUTTON)}
            />
          ) : null}
          <IconButton icon={ScrollText} label="Activity log" onClick={onShowActivity} />
          <span className="relative inline-flex">
            <IconButton
              icon={StickyNote}
              label={note ? 'Edit note' : 'Add note'}
              onClick={() => setNoteOpen(true)}
            />
            {note ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface"
              />
            ) : null}
          </span>
          <Divider vertical />
          <Menu items={retryItems} align="end" minWidth={220}>
            <IconButton icon={RotateCcw} label="Retry" />
          </Menu>
          <Menu items={exportItems} align="end">
            <IconButton icon={Download} label="Export" disabled={!spec} />
          </Menu>
          <IconButton
            icon={Trash2}
            label="Delete"
            onClick={() => (confirmBeforeDelete ? setConfirmDelete(true) : onDelete())}
            className="hover:bg-danger-soft! hover:text-danger!"
          />
        </div>
      </div>

      {spec?.summary ? <Summary text={spec.summary} /> : null}

      {note ? (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="flex max-w-full min-w-0 items-center gap-1.5 self-start pl-[42px] text-left text-xs text-muted hover:text-fg"
        >
          <StickyNote size={12} aria-hidden className="shrink-0 text-accent" />
          <span className="truncate">{note}</span>
        </button>
      ) : null}

      {noteOpen ? (
        <NoteDialog note={note} onClose={() => setNoteOpen(false)} onSave={onSaveNote} />
      ) : null}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="Delete diagram?"
        description={`“${truncate(title, 60)}”${below} will be deleted.`}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </header>
  );
}

/** One/two sentence answer; clamped to two lines, click to expand when it overflows. */
function Summary({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  const interactive = clamped || open;
  return (
    <p
      ref={ref}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? open : undefined}
      onClick={interactive ? () => setOpen((v) => !v) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen((v) => !v);
              }
            }
          : undefined
      }
      className={cn(
        'max-w-3xl pl-[42px] text-[13px] leading-relaxed text-muted',
        !open && 'line-clamp-2',
        interactive &&
          'cursor-pointer rounded-md hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      )}
    >
      {text}
    </p>
  );
}

/** Mounted only while open, so the draft starts from the saved note each time. */
function NoteDialog({
  note,
  onClose,
  onSave,
}: {
  note: string;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(note);
  const changed = draft.trim() !== note;
  const save = () => {
    if (changed) onSave(draft.trim());
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Note"
      footer={
        <>
          {note ? (
            <Button
              variant="ghost"
              icon={Trash2}
              className="mr-auto text-danger! hover:bg-danger-soft!"
              onClick={() => {
                onSave('');
                onClose();
              }}
            >
              Remove
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!changed}>
            Save
          </Button>
        </>
      }
    >
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        rows={6}
        aria-label="Note"
        placeholder="Your notes about this diagram…"
        className="min-h-28 resize-y"
      />
    </Dialog>
  );
}
