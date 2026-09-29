import { z } from 'zod';
import { DETAIL_LEVELS } from './kinds';
import { PROVIDER_IDS } from './providers';

/**
 * NOTE (zod 4): nested object defaults use `.prefault({})` so inner defaults are applied when the
 * key is missing. `.default({})` would short-circuit and return `{}` without parsing.
 */

export const providerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Override the executable (absolute path or command on PATH). Empty = auto-detect. */
  command: z.string().default(''),
  /** Model id/alias passed to the CLI. Empty = the CLI's default. */
  model: z.string().default(''),
  /** Extra CLI arguments appended verbatim. */
  extraArgs: z.array(z.string()).default([]),
  /** Fork the parent's agent session for expansions/follow-ups (faster, cheaper, more context). */
  reuseSessions: z.boolean().default(true),
  /** Use the CLI's JSON-schema enforcement for the final answer when supported. */
  structuredOutput: z.boolean().default(true),
  /** Reasoning effort hint (claude: --effort, codex: model_reasoning_effort). Empty = default. */
  effort: z.string().default(''),
  /**
   * Codex only: run without the OS sandbox. Needed on Linux hosts where bubblewrap cannot start.
   * The agent is still instructed to stay read-only, but nothing enforces it.
   */
  unsafeNoSandbox: z.boolean().default(false),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const acpAgentSettingsSchema = z.object({
  name: z.string().default('Custom ACP agent'),
  /** Executable that speaks ACP over stdio, e.g. "opencode" with args ["acp"]. */
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  /** Approve "execute" (shell) tool permission requests. Off = only read/search are approved. */
  allowExecute: z.boolean().default(false),
});
export type AcpAgentSettings = z.infer<typeof acpAgentSettingsSchema>;

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const settingsSchema = z.object({
  defaultProvider: z.enum(PROVIDER_IDS).default('kiro'),
  detail: z.enum(DETAIL_LEVELS).default('balanced'),
  maxConcurrentJobs: z.number().int().min(1).max(8).default(2),
  timeoutSec: z.number().int().min(30).max(7200).default(900),
  theme: z.enum(THEMES).default('system'),
  /** Language for labels/summaries. Empty = same language as the question. */
  answerLanguage: z.string().default(''),
  /** Editor command for "open in editor" (code, cursor, kiro, idea...). Empty = auto-detect. */
  editorCommand: z.string().default(''),
  /** Navigate to an expansion automatically when it finishes. */
  autoOpenExpansions: z.boolean().default(false),
  providers: z
    .object({
      kiro: providerSettingsSchema.prefault({}),
      claude: providerSettingsSchema.prefault({}),
      codex: providerSettingsSchema.prefault({}),
      acp: providerSettingsSchema.prefault({}),
      mock: providerSettingsSchema.prefault({}),
    })
    .prefault({}),
  acp: acpAgentSettingsSchema.prefault({}),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/*
 * Patch schemas are written out explicitly: in zod 4, `.partial()` over fields with `.default()`
 * still fills in the defaults for missing keys, which would silently reset unrelated settings.
 */
const providerSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  command: z.string().optional(),
  model: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  reuseSessions: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  effort: z.string().optional(),
  unsafeNoSandbox: z.boolean().optional(),
});

const acpAgentSettingsPatchSchema = z.object({
  name: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  allowExecute: z.boolean().optional(),
});

/** Deep-partial settings patch accepted by PUT /api/settings (merged server-side, then validated). */
export const settingsPatchSchema = z.object({
  defaultProvider: z.enum(PROVIDER_IDS).optional(),
  detail: z.enum(DETAIL_LEVELS).optional(),
  maxConcurrentJobs: z.number().int().min(1).max(8).optional(),
  timeoutSec: z.number().int().min(30).max(7200).optional(),
  theme: z.enum(THEMES).optional(),
  answerLanguage: z.string().optional(),
  editorCommand: z.string().optional(),
  autoOpenExpansions: z.boolean().optional(),
  providers: z
    .object({
      kiro: providerSettingsPatchSchema.optional(),
      claude: providerSettingsPatchSchema.optional(),
      codex: providerSettingsPatchSchema.optional(),
      acp: providerSettingsPatchSchema.optional(),
      mock: providerSettingsPatchSchema.optional(),
    })
    .optional(),
  acp: acpAgentSettingsPatchSchema.optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Drop keys whose value is undefined (so they never overwrite current values when spread). */
function defined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Merge a patch into settings (one level deep for providers/acp) and re-validate. */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const providers = { ...current.providers };
  for (const id of PROVIDER_IDS) {
    const p = patch.providers?.[id];
    if (p) providers[id] = { ...providers[id], ...defined(p) };
  }
  const { providers: _providers, acp, ...top } = patch;
  return settingsSchema.parse({
    ...current,
    ...defined(top),
    providers,
    acp: { ...current.acp, ...defined(acp) },
  });
}
