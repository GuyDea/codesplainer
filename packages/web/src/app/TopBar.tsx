import {
  ChevronRight,
  Command,
  Keyboard,
  Map as MapIcon,
  Monitor,
  Moon,
  Network,
  Settings,
  Sun,
  WifiOff,
} from 'lucide-react';
import { PROVIDER_LABELS, type Theme } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { shortcutLabel } from '../lib/platform';
import { navigate, routes, type AppView, type Route } from '../lib/router';
import {
  cycleTheme,
  isProviderReady,
  openDialog,
  openSettings,
  reconnectEventsNow,
  renameConversationInline,
  setView,
  togglePalette,
  useAppStore,
} from '../store';
import { IconButton, InlineEdit, Segmented, Tooltip } from '../ui';
import { LogoMark } from './Logo';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const THEME_ICONS: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function TopBar({ route }: { route: Route }) {
  const inConversation = route.name === 'conversation';
  return (
    <header className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-surface px-2">
      <nav aria-label="Location" className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => navigate(routes.home())}
          aria-label="Codesplainer home"
          className="flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 text-[13px] font-semibold text-fg hover:bg-surface-2"
        >
          <LogoMark size={20} />
          <span className="hidden lg:inline">Codesplainer</span>
        </button>
        <span aria-hidden className="px-0.5 text-subtle">
          /
        </span>
        <WorkspaceSwitcher route={route} />
        {inConversation ? (
          <>
            <ChevronRight size={14} aria-hidden className="shrink-0 text-subtle" />
            <ConversationTitle conversationId={route.conversationId} />
          </>
        ) : null}
      </nav>
      <div className="flex justify-center">
        {inConversation ? <ViewToggle view={route.view ?? 'diagram'} /> : null}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        <EventsBadge />
        <ProviderPill />
        <ThemeButton />
        <IconButton
          icon={Command}
          label="Command palette"
          shortcut={shortcutLabel('mod+k')}
          onClick={togglePalette}
        />
        <span className="hidden sm:inline-flex">
          <IconButton
            icon={Keyboard}
            label="Keyboard shortcuts"
            shortcut="?"
            onClick={() => openDialog({ type: 'shortcuts' })}
          />
        </span>
        <IconButton icon={Settings} label="Settings" onClick={() => openSettings('general')} />
      </div>
    </header>
  );
}

function ConversationTitle({ conversationId }: { conversationId: string }) {
  const title = useAppStore((s) =>
    s.conversation?.id === conversationId ? s.conversation.title : null,
  );
  if (title === null) {
    return (
      <span className="ml-1.5 h-3.5 w-32 animate-pulse-soft rounded bg-surface-2" aria-hidden />
    );
  }
  return (
    <InlineEdit
      value={title}
      label="Conversation title"
      onSubmit={(next) => void renameConversationInline(conversationId, next)}
      className="max-w-[28ch]"
      inputClassName="w-[28ch]"
    />
  );
}

function ViewToggle({ view }: { view: AppView }) {
  return (
    <Segmented<AppView>
      aria-label="View"
      value={view}
      onChange={setView}
      options={[
        { value: 'diagram', label: 'Diagram', icon: Network, title: 'Diagram (M)' },
        { value: 'map', label: 'Map', icon: MapIcon, title: 'Conversation map (M)' },
      ]}
    />
  );
}

function EventsBadge() {
  const state = useAppStore((s) => s.eventsState);
  if (state !== 'reconnecting') return null;
  return (
    <Tooltip label="Live updates paused — reconnecting to the server">
      <button
        type="button"
        onClick={reconnectEventsNow}
        className="inline-flex h-6 items-center gap-1.5 rounded-full bg-warn-soft px-2 text-[11px] font-medium text-warn"
      >
        <WifiOff size={12} />
        <span className="hidden md:inline">Reconnecting…</span>
      </button>
    </Tooltip>
  );
}

function ProviderPill() {
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const loaded = useAppStore((s) => s.providersLoaded);
  const id = settings?.defaultProvider;
  if (!id) return null;
  const info = providers.find((p) => p.id === id);
  const ready = isProviderReady(info);
  const name = info?.name ?? PROVIDER_LABELS[id];
  const reason = !loaded
    ? 'Detecting…'
    : ready
      ? `Default provider · ${info?.version ?? 'ready'}`
      : info && !info.enabled
        ? 'Disabled in settings'
        : (info?.reason ?? 'Not detected');
  return (
    <Tooltip label={reason}>
      <button
        type="button"
        onClick={() => openSettings('providers')}
        aria-label={`Default provider ${name}: ${ready ? 'ready' : 'unavailable'}`}
        className="inline-flex h-7 max-w-[16ch] items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            !loaded ? 'bg-subtle' : ready ? 'bg-ok' : 'bg-danger',
          )}
        />
        <span className="truncate">{name}</span>
      </button>
    </Tooltip>
  );
}

function ThemeButton() {
  const theme = useAppStore((s) => s.theme);
  const Icon = THEME_ICONS[theme];
  return <IconButton icon={Icon} label={`Theme: ${THEME_LABELS[theme]}`} onClick={cycleTheme} />;
}
