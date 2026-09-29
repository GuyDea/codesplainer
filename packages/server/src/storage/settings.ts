/**
 * Settings repository: <dataDir>/settings.json, validated with settingsSchema, cached in memory.
 * Invalid individual values are dropped (defaults apply) instead of discarding the whole file.
 */
import { join } from 'node:path';
import { z } from 'zod';
import {
  PROVIDER_IDS,
  defaultSettings,
  mergeSettings,
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '@codesplainer/shared';
import { badRequest } from '../errors';
import type { Logger } from '../log';
import { loadJsonFile, settled, writeJsonSerialized } from './atomic';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Remove the value at `path` (arrays are removed as a whole). */
function dropPath(root: Json, path: readonly PropertyKey[]): boolean {
  const cut = path.findIndex((k) => typeof k === 'number');
  const keys = (cut >= 0 ? path.slice(0, cut) : path).map(String);
  if (!keys.length) return false;
  let node: unknown = root;
  for (const key of keys.slice(0, -1)) {
    if (!isObj(node)) return false;
    node = node[key];
  }
  if (!isObj(node)) return false;
  delete node[keys[keys.length - 1] as string];
  return true;
}

/** Parse settings, dropping invalid values. Throws when the file is not usable at all. */
export function parseSettingsLenient(raw: unknown): { settings: Settings; dropped: string[] } {
  if (!isObj(raw)) throw new Error('settings must be a JSON object');
  const first = settingsSchema.safeParse(raw);
  if (first.success) return { settings: first.data, dropped: [] };
  const copy = structuredClone(raw);
  const dropped: string[] = [];
  for (const issue of first.error.issues) {
    if (!dropPath(copy, issue.path)) throw new Error(z.prettifyError(first.error));
    dropped.push(issue.path.map(String).join('.'));
  }
  const second = settingsSchema.safeParse(copy);
  if (!second.success) throw new Error(z.prettifyError(second.error));
  return { settings: second.data, dropped: [...new Set(dropped)] };
}

/** Only the keys of `value` that were present in the raw input object `sent`. */
function sentKeys<T extends object>(value: T | undefined, sent: unknown): Partial<T> | undefined {
  if (!value || !isObj(sent)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => Object.hasOwn(sent, key)),
  ) as Partial<T>;
}

/**
 * The patch the client actually sent. settingsPatchSchema builds its nested provider/acp patches
 * with `.partial()` over schemas that have defaults, and zod 4 fills those defaults in for omitted
 * keys: `{ providers: { claude: { effort: 'high' } } }` parses to a full provider object, which
 * mergeSettings would write over the current model, extra args, etc. Keep the sent keys only.
 */
export function explicitSettingsPatch(parsed: SettingsPatch, raw: unknown): SettingsPatch {
  const input = isObj(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== 'providers' && key !== 'acp' && Object.hasOwn(input, key)) out[key] = value;
  }
  if (parsed.providers && isObj(input.providers)) {
    const sent = input.providers;
    const providers: NonNullable<SettingsPatch['providers']> = {};
    for (const id of PROVIDER_IDS) {
      const patch = sentKeys(parsed.providers[id], sent[id]);
      if (patch) providers[id] = patch;
    }
    out.providers = providers;
  }
  const acp = sentKeys(parsed.acp, input.acp);
  if (acp) out.acp = acp;
  return out as SettingsPatch;
}

export class SettingsStore {
  private current: Settings;

  private constructor(
    readonly path: string,
    settings: Settings,
  ) {
    this.current = settings;
  }

  static async open(dataDir: string, log: Logger): Promise<SettingsStore> {
    const path = join(dataDir, 'settings.json');
    const loaded = await loadJsonFile(path, parseSettingsLenient, log);
    const store = new SettingsStore(path, loaded?.settings ?? defaultSettings());
    if (loaded?.dropped.length) {
      log.warn(`settings.json: ignored invalid values (${loaded.dropped.join(', ')}).`);
      await store.save();
    }
    return store;
  }

  get(): Settings {
    return this.current;
  }

  /** Merge a validated patch, persist and return the new settings. */
  async update(patch: SettingsPatch): Promise<Settings> {
    let next: Settings;
    try {
      next = mergeSettings(this.current, patch);
    } catch (e) {
      throw badRequest(
        'Invalid settings.',
        e instanceof z.ZodError ? z.prettifyError(e) : String(e),
      );
    }
    this.current = next;
    await this.save();
    return next;
  }

  save(): Promise<void> {
    return writeJsonSerialized(this.path, this.current);
  }

  flush(): Promise<void> {
    return settled(this.path);
  }
}
