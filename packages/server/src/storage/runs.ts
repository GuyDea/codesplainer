/**
 * Raw agent answers (<dataDir>/runs/<graphId>.txt), kept for failed or repaired generations so
 * the user can inspect what the agent actually said (GET .../graphs/:gid/raw).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { removeFileSerialized, serialized, writeFileAtomic } from './atomic';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Raw answers are clipped to this many characters. */
export const MAX_RAW_CHARS = 2_000_000;

export class RunStore {
  constructor(readonly dir: string) {}

  private fileOf(graphId: string): string | undefined {
    return SAFE_ID.test(graphId) ? join(this.dir, `${graphId}.txt`) : undefined;
  }

  async save(graphId: string, text: string): Promise<void> {
    const file = this.fileOf(graphId);
    if (!file) return;
    const clipped = text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text;
    await serialized(file, () => writeFileAtomic(file, clipped));
  }

  async read(graphId: string): Promise<string | null> {
    const file = this.fileOf(graphId);
    if (!file) return null;
    try {
      return await serialized(file, () => readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  async delete(graphId: string): Promise<void> {
    const file = this.fileOf(graphId);
    if (file) await removeFileSerialized(file);
  }
}
