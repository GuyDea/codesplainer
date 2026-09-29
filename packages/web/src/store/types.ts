import type {
  ActivityItem,
  CodeRef,
  Conversation,
  ConversationSummary,
  DetailLevel,
  FileContent,
  GraphEntry,
  HealthResponse,
  ProviderId,
  ProviderInfo,
  Settings,
  SettingsPatch,
  Theme,
  Workspace,
} from '@codesplainer/shared';
import type { AskScope } from '../panels/types';
import type { EventConnectionState } from '../lib/events';
import type { AppView } from '../lib/router';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Bookkeeping that lets fetched snapshots and live events be merged without going stale. */
export interface SyncState {
  /** Incremented for every applied server event. */
  seq: number;
  /** Key ("g:<id>", "c:<id>", "w:<id>") -> seq of the last event that touched it. */
  touched: Record<string, number>;
  /** Tombstones: key -> seq of the delete event. */
  deleted: Record<string, number>;
}

/** Server data mirrored in the client (updated by fetches and SSE events). */
export interface DataState {
  providers: ProviderInfo[];
  settings: Settings | null;
  /** Local settings edits not yet confirmed by the server (re-applied over incoming settings). */
  settingsPending: SettingsPatch | null;
  workspaces: Workspace[];
  /** Workspace whose conversation summaries are held in `conversations`. */
  conversationsWorkspaceId: string | null;
  conversations: ConversationSummary[];
  /** Conversation the user is looking at (requested id, may still be loading). */
  conversationId: string | null;
  conversation: Conversation | null;
  /** graph.updated events for `conversationId` received before its first fetch completed. */
  pendingGraphs: GraphEntry[];
  /** Live activity per graph id. */
  activity: Record<string, ActivityItem[]>;
  sync: SyncState;
}

export type RightPanel =
  | { type: 'node' }
  | { type: 'edge' }
  | {
      type: 'code';
      ref: CodeRef;
      file: FileContent | null;
      loading: boolean;
      error: string | null;
      /** Inspector to go back to. */
      back: 'node' | 'edge' | null;
      /** Diagram/box the code was reached from (used for "Ask about lines"). */
      context: { graphId: string; nodeId?: string } | null;
    }
  | { type: 'activity' };

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: ToastAction;
  /** ms before auto-dismiss; 0 = sticky. */
  duration: number;
}

export type SettingsTab = 'general' | 'providers';

export type DialogState =
  | { type: 'settings'; tab: SettingsTab }
  | { type: 'shortcuts' }
  | { type: 'import'; file?: File }
  | { type: 'workspace-create'; initialFolders?: string[] }
  | { type: 'workspace-edit'; workspaceId: string }
  | { type: 'raw-output'; conversationId: string; graphId: string; title: string };

export interface ConfirmRequest {
  kind: 'confirm';
  id: number;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest {
  kind: 'prompt';
  id: number;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  maxLength?: number;
  resolve: (value: string | null) => void;
}

export type ModalRequest = ConfirmRequest | PromptRequest;

export type SidebarTab = 'outline' | 'files' | 'chats';

export interface AskPrefs {
  /** null = settings.defaultProvider */
  provider: ProviderId | null;
  /** Last model per provider ('' = provider default). */
  models: Partial<Record<ProviderId, string>>;
  /** null = settings.detail */
  detail: DetailLevel | null;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface UiState {
  connection: ConnectionStatus;
  connectionError: string | null;
  eventsState: EventConnectionState;
  health: HealthResponse | null;
  providersLoaded: boolean;
  workspacesLoaded: boolean;
  /** Loading providers/settings/workspaces failed (retry available). */
  loadError: string | null;
  conversationsStatus: LoadStatus;
  conversationStatus: LoadStatus;
  conversationError: { message: string; status: number } | null;

  /** Diagram shown by the conversation screen (resolved from the route). */
  currentGraphId: string | null;
  view: AppView;
  selection: { nodeId: string | null; edgeId: string | null };
  rightPanel: RightPanel | null;

  askPrefs: AskPrefs;
  /** null = default scope for the screen. */
  askScope: AskScope | null;
  /** Incremented to focus the ask input. */
  askFocus: number;
  askDraft: { text: string; nonce: number } | undefined;
  askBusy: boolean;

  sidebar: { open: boolean; tab: SidebarTab };
  outlineFilter: string;
  /** File/dir highlighted in the file explorer. */
  explorerRef: CodeRef | null;
  legendVisible: boolean;
  theme: Theme;
  resolvedTheme: 'light' | 'dark';

  toasts: Toast[];
  dialog: DialogState | null;
  modal: ModalRequest | null;
  paletteOpen: boolean;
}

export type AppState = DataState & UiState;
