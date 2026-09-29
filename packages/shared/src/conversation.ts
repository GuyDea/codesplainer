import { z } from 'zod';
import { codeRefSchema, graphSpecSchema } from './graph';
import { DETAIL_LEVELS } from './kinds';
import { providerIdSchema } from './providers';

/**
 * How a diagram came to be. Everything except `question` has a parent diagram, which is what
 * makes a conversation a tree (shown in the outline and on the conversation map).
 */
export const graphOriginSchema = z.discriminatedUnion('type', [
  /** A new top-level question. */
  z.object({ type: z.literal('question') }),
  /** "Explain & expand" a box: a deeper diagram of one node's internals. */
  z.object({
    type: z.literal('expand'),
    parentGraphId: z.string(),
    nodeId: z.string(),
    nodeLabel: z.string(),
  }),
  /** A custom question about one node. */
  z.object({
    type: z.literal('ask-node'),
    parentGraphId: z.string(),
    nodeId: z.string(),
    nodeLabel: z.string(),
  }),
  /** A follow-up question about a whole diagram. */
  z.object({ type: z.literal('ask-graph'), parentGraphId: z.string() }),
  /** A question about a code selection (optionally reached from a diagram node). */
  z.object({
    type: z.literal('ask-code'),
    ref: codeRefSchema,
    parentGraphId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
]);
export type GraphOrigin = z.infer<typeof graphOriginSchema>;
export type GraphOriginType = GraphOrigin['type'];

export const GRAPH_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const;
export const graphStatusSchema = z.enum(GRAPH_STATUSES);
export type GraphStatus = z.infer<typeof graphStatusSchema>;

export const usageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  costUsd: z.number().optional(),
  credits: z.number().optional(),
  durationMs: z.number().optional(),
  turns: z.number().optional(),
  model: z.string().optional(),
});
export type Usage = z.infer<typeof usageSchema>;

export const ACTIVITY_KINDS = [
  'status',
  'tool',
  'message',
  'thinking',
  'warning',
  'error',
] as const;
export const activityItemSchema = z.object({
  ts: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  text: z.string(),
  /** File or directory the activity touched (absolute or folder-relative). */
  path: z.string().optional(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
export type ActivityKind = ActivityItem['kind'];

export const agentSessionSchema = z.object({
  provider: providerIdSchema,
  id: z.string(),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;

/** One diagram in a conversation, including its generation state. */
export const graphEntrySchema = z.object({
  id: z.string(),
  origin: graphOriginSchema,
  /** User-visible question ("Expand: API server" for expansions). */
  question: z.string(),
  status: graphStatusSchema,
  provider: providerIdSchema,
  model: z.string().optional(),
  detail: z.enum(DETAIL_LEVELS),
  spec: graphSpecSchema.optional(),
  error: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  usage: usageSchema.optional(),
  /** Agent session that produced this diagram (used to fork follow-ups). Machine specific. */
  session: agentSessionSchema.optional(),
  /** Recent agent activity (trimmed). */
  activity: z.array(activityItemSchema).default([]),
  /** Free-form user note. */
  note: z.string().optional(),
  starred: z.boolean().optional(),
  /** Number of generation attempts (retries increment it). */
  attempt: z.number().int().positive().default(1),
});
export type GraphEntry = z.infer<typeof graphEntrySchema>;

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  graphs: z.array(graphEntrySchema).default([]),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  graphCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  lastQuestion: z.string().optional(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export function summarizeConversation(c: Conversation): ConversationSummary {
  const questions = c.graphs.filter((g) => g.origin.type !== 'expand');
  return {
    id: c.id,
    title: c.title,
    workspaceId: c.workspaceId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    graphCount: c.graphs.length,
    runningCount: c.graphs.filter((g) => g.status === 'queued' || g.status === 'running').length,
    lastQuestion: questions[questions.length - 1]?.question,
  };
}

export function isPending(status: GraphStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** Strip heavy/machine-specific fields (used for SSE payloads and exports). */
export function stripGraphEntry(
  entry: GraphEntry,
  opts: { activity?: boolean; session?: boolean } = {},
): GraphEntry {
  const copy: GraphEntry = { ...entry };
  if (!opts.activity) copy.activity = [];
  if (!opts.session) delete copy.session;
  return copy;
}
