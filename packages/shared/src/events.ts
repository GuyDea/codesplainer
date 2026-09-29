import type { ActivityItem, ConversationSummary, GraphEntry } from './conversation';
import type { ProviderInfo } from './providers';
import type { Settings } from './settings';
import type { Workspace } from './workspace';

/**
 * Server-sent events on GET /api/events. Each SSE message has `event: <type>` and `data: <json>`.
 * The server sends `hello` on connect and a comment heartbeat every 20 s.
 * `graph.updated` carries the entry without `activity` and `session` (see stripGraphEntry);
 * live activity arrives as individual `graph.activity` events.
 */
export type ServerEvent =
  | { type: 'hello'; version: string; serverTime: string }
  | { type: 'graph.updated'; conversationId: string; graph: GraphEntry }
  | { type: 'graph.activity'; conversationId: string; graphId: string; item: ActivityItem }
  | { type: 'graph.deleted'; conversationId: string; graphIds: string[] }
  | { type: 'conversation.updated'; conversation: ConversationSummary }
  | { type: 'conversation.deleted'; conversationId: string; workspaceId: string }
  | { type: 'workspace.updated'; workspace: Workspace }
  | { type: 'workspace.deleted'; workspaceId: string }
  | { type: 'providers.updated'; providers: ProviderInfo[] }
  | { type: 'settings.updated'; settings: Settings };

export type ServerEventType = ServerEvent['type'];

export const SERVER_EVENT_TYPES: ServerEventType[] = [
  'hello',
  'graph.updated',
  'graph.activity',
  'graph.deleted',
  'conversation.updated',
  'conversation.deleted',
  'workspace.updated',
  'workspace.deleted',
  'providers.updated',
  'settings.updated',
];
