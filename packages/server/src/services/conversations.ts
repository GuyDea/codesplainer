/** Conversation CRUD (diagram generation itself lives in jobs/generation.ts). */
import {
  summarizeConversation,
  truncate,
  type Conversation,
  type ConversationSummary,
  type CreateConversationBody,
  type UpdateConversationBody,
} from '@codesplainer/shared';
import { DEFAULT_CONVERSATION_TITLE } from '../constants';
import { notFound } from '../errors';
import type { EventBus } from '../events';
import { newId } from '../ids';
import type { GenerationService } from '../jobs/generation';
import type { ConversationStore } from '../storage/conversations';
import type { RunStore } from '../storage/runs';
import type { WorkspaceStore } from '../storage/workspaces';
import { laterIso, nowIso } from '../time';
import { copyConversation } from './copy';

export interface ConversationDeps {
  conversations: ConversationStore;
  workspaces: WorkspaceStore;
  generation: GenerationService;
  runs: RunStore;
  bus: EventBus;
}

const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;

export class ConversationService {
  constructor(private readonly deps: ConversationDeps) {}

  private stored(id: string): Conversation {
    const conv = this.deps.conversations.get(id);
    if (!conv) throw notFound('Conversation');
    return conv;
  }

  list(workspaceId?: string): ConversationSummary[] {
    return this.deps.conversations.list(workspaceId).map(summarizeConversation).sort(newestFirst);
  }

  get(id: string): Conversation {
    return this.deps.generation.view(this.stored(id));
  }

  async create(body: CreateConversationBody): Promise<Conversation> {
    if (!this.deps.workspaces.get(body.workspaceId)) throw notFound('Workspace');
    const now = nowIso();
    const conv: Conversation = {
      id: newId(),
      title: body.title ?? DEFAULT_CONVERSATION_TITLE,
      workspaceId: body.workspaceId,
      createdAt: now,
      updatedAt: now,
      graphs: [],
    };
    await this.deps.conversations.add(conv);
    this.deps.bus.conversationUpdated(conv);
    return conv;
  }

  update(id: string, body: UpdateConversationBody): Conversation {
    const conv = this.stored(id);
    if (body.title !== undefined) conv.title = body.title;
    conv.updatedAt = laterIso(conv.updatedAt);
    this.deps.conversations.save(conv.id);
    this.deps.bus.conversationUpdated(conv);
    return this.deps.generation.view(conv);
  }

  async remove(id: string): Promise<void> {
    const conv = this.stored(id);
    this.deps.generation.stopConversation(conv);
    await this.deps.conversations.delete(conv.id);
    await Promise.all(conv.graphs.map((g) => this.deps.runs.delete(g.id).catch(() => undefined)));
    this.deps.bus.emit({
      type: 'conversation.deleted',
      conversationId: conv.id,
      workspaceId: conv.workspaceId,
    });
  }

  /** Delete every conversation of a workspace (the workspace itself is deleted by the caller). */
  async removeForWorkspace(workspaceId: string): Promise<number> {
    const list = this.deps.conversations.list(workspaceId);
    for (const conv of list) await this.remove(conv.id);
    return list.length;
  }

  async duplicate(id: string): Promise<Conversation> {
    const source = this.stored(id);
    const copy = copyConversation(source, {
      workspaceId: source.workspaceId,
      title: truncate(`${source.title} (copy)`, 200),
      pendingError: 'Not finished when duplicated.',
    });
    copy.createdAt = nowIso();
    await this.deps.conversations.add(copy);
    this.deps.bus.conversationUpdated(copy);
    return copy;
  }
}
