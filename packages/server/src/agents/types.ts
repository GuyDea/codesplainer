/**
 * Contract between the generation service (src/jobs) and agent providers (src/agents).
 * Providers turn a GenerationTask + prompt into a raw diagram answer; the generation service
 * normalizes it (normalizeGraphSpec), validates code refs and stores it.
 */
import type {
  ActivityKind,
  AgentSession,
  CodeRef,
  Conversation,
  GraphEntry,
  ProviderId,
  ProviderInfo,
  ProviderSettings,
  ProviderTestResponse,
  Settings,
  Usage,
  Workspace,
  WorkspaceOverview,
} from '@codesplainer/shared';

/** Everything known about the diagram being generated. Built by the generation service. */
export interface GenerationTask {
  workspace: Workspace;
  conversation: Conversation;
  /** The entry being generated (origin, question, detail, provider, model). */
  graph: GraphEntry;
  /** Parent diagram (status 'done' with a spec) when the origin has one. */
  parent?: GraphEntry;
  /** Root .. parent, excluding `graph` itself (for "altitude" context). */
  ancestors: GraphEntry[];
  settings: Settings;
  /** Workspace orientation. May be absent (scan failed / timed out). */
  overview?: WorkspaceOverview;
  /** Compact indented directory tree of all workspace folders (a few hundred lines max). */
  tree?: string;
  /** For 'ask-code' origins: the selected code, already read by the server. */
  codeSnippet?: { ref: CodeRef; text: string; language?: string };
}

export interface BuiltPrompt {
  /** Stable instructions (passed as system prompt / agent prompt where the CLI supports it). */
  system: string;
  /** The task: workspace, context, question. */
  user: string;
  /**
   * Compact variant of `user` for forked sessions: same task, without the workspace tree and
   * overview the agent already saw in the parent session. Providers fall back to `user`.
   */
  followUp?: string;
}

export interface ActivityInput {
  kind: ActivityKind;
  text: string;
  /** Absolute or folder-relative path touched by the activity. */
  path?: string;
}

/** Validates a candidate final answer. Providers use it to run one repair round on failure. */
export type ValidateOutput = (output: unknown) => { ok: true } | { ok: false; error: string };

export interface AgentRunRequest {
  task: GenerationTask;
  prompt: BuiltPrompt;
  /** JSON Schema of the final answer (see schema.ts), for CLIs with structured output. */
  outputSchema: Record<string, unknown>;
  /** Workspace folders. The first one is the agent's working directory. */
  folders: { alias: string; path: string }[];
  /** Resolved model: graph.model || providerSettings.model || undefined (CLI default). */
  model?: string;
  /** Reasoning effort / fast tier for this run; absent = providerSettings.effort / .fast. */
  effort?: string;
  fast?: boolean;
  providerSettings: ProviderSettings;
  settings: Settings;
  /** Fork this previous agent session of the same provider (already checked by the caller). */
  forkSessionId?: string;
  timeoutMs: number;
  signal: AbortSignal;
  onActivity: (item: ActivityInput) => void;
  validate: ValidateOutput;
  /** 'test' = provider smoke test (registry.test); the answer is TEST_OUTPUT_SCHEMA. Default 'diagram'. */
  purpose?: 'diagram' | 'test';
}

export interface AgentRunResult {
  /** Parsed final answer (usually an object). Falls back to the raw text when unparseable. */
  output: unknown;
  /** Final answer text as produced by the agent (kept for debugging). */
  rawText: string;
  /** Session that can be forked for follow-ups. */
  session?: AgentSession;
  usage?: Usage;
  warnings: string[];
}

/** Detection result; `enabled` is added by the registry from settings. */
export type DetectedProvider = Omit<ProviderInfo, 'enabled'>;

export interface AgentProvider {
  readonly id: ProviderId;
  /** Locate the CLI, read its version/models. Must not throw; report problems via `reason`. */
  detect(settings: Settings, opts: { refresh: boolean }): Promise<DetectedProvider>;
  /** Run one generation. Throws AgentError on failure. */
  run(req: AgentRunRequest): Promise<AgentRunResult>;
}

export interface ProviderRegistry {
  /** All providers, in PROVIDER_IDS order. Detection is cached; `refresh` re-detects. */
  list(settings: Settings, opts?: { refresh?: boolean }): Promise<ProviderInfo[]>;
  info(id: ProviderId, settings: Settings): Promise<ProviderInfo>;
  get(id: ProviderId): AgentProvider;
  /** Tiny smoke prompt run in a scratch directory. Never throws. */
  test(id: ProviderId, settings: Settings): Promise<ProviderTestResponse>;
  /** Kill running child processes (server shutdown). */
  dispose(): Promise<void>;
}

export interface RegistryDeps {
  /** Codesplainer data directory (e.g. ~/.codesplainer). Providers may keep files under it. */
  dataDir: string;
  /** Home directory used to discover CLIs (default: os.homedir()). Mainly for tests. */
  homeDir?: string;
}

export type AgentErrorCode =
  'unavailable' | 'timeout' | 'cancelled' | 'process' | 'parse' | 'auth' | 'rate_limit' | 'unknown';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  /** Partial result data collected before the failure (session, usage, raw text). */
  readonly partial?: Partial<AgentRunResult>;

  constructor(code: AgentErrorCode, message: string, partial?: Partial<AgentRunResult>) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.partial = partial;
  }
}
