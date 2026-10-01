/**
 * Public contract of the panels module (src/panels): presentational building blocks of the
 * conversation screen. They hold only local UI state; all data and actions come through props.
 */
import type {
  ActivityItem,
  CodeRef,
  Conversation,
  DetailLevel,
  DirListing,
  FileContent,
  GraphEdge,
  GraphEntry,
  GraphNode,
  ProviderId,
  ProviderInfo,
  Workspace,
} from '@codesplainer/shared';

export interface RetryOptions {
  provider?: ProviderId;
  model?: string;
  detail?: DetailLevel;
  /** Start a fresh agent session instead of forking the parent's. */
  fresh?: boolean;
}

/** The discussion tree: every diagram of the conversation, nested by parent. */
export interface OutlineProps {
  conversation: Conversation;
  currentGraphId: string | null;
  onOpen: (graphId: string) => void;
  onRetry?: (graphId: string) => void;
  onCancel?: (graphId: string) => void;
  onDelete?: (graphId: string) => void;
  /**
   * Ask for confirmation (dialog mentioning the diagrams below) before calling onDelete.
   * Default false: the app's delete flow usually confirms itself.
   */
  confirmDelete?: boolean;
  onToggleStar?: (graphId: string, starred: boolean) => void;
  onRename?: (graphId: string, title: string) => void;
  /** Filter text (matches titles, questions and node labels); matching ancestors stay visible. */
  filter?: string;
  className?: string;
}

/** Path from the root question to the current diagram. */
export interface BreadcrumbsProps {
  /** Root .. current (inclusive). */
  path: GraphEntry[];
  onOpen: (graphId: string) => void;
  /** Max crumbs before the middle folds into a "…" menu (default 4, min 3). */
  maxItems?: number;
  className?: string;
}

export type DiagramExportFormat = 'png' | 'svg' | 'mermaid' | 'json';

/** Title row + meta + actions + the one/two sentence summary of a finished diagram. */
export interface DiagramHeaderProps {
  graph: GraphEntry;
  providers: ProviderInfo[];
  onRename: (title: string) => void;
  onRetry: (opts: RetryOptions) => void;
  onExport: (format: DiagramExportFormat) => void;
  onToggleStar: () => void;
  onDelete: () => void;
  onSaveNote: (note: string) => void;
  onShowActivity: () => void;
  /** Toggle the kind legend overlay. */
  legendVisible?: boolean;
  onToggleLegend?: () => void;
  /** Number of diagrams below this one (mentioned in the delete confirmation). */
  descendantCount?: number;
  /**
   * Show the built-in confirm dialog before onDelete (default true). Pass false when onDelete
   * already asks for confirmation.
   */
  confirmDelete?: boolean;
  className?: string;
}

export interface NodeInspectorProps {
  conversation: Conversation;
  /** Current diagram (status done, spec present). */
  graph: GraphEntry;
  node: GraphNode;
  multiFolder: boolean;
  onExpand: () => void;
  onAsk: () => void;
  onOpenRef: (ref: CodeRef) => void;
  onOpenInEditor: (ref: CodeRef) => void;
  onOpenGraph: (graphId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
  className?: string;
}

export interface EdgeInspectorProps {
  graph: GraphEntry;
  edge: GraphEdge;
  /** Show folder aliases in the arrow's code refs. */
  multiFolder?: boolean;
  /** Ask a follow-up that explains this interaction. */
  onExplain: () => void;
  /** Open one of the arrow's code refs (without it the "Code" section is hidden). */
  onOpenRef?: (ref: CodeRef) => void;
  onOpenInEditor?: (ref: CodeRef) => void;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
  className?: string;
}

export interface CodeViewerProps {
  /** null while loading or on error. */
  file: FileContent | null;
  loading: boolean;
  error?: string | null;
  /** Lines to highlight and scroll to (1-based, inclusive). */
  range?: { startLine: number; endLine?: number } | null;
  multiFolder: boolean;
  theme: 'light' | 'dark';
  onAskSelection: (selection: { startLine: number; endLine: number; text: string }) => void;
  onOpenInEditor: (line?: number) => void;
  onClose: () => void;
  className?: string;
}

export interface FileExplorerProps {
  workspace: Workspace;
  loadDir: (folder: string, path: string) => Promise<DirListing>;
  onOpenFile: (ref: CodeRef) => void;
  /** Ask a question about a file or directory. */
  onAskAbout: (ref: CodeRef) => void;
  activeRef?: CodeRef | null;
  className?: string;
}

export type AskScope =
  | { type: 'new' }
  | { type: 'graph'; graphId: string; title: string }
  | { type: 'node'; graphId: string; nodeId: string; nodeLabel: string }
  | { type: 'code'; ref: CodeRef; graphId?: string; nodeId?: string };

export interface AskBarProps {
  scope: AskScope;
  /** Scopes the user can switch between (new question / this diagram / selected box / code). */
  scopes: AskScope[];
  onScopeChange: (scope: AskScope) => void;
  providers: ProviderInfo[];
  provider: ProviderId;
  /** '' = provider default. */
  model: string;
  detail: DetailLevel;
  onProviderChange: (id: ProviderId) => void;
  onModelChange: (model: string) => void;
  onDetailChange: (detail: DetailLevel) => void;
  onSubmit: (question: string) => void | Promise<void>;
  busy?: boolean;
  /** Increment to focus the input (e.g. "/" shortcut). */
  focusSignal?: number;
  /** Prefill the input; applied whenever `nonce` changes. */
  draft?: { text: string; nonce: number };
  /** 'hero' = large centered input on the workspace home screen. */
  variant?: 'bar' | 'hero';
  placeholder?: string;
  /** Focus the input on mount. */
  autoFocus?: boolean;
  className?: string;
}

/** Live view while a diagram is queued/running. */
export interface ProgressViewProps {
  graph: GraphEntry;
  activity: ActivityItem[];
  providerName: string;
  /** 1-based position in the queue when queued. */
  queuePosition?: number;
  onCancel: () => void;
  className?: string;
}

/** Shown instead of the canvas for failed / cancelled diagrams. */
export interface ErrorViewProps {
  graph: GraphEntry;
  providers: ProviderInfo[];
  onRetry: (opts: RetryOptions) => void;
  onDelete: () => void;
  onShowRaw?: () => void;
  onOpenSettings?: () => void;
  className?: string;
}

export interface ActivityLogProps {
  items: ActivityItem[];
  /** Auto-scroll to the newest item. */
  live?: boolean;
  className?: string;
}
