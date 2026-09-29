import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type Conversation } from '@codesplainer/shared';
import { memoryLogger } from '../src/log';
import {
  loadJsonFile,
  serialized,
  writeFileAtomic,
  writeFileSerialized,
} from '../src/storage/atomic';
import { ConversationStore } from '../src/storage/conversations';
import { RunStore } from '../src/storage/runs';
import { SettingsStore } from '../src/storage/settings';
import { WorkspaceStore } from '../src/storage/workspaces';
import { removeDir, tempDir } from './support';

let dir: string;
beforeEach(async () => {
  dir = await tempDir('cs-storage-');
});
afterEach(async () => {
  await removeDir(dir);
});

function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  const now = new Date().toISOString();
  return {
    id,
    title: 'T',
    workspaceId: 'w1',
    createdAt: now,
    updatedAt: now,
    graphs: [],
    ...patch,
  };
}

describe('atomic files', () => {
  it('writes atomically and leaves no temp files behind', async () => {
    const file = join(dir, 'nested', 'a.json');
    await writeFileAtomic(file, '{"a":1}');
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');
    await writeFileAtomic(file, '{"a":2}');
    expect(await readFile(file, 'utf8')).toBe('{"a":2}');
    expect(await readdir(join(dir, 'nested'))).toEqual(['a.json']);
  });

  it('serializes writes per path (last write wins)', async () => {
    const file = join(dir, 'b.json');
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileSerialized(file, String(i))));
    expect(await readFile(file, 'utf8')).toBe('19');
    const order: number[] = [];
    await Promise.all([
      serialized(file, async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      serialized(file, async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });

  it('moves corrupted files aside and starts fresh', async () => {
    const log = memoryLogger();
    const file = join(dir, 'c.json');
    expect(await loadJsonFile(file, (v) => v, log)).toBeUndefined();
    expect(log.lines).toEqual([]);
    await writeFile(file, '{ not json');
    expect(await loadJsonFile(file, (v) => v, log)).toBeUndefined();
    expect(log.lines[0]).toMatch(/c\.json is corrupted/);
    const names = await readdir(dir);
    expect(names.some((n) => n.startsWith('c.json.corrupt-'))).toBe(true);
    expect(names).not.toContain('c.json');
  });
});

describe('settings store', () => {
  it('starts with defaults, merges and persists updates', async () => {
    const log = memoryLogger();
    const store = await SettingsStore.open(dir, log);
    expect(store.get()).toEqual(defaultSettings());
    await store.update({ maxConcurrentJobs: 4, providers: { claude: { model: 'opus' } } });
    const again = await SettingsStore.open(dir, log);
    expect(again.get().maxConcurrentJobs).toBe(4);
    expect(again.get().providers.claude).toMatchObject({ model: 'opus', enabled: true });
    expect(again.get().providers.kiro.model).toBe('');
  });

  it('drops invalid values but keeps the rest', async () => {
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        maxConcurrentJobs: 99,
        theme: 'dark',
        providers: { codex: { extraArgs: [1] } },
      }),
    );
    const log = memoryLogger();
    const store = await SettingsStore.open(dir, log);
    expect(store.get().theme).toBe('dark');
    expect(store.get().maxConcurrentJobs).toBe(2);
    expect(store.get().providers.codex.extraArgs).toEqual([]);
    expect(log.lines.join('\n')).toMatch(/ignored invalid values/);
  });

  it('recovers from a corrupted settings file', async () => {
    await writeFile(join(dir, 'settings.json'), '<<<');
    const log = memoryLogger();
    const store = await SettingsStore.open(dir, log);
    expect(store.get()).toEqual(defaultSettings());
    expect((await readdir(dir)).some((n) => n.startsWith('settings.json.corrupt-'))).toBe(true);
  });
});

describe('workspace store', () => {
  it('persists workspaces and skips invalid entries', async () => {
    const log = memoryLogger();
    const store = await WorkspaceStore.open(dir, log);
    const now = new Date().toISOString();
    await store.put({
      id: 'w1',
      name: 'One',
      folders: [{ alias: 'a', path: '/a' }],
      createdAt: now,
      updatedAt: now,
    });
    const raw = JSON.parse(await readFile(join(dir, 'workspaces.json'), 'utf8')) as {
      workspaces: unknown[];
    };
    raw.workspaces.push({ id: 'broken' });
    await writeFile(join(dir, 'workspaces.json'), JSON.stringify(raw));
    const again = await WorkspaceStore.open(dir, log);
    expect(again.list().map((w) => w.id)).toEqual(['w1']);
    expect(log.lines.join('\n')).toMatch(/skipped 1 invalid workspace/);
  });
});

describe('conversation store', () => {
  it('loads all conversations, debounces saves and flushes', async () => {
    const log = memoryLogger();
    const store = await ConversationStore.open(dir, log, { debounceMs: 50 });
    await store.add(conversation('c1'));
    const conv = store.get('c1') as Conversation;
    conv.title = 'Renamed';
    store.save('c1');
    const file = join(dir, 'conversations', 'c1.json');
    expect(JSON.parse(await readFile(file, 'utf8')).title).toBe('T');
    await store.flush();
    expect(JSON.parse(await readFile(file, 'utf8')).title).toBe('Renamed');

    await writeFile(join(dir, 'conversations', 'bad.json'), '{"id": 1}');
    const again = await ConversationStore.open(dir, log);
    expect(again.all().map((c) => c.id)).toEqual(['c1']);
    expect(log.lines.join('\n')).toMatch(/bad\.json is corrupted/);
    expect(
      (await readdir(join(dir, 'conversations'))).some((n) => n.startsWith('bad.json.corrupt-')),
    ).toBe(true);

    await again.delete('c1');
    expect(await readdir(join(dir, 'conversations'))).not.toContain('c1.json');
  });

  it('ignores saves after close', async () => {
    const store = await ConversationStore.open(dir, memoryLogger(), { debounceMs: 5 });
    await store.add(conversation('c2'));
    await store.close();
    (store.get('c2') as Conversation).title = 'Late';
    store.save('c2');
    await new Promise((r) => setTimeout(r, 30));
    const file = join(dir, 'conversations', 'c2.json');
    expect(JSON.parse(await readFile(file, 'utf8')).title).toBe('T');
  });
});

describe('run store', () => {
  it('saves, reads and deletes raw outputs', async () => {
    const runs = new RunStore(join(dir, 'runs'));
    expect(await runs.read('g1')).toBeNull();
    await runs.save('g1', 'raw answer');
    expect(await runs.read('g1')).toBe('raw answer');
    await runs.delete('g1');
    expect(await runs.read('g1')).toBeNull();
    await mkdir(join(dir, 'runs'), { recursive: true });
    await runs.save('../escape', 'nope');
    expect(await readdir(dir)).not.toContain('escape.txt');
  });
});
