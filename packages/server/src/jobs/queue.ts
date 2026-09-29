/**
 * FIFO job queue with a live concurrency limit (read from settings on every scheduling pass),
 * one AbortController per job and a safety timeout. Jobs are keyed by a unique string (one key
 * per generation attempt).
 */

/** Why a job's signal was aborted (AbortSignal.reason). */
export type AbortReason = 'cancelled' | 'timeout' | 'shutdown';

export interface QueueOptions {
  /** Max jobs running at once (read on every scheduling pass). */
  concurrency: () => number;
  /** Per-job time limit in ms (read when the job starts); the signal aborts with 'timeout'. */
  timeoutMs: () => number;
  /** Extra time granted beyond timeoutMs before the queue aborts (the job has its own timer). */
  graceMs?: number;
  onError?: (key: string, error: unknown) => void;
}

interface Waiting {
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
}

interface Running {
  controller: AbortController;
  done: Promise<void>;
}

export class JobQueue {
  private readonly waiting: Waiting[] = [];
  private readonly running = new Map<string, Running>();

  constructor(private readonly opts: QueueOptions) {}

  get runningCount(): number {
    return this.running.size;
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  enqueue(key: string, run: (signal: AbortSignal) => Promise<void>): void {
    if (this.has(key)) throw new Error(`Job ${key} is already queued or running.`);
    this.waiting.push({ key, run });
    this.pump();
  }

  has(key: string): boolean {
    return this.running.has(key) || this.waiting.some((w) => w.key === key);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  /** 1-based position among waiting jobs (undefined when not waiting). */
  position(key: string): number | undefined {
    const index = this.waiting.findIndex((w) => w.key === key);
    return index >= 0 ? index + 1 : undefined;
  }

  /** Dequeue a waiting job or abort a running one. */
  cancel(key: string, reason: AbortReason = 'cancelled'): 'dequeued' | 'aborted' | undefined {
    const index = this.waiting.findIndex((w) => w.key === key);
    if (index >= 0) {
      this.waiting.splice(index, 1);
      return 'dequeued';
    }
    const job = this.running.get(key);
    if (job) {
      if (!job.controller.signal.aborted) job.controller.abort(reason);
      return 'aborted';
    }
    return undefined;
  }

  /** Dequeue everything and abort running jobs. Returns the affected keys. */
  cancelAll(reason: AbortReason = 'shutdown'): string[] {
    const keys = this.waiting.map((w) => w.key);
    this.waiting.length = 0;
    for (const [key, job] of this.running) {
      keys.push(key);
      if (!job.controller.signal.aborted) job.controller.abort(reason);
    }
    return keys;
  }

  /** Wait until running jobs have settled (bounded). */
  async drain(timeoutMs = 10_000): Promise<void> {
    const all = Promise.allSettled([...this.running.values()].map((j) => j.done));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      all,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
  }

  /** Start waiting jobs if the (possibly raised) concurrency limit allows it. */
  reschedule(): void {
    this.pump();
  }

  private pump(): void {
    const limit = Math.max(1, Math.floor(this.opts.concurrency()) || 1);
    while (this.running.size < limit && this.waiting.length > 0) {
      this.start(this.waiting.shift() as Waiting);
    }
  }

  private start(job: Waiting): void {
    const controller = new AbortController();
    const limit = this.opts.timeoutMs() + (this.opts.graceMs ?? 30_000);
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort('timeout' satisfies AbortReason);
    }, limit);
    timer.unref();
    const done = (async () => {
      try {
        await job.run(controller.signal);
      } catch (e) {
        this.opts.onError?.(job.key, e);
      } finally {
        clearTimeout(timer);
        this.running.delete(job.key);
        this.pump();
      }
    })();
    this.running.set(job.key, { controller, done });
  }
}
