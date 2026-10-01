import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  makeFolderAliases,
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
  truncate,
  toPosixPath,
} from '../src';

describe('settings', () => {
  it('fills nested defaults', () => {
    const s = defaultSettings();
    expect(s.providers.claude.reuseSessions).toBe(true);
    expect(s.providers.codex.unsafeNoSandbox).toBe(false);
    expect(s.acp.allowExecute).toBe(false);
    expect(
      settingsSchema.parse({ providers: { claude: { model: 'opus' } } }).providers.claude,
    ).toMatchObject({
      model: 'opus',
      enabled: true,
    });
  });

  it('parses patches without filling in defaults', () => {
    const patch = settingsPatchSchema.parse({
      providers: { claude: { effort: 'high' } },
      acp: { command: 'x' },
    });
    expect(patch).toEqual({ providers: { claude: { effort: 'high' } }, acp: { command: 'x' } });
    const current = mergeSettings(defaultSettings(), { providers: { claude: { model: 'opus' } } });
    const merged = mergeSettings(current, patch);
    expect(merged.providers.claude).toMatchObject({ model: 'opus', effort: 'high' });
  });

  it('keeps run options safe to pass to a CLI', () => {
    expect(defaultSettings().providers.claude).toMatchObject({ effort: '', fast: false });
    // A hand-edited settings file with a bad effort still loads, with the CLI default.
    const loaded = settingsSchema.parse({ providers: { claude: { effort: 'High!' } } });
    expect(loaded.providers.claude.effort).toBe('');
    expect(settingsPatchSchema.safeParse({ providers: { codex: { effort: 'x y' } } }).success).toBe(
      false,
    );
  });

  it('merges patches one level deep', () => {
    const merged = mergeSettings(defaultSettings(), {
      detail: 'simple',
      providers: { codex: { unsafeNoSandbox: true } },
      acp: { command: 'opencode' },
    });
    expect(merged.detail).toBe('simple');
    expect(merged.providers.codex.unsafeNoSandbox).toBe(true);
    expect(merged.providers.codex.enabled).toBe(true);
    expect(merged.acp.command).toBe('opencode');
    expect(merged.acp.name).toBe('Custom ACP agent');
  });
});

describe('text helpers', () => {
  it('truncates at word boundaries', () => {
    expect(truncate('hello world again', 12)).toBe('hello world…');
    expect(truncate('short', 12)).toBe('short');
  });

  it('normalises paths', () => {
    expect(toPosixPath('./src\\a//b/')).toBe('src/a/b');
    expect(toPosixPath('.')).toBe('');
  });

  it('makes unique folder aliases', () => {
    expect(makeFolderAliases(['/a/app', '/b/app', '/c/My Lib!'])).toEqual([
      'app',
      'app-2',
      'My-Lib',
    ]);
    expect(makeFolderAliases(['/x/app'], ['app'])).toEqual(['app-2']);
  });
});
