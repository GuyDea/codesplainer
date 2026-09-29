/**
 * Conversation repository: one file per conversation (<dataDir>/conversations/<id>.json), all
 * loaded at startup and kept in memory. Services mutate the cached objects and call save(id);
 * writes are debounced (~300 ms) per conversation and flushed on shutdown.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationSchema, type Conversation } from '@codesplainer/shared';
import type { Logger } from '../log';
import { quarantine, removeFileSerialized, settled, writeFileSerialized } from './atomic';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOAD_CONCURRENCY = 16;

export class ConversationStore {
  private readonly items = new Map<string, Conversation>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly writes = new Set<Promise<void>>();
  private closed = false;

  private constructor(
    readonly dir: string,
    private readonly log: Logger,
    private readonly debounceMs: number,
  ) {}

  static async open(
    dataDir: string,
    log: Logger,
    opts: { debounceMs?: number } = {},
  ): Promise<ConversationStore> {
    const store = new ConversationStore(
      join(dataDir, 'conversations'),
      log,
      opts.debounceMs ?? 300,
    );
    await mkdir(store.dir, { recursive: true, mode: 0o700 });
    await store.loadAll();
    return store;
  }

  private fileOf(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async loadAll(): Promise<void> {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
    let index = 0;
    const worker = async () => {
      while (index < names.length) {
        const name = names[index++] as string;
        await this.loadOne(name);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, names.length) }, worker));
  }

  private async loadOne(name: string): Promise<void> {
    const path = join(this.dir, name);
    let reason: string;
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
      const parsed = conversationSchema.safeParse(raw);
      if (parsed.success && SAFE_ID.test(parsed.data.id)) {
        const conv = parsed.data;
        if (this.items.has(conv.id)) {
          this.log.warn(`conversations/${name}: duplicate conversation id ${conv.id}, skipped.`);
          return;
        }
        this.items.set(conv.id, conv);
        if (name !== `${conv.id}.json`) {
          // Keep one file per id: rewrite under the canonical name, drop the stray file.
          await this.saveNow(conv.id);
          await removeFileSerialized(path);
        }
        return;
      }
      reason = parsed.success ? 'invalid id' : (parsed.error.issues[0]?.message ?? 'invalid');
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    const moved = await quarantine(path);
    this.log.warn(
      `conversations/${name} is corrupted (${reason}); ${moved ? 'moved it aside' : 'skipped it'}.`,
    );
  }

  all(): Conversation[] {
    return [...this.items.values()];
  }

  list(workspaceId?: string): Conversation[] {
    const all = this.all();
    return workspaceId ? all.filter((c) => c.workspaceId === workspaceId) : all;
  }

  get(id: string): Conversation | undefined {
    return this.items.get(id);
  }

  /** Add a new conversation (saved right away). */
  async add(conversation: Conversation): Promise<void> {
    if (!SAFE_ID.test(conversation.id))
      throw new Error(`Invalid conversation id: ${conversation.id}`);
    this.items.set(conversation.id, conversation);
    await this.saveNow(conversation.id);
  }

  /** Schedule a debounced save of a (mutated) conversation. */
  save(id: string): void {
    if (this.closed || !this.items.has(id)) return;
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.saveNow(id).catch((e: unknown) =>
        this.log.error(`Could not save conversation ${id}`, e),
      );
    }, this.debounceMs);
    timer.unref();
    this.timers.set(id, timer);
  }

  /** Write a conversation now (cancels a pending debounced save). */
  saveNow(id: string): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    const conv = this.items.get(id);
    if (!conv || this.closed) return Promise.resolve();
    const write = writeFileSerialized(this.fileOf(id), JSON.stringify(conv));
    this.writes.add(write);
    const done = () => this.writes.delete(write);
    write.then(done, done);
    return write;
  }

  async delete(id: string): Promise<boolean> {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const existed = this.items.delete(id);
    if (SAFE_ID.test(id)) await removeFileSerialized(this.fileOf(id));
    return existed;
  }

  /** Write every pending change and wait for in-flight writes. */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    await Promise.allSettled(pending.map((id) => this.saveNow(id)));
    await Promise.allSettled([...this.writes]);
    await Promise.all([...this.items.keys()].map((id) => settled(this.fileOf(id))));
  }

  /** Flush, then ignore further saves (server shutdown). */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }
}
