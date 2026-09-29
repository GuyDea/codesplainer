import { create } from 'zustand';
import { DETAIL_LEVELS, PROVIDER_IDS, THEMES, type Theme } from '@codesplainer/shared';
import { readJson, readString, STORAGE_KEYS } from '../lib/storage';
import { initialDataState } from './reducers';
import type { AppState, AskPrefs, SidebarTab, UiState } from './types';

function loadAskPrefs(): AskPrefs {
  const raw = readJson<Partial<AskPrefs>>(STORAGE_KEYS.askPrefs, {});
  const provider =
    raw.provider && (PROVIDER_IDS as readonly string[]).includes(raw.provider)
      ? raw.provider
      : null;
  const detail =
    raw.detail && (DETAIL_LEVELS as readonly string[]).includes(raw.detail) ? raw.detail : null;
  const models: AskPrefs['models'] = {};
  if (raw.models && typeof raw.models === 'object') {
    for (const id of PROVIDER_IDS) {
      const value = (raw.models as Record<string, unknown>)[id];
      if (typeof value === 'string') models[id] = value;
    }
  }
  return { provider, models, detail };
}

function loadSidebar(): UiState['sidebar'] {
  const raw = readJson<{ open?: unknown; tab?: unknown }>(STORAGE_KEYS.sidebar, {});
  const tabs: SidebarTab[] = ['outline', 'files', 'chats'];
  return {
    open: typeof raw.open === 'boolean' ? raw.open : true,
    tab: tabs.includes(raw.tab as SidebarTab) ? (raw.tab as SidebarTab) : 'outline',
  };
}

function loadTheme(): Theme {
  const stored = readString(STORAGE_KEYS.theme);
  return stored && (THEMES as readonly string[]).includes(stored) ? (stored as Theme) : 'system';
}

function initialResolvedTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function initialUiState(): UiState {
  return {
    connection: 'connecting',
    connectionError: null,
    eventsState: 'connecting',
    health: null,
    providersLoaded: false,
    workspacesLoaded: false,
    loadError: null,
    conversationsStatus: 'idle',
    conversationStatus: 'idle',
    conversationError: null,
    currentGraphId: null,
    view: 'diagram',
    selection: { nodeId: null, edgeId: null },
    rightPanel: null,
    askPrefs: loadAskPrefs(),
    askScope: null,
    askFocus: 0,
    askDraft: undefined,
    askBusy: false,
    sidebar: loadSidebar(),
    outlineFilter: '',
    explorerRef: null,
    legendVisible: readString(STORAGE_KEYS.legend) === '1',
    theme: loadTheme(),
    resolvedTheme: initialResolvedTheme(),
    toasts: [],
    dialog: null,
    modal: null,
    paletteOpen: false,
  };
}

export const useAppStore = create<AppState>()(() => ({
  ...initialDataState(),
  ...initialUiState(),
}));

export const getState = useAppStore.getState;
export const setState = useAppStore.setState;
