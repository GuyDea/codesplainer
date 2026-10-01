/** Everything the routes need, wired up once by createApp(). */
import type { ProviderRegistry } from './agents/types';
import type { ServerConfig } from './config';
import type { EventBus, SseHub } from './events';
import type { IgnoreRulesCache } from './fs/ignore';
import type { OverviewCache } from './fs/overview';
import type { FolderPicker } from './fs/picker';
import type { GenerationService } from './jobs/generation';
import type { Logger } from './log';
import type { ConversationService } from './services/conversations';
import type { ExchangeService } from './services/exchange';
import type { WorkspaceService } from './services/workspaces';
import type { ConversationStore } from './storage/conversations';
import type { RunStore } from './storage/runs';
import type { SettingsStore } from './storage/settings';
import type { WorkspaceStore } from './storage/workspaces';

export interface AppStores {
  settings: SettingsStore;
  workspaces: WorkspaceStore;
  conversations: ConversationStore;
  runs: RunStore;
}

export interface AppContext {
  config: ServerConfig;
  log: Logger;
  bus: EventBus;
  hub: SseHub;
  registry: ProviderRegistry;
  stores: AppStores;
  overview: OverviewCache;
  ignoreRules: IgnoreRulesCache;
  generation: GenerationService;
  workspaces: WorkspaceService;
  conversations: ConversationService;
  exchange: ExchangeService;
  /** Native "choose folder" dialog (system dialogs, or the desktop app's own). */
  folderPicker: FolderPicker;
  /** Workspace made from the folders given on the command line (opened on first load). */
  startupWorkspaceId?: string;
}
