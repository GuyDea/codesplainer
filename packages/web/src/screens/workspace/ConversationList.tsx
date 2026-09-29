import { useState } from 'react';
import {
  Copy,
  Ellipsis,
  FileDown,
  FileText,
  LoaderCircle,
  MessagesSquare,
  Pencil,
  SquareArrowOutUpRight,
  Trash,
} from 'lucide-react';
import type { ConversationSummary } from '@codesplainer/shared';
import { cn } from '../../lib/cn';
import { plural, relativeTime, absoluteTime } from '../../lib/format';
import { navigate, routes } from '../../lib/router';
import { useNow } from '../../lib/useNow';
import {
  deleteConversationFlow,
  duplicateConversationFlow,
  exportConversation,
  renameConversationFlow,
} from '../../store';
import { IconButton, Menu, type MenuItem } from '../../ui';

export function conversationMenuItems(c: ConversationSummary): MenuItem[] {
  return [
    {
      id: 'open',
      label: 'Open',
      icon: SquareArrowOutUpRight,
      onSelect: () => navigate(routes.conversation(c.workspaceId, c.id)),
    },
    {
      id: 'rename',
      label: 'Rename…',
      icon: Pencil,
      onSelect: () => void renameConversationFlow(c),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () => void duplicateConversationFlow(c),
    },
    { type: 'separator', id: 'sep1' },
    {
      id: 'json',
      label: 'Export JSON',
      icon: FileDown,
      onSelect: () => void exportConversation(c, 'json'),
    },
    {
      id: 'md',
      label: 'Export Markdown',
      icon: FileText,
      onSelect: () => void exportConversation(c, 'md'),
    },
    { type: 'separator', id: 'sep2' },
    {
      id: 'delete',
      label: 'Delete…',
      icon: Trash,
      danger: true,
      onSelect: () => void deleteConversationFlow(c),
    },
  ];
}

export function RunningBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 text-[11px] font-medium text-accent">
      <LoaderCircle size={11} className="animate-spin" aria-hidden />
      {count > 1 ? count : null}
      <span className="sr-only">{plural(count, 'diagram')} generating</span>
    </span>
  );
}

export function ConversationList({
  conversations,
  loading,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
}) {
  const now = useNow();
  if (loading && !conversations.length) {
    return (
      <ul className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-14 animate-pulse-soft rounded-xl bg-surface" />
        ))}
      </ul>
    );
  }
  if (!conversations.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center">
        <MessagesSquare size={18} className="text-subtle" aria-hidden />
        <p className="text-[13px] text-muted">No conversations yet.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {conversations.map((c) => (
        <ConversationRow key={c.id} conversation={c} now={now} />
      ))}
    </ul>
  );
}

function ConversationRow({
  conversation: c,
  now,
}: {
  conversation: ConversationSummary;
  now: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="group flex items-center gap-3 px-4 transition-colors hover:bg-surface-2/60">
      <button
        type="button"
        onClick={() => navigate(routes.conversation(c.workspaceId, c.id))}
        className="flex min-w-0 flex-1 flex-col py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-fg">{c.title}</span>
          <RunningBadge count={c.runningCount} />
        </span>
        {c.lastQuestion && c.lastQuestion !== c.title ? (
          <span className="truncate text-xs text-muted">{c.lastQuestion}</span>
        ) : null}
      </button>
      <span className="hidden shrink-0 text-xs text-subtle tabular-nums sm:inline">
        {plural(c.graphCount, 'diagram')}
      </span>
      <span
        className="w-20 shrink-0 text-right text-xs text-subtle"
        title={absoluteTime(c.updatedAt)}
      >
        {relativeTime(c.updatedAt, now)}
      </span>
      <span
        className={cn(
          'shrink-0 transition-opacity',
          menuOpen
            ? 'opacity-100'
            : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        <Menu align="end" items={conversationMenuItems(c)} onOpenChange={setMenuOpen}>
          <IconButton icon={Ellipsis} label="Conversation actions" size="xs" />
        </Menu>
      </span>
    </li>
  );
}
