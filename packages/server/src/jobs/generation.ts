/**
 * GenerationService: questions in, diagrams out.
 *
 * ask()/retry() create or reset a GraphEntry (status queued) and enqueue a job; the job builds the
 * GenerationTask (workspace, conversation path, parent diagram, overview + tree, code snippet),
 * runs the provider, normalizes the answer, validates its code refs and stores the result.
 * Status only moves forward within an attempt (queued -> running -> done|error|cancelled);
 * results of an attempt that was cancelled, retried or deleted meanwhile are discarded.
 * Live activity is kept in memory while running and the last 100 items are stored afterwards.
 */
import {
  ancestorsOf,
  descendantsOf,
  findNode,
  formatRef,
  getGraph,
  isPending,
  normalizeGraphSpec,
  parentIdOf,
  squish,
  truncate,
  type ActivityItem,
  type Conversation,
  type GraphEntry,
  type GraphOrigin,
  type GraphSpec,
  type ProviderId,
  type RetryBody,
  type Settings,
  type UpdateGraphBody,
  type Workspace,
} from '@codesplainer/shared';
import { buildPrompt } from '../agents/prompt';
import { GRAPH_OUTPUT_SCHEMA } from '../agents/schema';
import {
  AgentError,
  type ActivityInput,
  type AgentRunResult,
  type GenerationTask,
  type ProviderRegistry,
} from '../agents/types';
import { AUTO_TITLE_CHARS, DEFAULT_CONVERSATION_TITLE } from '../constants';
import { HttpError, badRequest, conflict, notFound } from '../errors';
import type { EventBus } from '../events';
import { readCodeSnippet } from '../fs/file';
import type { OverviewCache } from '../fs/overview';
import { normalizedRef, resolveCodeRef, resolveSpecRefs } from '../fs/refs';
import { newId } from '../ids';
import type { Logger } from '../log';
import type { ConversationStore } from '../storage/conversations';
import type { RunStore } from '../storage/runs';
import type { SettingsStore } from '../storage/settings';
import type { WorkspaceStore } from '../storage/workspaces';
import { laterIso, nowIso } from '../time';
import { JobQueue, type AbortReason } from './queue';

export const LIVE_ACTIVITY_LIMIT = 300;
export const STORED_ACTIVITY_LIMIT = 100;
const MAX_ERROR_CHARS = 1200;
const MAX_ACTIVITY_TEXT = 2000;

export interface GenerationDeps {
  conversations: ConversationStore;
  workspaces: WorkspaceStore;
  settings: SettingsStore;
  registry: ProviderRegistry;
  bus: EventBus;
  overview: OverviewCache;
  runs: RunStore;
  log: Logger;
}

/** Normalized ask request (askBodySchema output). */
export interface AskInput {
  question: string;
  origin: GraphOrigin;
  provider?: ProviderId;
  model?: string;
  detail?: GraphEntry['detail'];
}

/** A failure with a user-facing message (plus whatever the agent produced before failing). */
class GenerationError extends Error {
  constructor(
    message: string,
    readonly partial?: Partial<AgentRunResult>,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

interface LiveRun {
  attempt: number;
  items: ActivityItem[];
  lastTs: number;
}

type DoneParent = GraphEntry & { spec: GraphSpec };

const jobKey = (graphId: string, attempt: number) => `${graphId}#${attempt}`;
const oneLine = (text: string) => truncate(squish(text), MAX_ERROR_CHARS) || 'Unknown error.';
const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const repaired = (warnings: string[]) =>
  warnings.some((w) => /asked for a fix|repair round|parsed (?:its|the) text answer/i.test(w));

export class GenerationService {
  private readonly queue: JobQueue;
  private readonly live = new Map<string, LiveRun>();
  /** Job keys that must not fork the parent's agent session. */
  private readonly fresh = new Set<string>();
  private closing = false;

  constructor(private readonly deps: GenerationDeps) {
    this.queue = new JobQueue({
      concurrency: () => deps.settings.get().maxConcurrentJobs,
      timeoutMs: () => deps.settings.get().timeoutSec * 1000,
      onError: (key, e) => deps.log.error(`Generation job ${key} crashed`, e),
    });
  }

  // ---- lookups -------------------------------------------------------------------------------

  private conversation(id: string): Conversation {
    const conv = this.deps.conversations.get(id);
    if (!conv) throw notFound('Conversation');
    return conv;
  }

  private locate(
    conversationId: string,
    graphId: string,
  ): { conv: Conversation; entry: GraphEntry } {
    const conv = this.conversation(conversationId);
    const entry = getGraph(conv, graphId);
    if (!entry) throw notFound('Diagram');
    return { conv, entry };
  }

  private find(conversationId: string, graphId: string): GraphEntry | undefined {
    const conv = this.deps.conversations.get(conversationId);
    return conv ? getGraph(conv, graphId) : undefined;
  }

  /** Bump updatedAt, schedule a save and tell the clients. */
  private commit(conv: Conversation, entry?: GraphEntry): void {
    conv.updatedAt = laterIso(conv.updatedAt);
    this.deps.conversations.save(conv.id);
    if (entry) this.deps.bus.graphUpdated(conv.id, entry);
    this.deps.bus.conversationUpdated(conv);
  }

  private assertOpen(): void {
    if (this.closing) throw new HttpError(503, 'shutting_down', 'The server is shutting down.');
  }

  // ---- asking --------------------------------------------------------------------------------

  private parentFor(conv: Conversation, id: string): DoneParent {
    const parent = getGraph(conv, id);
    if (!parent) throw notFound('Parent diagram');
    if (parent.status !== 'done' || !parent.spec) {
      throw badRequest('The parent diagram has not finished yet.');
    }
    return parent as DoneParent;
  }

  /** Validate an origin against the conversation and fill in defaults (labels, question). */
  private async prepare(
    conv: Conversation,
    workspace: Workspace,
    origin: GraphOrigin,
    rawQuestion: string,
  ): Promise<{ origin: GraphOrigin; question: string }> {
    const question = rawQuestion.trim();
    const required = () => {
      if (!question) throw badRequest('Please enter a question.');
      return question;
    };
    switch (origin.type) {
      case 'question':
        return { origin: { type: 'question' }, question: required() };
      case 'expand':
      case 'ask-node': {
        const parent = this.parentFor(conv, origin.parentGraphId);
        const node = findNode(parent.spec, origin.nodeId);
        if (!node) throw notFound(`Box "${origin.nodeLabel || origin.nodeId}"`);
        const nodeLabel = origin.nodeLabel.trim() || node.label;
        if (origin.type === 'expand') {
          return { origin: { ...origin, nodeLabel }, question: question || `Expand: ${nodeLabel}` };
        }
        return { origin: { ...origin, nodeLabel }, question: required() };
      }
      case 'ask-graph':
        this.parentFor(conv, origin.parentGraphId);
        return {
          origin: { type: 'ask-graph', parentGraphId: origin.parentGraphId },
          question: required(),
        };
      case 'ask-code': {
        let parentGraphId: string | undefined;
        let nodeId: string | undefined;
        if (origin.parentGraphId) {
          const parent = this.parentFor(conv, origin.parentGraphId);
          parentGraphId = parent.id;
          if (origin.nodeId && findNode(parent.spec, origin.nodeId)) nodeId = origin.nodeId;
        }
        const target = await resolveCodeRef(origin.ref, workspace);
        if (!target) throw notFound(`"${origin.ref.path || '.'}"`);
        const ref = normalizedRef(origin.ref, target);
        return {
          origin: {
            type: 'ask-code',
            ref,
            ...(parentGraphId ? { parentGraphId } : {}),
            ...(nodeId ? { nodeId } : {}),
          },
          question: question || `Explain ${formatRef(ref, workspace.folders.length > 1)}`,
        };
      }
    }
  }

  async ask(conversationId: string, input: AskInput): Promise<GraphEntry> {
    this.assertOpen();
    const conv = this.conversation(conversationId);
    const workspace = this.deps.workspaces.get(conv.workspaceId);
    if (!workspace) throw notFound('Workspace');
    const settings = this.deps.settings.get();
    const { origin, question } = await this.prepare(conv, workspace, input.origin, input.question);
    // prepare() may have awaited the file system: make sure nothing was deleted meanwhile.
    if (this.deps.conversations.get(conv.id) !== conv) throw notFound('Conversation');
    const model = input.model?.trim() ?? '';
    const entry: GraphEntry = {
      id: newId(),
      origin,
      question,
      status: 'queued',
      provider: input.provider ?? settings.defaultProvider,
      ...(model ? { model } : {}),
      detail: input.detail ?? settings.detail,
      warnings: [],
      createdAt: nowIso(),
      activity: [],
      attempt: 1,
    };
    conv.graphs.push(entry);
    if (conv.title === DEFAULT_CONVERSATION_TITLE && origin.type === 'question') {
      conv.title = truncate(question, AUTO_TITLE_CHARS);
    }
    this.commit(conv, entry);
    this.enqueue(conv.id, entry, false);
    return structuredClone(entry);
  }

  retry(conversationId: string, graphId: string, body: RetryBody): GraphEntry {
    this.assertOpen();
    const { conv, entry } = this.locate(conversationId, graphId);
    if (isPending(entry.status)) throw conflict('This diagram is still being generated.');
    entry.attempt += 1;
    entry.status = 'queued';
    delete entry.spec;
    delete entry.error;
    delete entry.usage;
    delete entry.session;
    delete entry.startedAt;
    delete entry.completedAt;
    entry.warnings = [];
    entry.activity = [];
    if (body.provider && body.provider !== entry.provider) {
      entry.provider = body.provider;
      delete entry.model;
    }
    if (body.model !== undefined) {
      const model = body.model.trim();
      if (model) entry.model = model;
      else delete entry.model;
    }
    if (body.detail) entry.detail = body.detail;
    // The raw answer of the previous attempt is stale (deletes are ordered before later saves).
    void this.deps.runs.delete(graphId).catch(() => undefined);
    this.commit(conv, entry);
    this.enqueue(conv.id, entry, body.fresh === true);
    return structuredClone(entry);
  }

  cancel(conversationId: string, graphId: string): GraphEntry {
    const { conv, entry } = this.locate(conversationId, graphId);
    if (isPending(entry.status)) {
      this.queue.cancel(jobKey(entry.id, entry.attempt), 'cancelled');
      this.markCancelled(conv, entry);
    }
    return structuredClone(entry);
  }

  private markCancelled(conv: Conversation, entry: GraphEntry, error?: string): void {
    entry.status = 'cancelled';
    entry.completedAt = nowIso();
    if (error) entry.error = error;
    else delete entry.error;
    const live = this.live.get(entry.id);
    if (live && live.attempt === entry.attempt) {
      entry.activity = live.items.slice(-STORED_ACTIVITY_LIMIT);
      this.live.delete(entry.id);
    }
    this.commit(conv, entry);
  }

  /** Delete a diagram and everything created from it. Returns the deleted ids. */
  deleteGraph(conversationId: string, graphId: string): string[] {
    const { conv, entry } = this.locate(conversationId, graphId);
    const doomed = [entry, ...descendantsOf(conv, graphId)];
    for (const g of doomed) this.stopJob(g);
    const ids = doomed.map((g) => g.id);
    const set = new Set(ids);
    conv.graphs = conv.graphs.filter((g) => !set.has(g.id));
    for (const id of ids) void this.deps.runs.delete(id).catch(() => undefined);
    conv.updatedAt = laterIso(conv.updatedAt);
    this.deps.conversations.save(conv.id);
    this.deps.bus.emit({ type: 'graph.deleted', conversationId: conv.id, graphIds: ids });
    this.deps.bus.conversationUpdated(conv);
    return ids;
  }

  /** Rename / annotate / star a diagram. */
  updateGraph(conversationId: string, graphId: string, body: UpdateGraphBody): GraphEntry {
    const { conv, entry } = this.locate(conversationId, graphId);
    if (body.title !== undefined && entry.spec) entry.spec.title = body.title;
    if (body.note !== undefined) {
      if (body.note.trim()) entry.note = body.note;
      else delete entry.note;
    }
    if (body.starred !== undefined) {
      if (body.starred) entry.starred = true;
      else delete entry.starred;
    }
    this.commit(conv, entry);
    return structuredClone(entry);
  }

  private stopJob(entry: GraphEntry): void {
    if (!isPending(entry.status)) return;
    this.queue.cancel(jobKey(entry.id, entry.attempt), 'cancelled');
    this.live.delete(entry.id);
  }

  /** Stop the jobs of a conversation that is about to be deleted. */
  stopConversation(conv: Conversation): void {
    for (const g of conv.graphs) this.stopJob(g);
  }

  /** Full activity log: the live one while running, else the stored one. */
  activity(conversationId: string, graphId: string): ActivityItem[] {
    const { entry } = this.locate(conversationId, graphId);
    const live = this.live.get(graphId);
    if (live && live.attempt === entry.attempt && isPending(entry.status)) return [...live.items];
    return entry.activity;
  }

  /** The conversation as returned by the API (live activity filled in for running diagrams). */
  view(conv: Conversation): Conversation {
    const running = conv.graphs.some((g) => {
      const live = this.live.get(g.id);
      return live !== undefined && live.attempt === g.attempt && isPending(g.status);
    });
    if (!running) return conv;
    const copy = structuredClone(conv);
    for (const g of copy.graphs) {
      const live = this.live.get(g.id);
      if (live && live.attempt === g.attempt && isPending(g.status)) {
        g.activity = live.items.slice(-STORED_ACTIVITY_LIMIT);
      }
    }
    return copy;
  }

  /** Raw agent answer of the last failed / repaired run. */
  async rawOutput(conversationId: string, graphId: string): Promise<string | null> {
    const { entry } = this.locate(conversationId, graphId);
    return this.deps.runs.read(entry.id);
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  /** Entries left queued/running by a previous process can never finish: mark them failed. */
  repairInterrupted(): number {
    let count = 0;
    for (const conv of this.deps.conversations.all()) {
      let changed = false;
      for (const g of conv.graphs) {
        if (!isPending(g.status)) continue;
        g.status = 'error';
        g.error = 'Interrupted (server restarted)';
        g.completedAt ??= nowIso();
        changed = true;
        count++;
      }
      if (changed) {
        conv.updatedAt = laterIso(conv.updatedAt);
        this.deps.conversations.save(conv.id);
      }
    }
    return count;
  }

  /** Server shutdown: mark pending diagrams cancelled ("Server stopped") and abort their jobs. */
  shutdown(): void {
    this.closing = true;
    for (const conv of this.deps.conversations.all()) {
      for (const g of conv.graphs) {
        if (!isPending(g.status)) continue;
        this.queue.cancel(jobKey(g.id, g.attempt), 'shutdown');
        this.markCancelled(conv, g, 'Server stopped');
      }
    }
    this.queue.cancelAll('shutdown');
  }

  /** Wait (bounded) for running jobs to settle. */
  drain(timeoutMs?: number): Promise<void> {
    return this.queue.drain(timeoutMs);
  }

  get pendingJobs(): number {
    return this.queue.runningCount + this.queue.queuedCount;
  }

  /** Settings changed: a raised concurrency limit starts waiting jobs right away. */
  settingsChanged(): void {
    if (!this.closing) this.queue.reschedule();
  }

  // ---- running -------------------------------------------------------------------------------

  private enqueue(conversationId: string, entry: GraphEntry, fresh: boolean): void {
    const attempt = entry.attempt;
    const key = jobKey(entry.id, attempt);
    if (fresh) this.fresh.add(key);
    this.queue.enqueue(key, async (signal) => {
      try {
        await this.run(conversationId, entry.id, attempt, signal);
      } finally {
        this.fresh.delete(key);
      }
    });
  }

  private pushActivity(
    conversationId: string,
    graphId: string,
    live: LiveRun,
    input: ActivityInput,
  ) {
    // Strictly increasing timestamps keep the client's ordering and de-duplication stable.
    const t = Math.max(Date.now(), live.lastTs + 1);
    live.lastTs = t;
    const item: ActivityItem = {
      ts: new Date(t).toISOString(),
      kind: input.kind,
      text:
        input.text.length > MAX_ACTIVITY_TEXT ? input.text.slice(0, MAX_ACTIVITY_TEXT) : input.text,
      ...(input.path ? { path: input.path } : {}),
    };
    live.items.push(item);
    if (live.items.length > LIVE_ACTIVITY_LIMIT)
      live.items.splice(0, live.items.length - LIVE_ACTIVITY_LIMIT);
    this.deps.bus.emit({ type: 'graph.activity', conversationId, graphId, item });
  }

  private async buildTask(
    conv: Conversation,
    entry: GraphEntry,
    workspace: Workspace,
    settings: Settings,
  ): Promise<GenerationTask> {
    const conversation = structuredClone(conv);
    const graph = getGraph(conversation, entry.id) ?? structuredClone(entry);
    const parentId = parentIdOf(graph.origin);
    const parentEntry = parentId ? getGraph(conversation, parentId) : undefined;
    const parent = parentEntry?.status === 'done' && parentEntry.spec ? parentEntry : undefined;
    const task: GenerationTask = {
      workspace: structuredClone(workspace),
      conversation,
      graph,
      ...(parent ? { parent } : {}),
      ancestors: ancestorsOf(conversation, entry.id),
      settings,
    };
    try {
      const scan = await this.deps.overview.get(workspace);
      task.overview = scan.overview;
      task.tree = scan.tree;
    } catch (e) {
      this.deps.log.warn(`Workspace scan failed (${e instanceof Error ? e.message : String(e)}).`);
    }
    if (graph.origin.type === 'ask-code') {
      try {
        const target = await resolveCodeRef(graph.origin.ref, workspace);
        if (target && !target.isDir) {
          const snippet = await readCodeSnippet(target.real, graph.origin.ref);
          if (snippet) task.codeSnippet = snippet;
        }
      } catch {
        // The agent reads the file itself.
      }
    }
    return task;
  }

  private finish(conv: Conversation, entry: GraphEntry, live: LiveRun, error?: string): void {
    entry.status = error === undefined ? 'done' : 'error';
    entry.completedAt = nowIso();
    if (error !== undefined) entry.error = error;
    else delete entry.error;
    entry.activity = live.items.slice(-STORED_ACTIVITY_LIMIT);
    if (this.live.get(entry.id) === live) this.live.delete(entry.id);
    this.commit(conv, entry);
  }

  private async run(
    conversationId: string,
    graphId: string,
    attempt: number,
    signal: AbortSignal,
  ): Promise<void> {
    const conv = this.deps.conversations.get(conversationId);
    const entry = conv ? getGraph(conv, graphId) : undefined;
    if (!conv || !entry || entry.attempt !== attempt || entry.status !== 'queued') return;
    const settings = this.deps.settings.get();
    const timeoutSec = settings.timeoutSec;
    const started = Date.now();
    entry.status = 'running';
    entry.startedAt = nowIso();
    const live: LiveRun = { attempt, items: [], lastTs: 0 };
    this.live.set(graphId, live);
    this.commit(conv, entry);

    const current = () =>
      this.find(conversationId, graphId) === entry &&
      entry.attempt === attempt &&
      entry.status === 'running';
    const onActivity = (input: ActivityInput) => {
      if (current()) this.pushActivity(conversationId, graphId, live, input);
    };

    try {
      const workspace = this.deps.workspaces.get(conv.workspaceId);
      if (!workspace)
        throw new GenerationError('The workspace of this conversation no longer exists.');
      const info = await this.deps.registry.info(entry.provider, settings);
      if (!info.enabled) {
        throw new GenerationError(`${info.name} is disabled. Enable it in Settings → Providers.`);
      }
      if (!info.available) {
        throw new GenerationError(
          `${info.name} is not available${info.reason ? `: ${info.reason}` : '.'}`,
        );
      }
      const providerSettings = settings.providers[entry.provider];
      const model = entry.model || providerSettings.model || undefined;
      onActivity({ kind: 'status', text: `Starting ${info.name}${model ? ` (${model})` : ''}` });
      const task = await this.buildTask(conv, entry, workspace, settings);
      if (!current()) return;
      const parentSession = task.parent?.session;
      const forkSessionId =
        providerSettings.reuseSessions &&
        info.capabilities.fork &&
        parentSession?.provider === entry.provider &&
        !this.fresh.has(jobKey(graphId, attempt))
          ? parentSession.id
          : undefined;

      const result = await this.deps.registry.get(entry.provider).run({
        task,
        prompt: buildPrompt(task),
        outputSchema: GRAPH_OUTPUT_SCHEMA,
        folders: workspace.folders.map((f) => ({ alias: f.alias, path: f.path })),
        ...(model ? { model } : {}),
        providerSettings,
        settings,
        ...(forkSessionId ? { forkSessionId } : {}),
        timeoutMs: timeoutSec * 1000,
        signal,
        onActivity,
        validate: (output) => {
          const r = normalizeGraphSpec(output);
          return r.ok ? { ok: true } : { ok: false, error: r.error };
        },
      });
      if (!current()) return;
      const normalized = normalizeGraphSpec(result.output);
      if (!normalized.ok) {
        throw new GenerationError(`The answer is not a valid diagram: ${normalized.error}`, result);
      }
      const checked = await resolveSpecRefs(normalized.spec, workspace);
      if (repaired(result.warnings) && result.rawText) {
        await this.deps.runs.save(graphId, result.rawText).catch(() => undefined);
      }
      if (!current()) return;
      entry.spec = checked.spec;
      entry.usage = {
        ...result.usage,
        durationMs: result.usage?.durationMs ?? Date.now() - started,
      };
      if (result.session) entry.session = result.session;
      entry.warnings = unique([...normalized.warnings, ...checked.warnings, ...result.warnings]);
      this.finish(conv, entry, live);
    } catch (e) {
      if (!current()) return;
      const partial =
        e instanceof AgentError ? e.partial : e instanceof GenerationError ? e.partial : undefined;
      if (partial?.rawText)
        await this.deps.runs.save(graphId, partial.rawText).catch(() => undefined);
      if (!current()) return;
      if (partial?.usage) entry.usage = { ...partial.usage };
      if (partial?.session) entry.session = partial.session;
      if (partial?.warnings?.length) entry.warnings = unique(partial.warnings);
      const reason = signal.aborted ? (signal.reason as AbortReason | undefined) : undefined;
      const code = e instanceof AgentError ? e.code : undefined;
      if (reason === 'timeout' || code === 'timeout') {
        const message = `Timed out after ${timeoutSec} s`;
        this.pushActivity(conversationId, graphId, live, { kind: 'error', text: message });
        this.finish(conv, entry, live, message);
      } else if (reason !== undefined || code === 'cancelled') {
        this.markCancelled(conv, entry, reason === 'shutdown' ? 'Server stopped' : undefined);
      } else {
        const message = oneLine(e instanceof Error ? e.message : String(e));
        if (!(e instanceof AgentError || e instanceof GenerationError)) {
          this.deps.log.error(`Generation of ${graphId} failed unexpectedly`, e);
        }
        this.pushActivity(conversationId, graphId, live, { kind: 'error', text: message });
        this.finish(conv, entry, live, message);
      }
    }
  }
}
