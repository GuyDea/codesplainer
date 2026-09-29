import { z } from 'zod';

/**
 * Agent providers. Each maps to a local CLI (or the offline demo generator).
 * - kiro:   Kiro CLI via the Agent Client Protocol (`kiro-cli acp`)
 * - claude: Claude Code (`claude -p --output-format stream-json`)
 * - codex:  OpenAI Codex CLI (`codex exec --json`)
 * - acp:    any user-configured ACP-compatible agent command (OpenCode, Gemini CLI, ...)
 * - mock:   offline demo generator built from the file tree (no AI, for trying the UI)
 */
export const PROVIDER_IDS = ['kiro', 'claude', 'codex', 'acp', 'mock'] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const providerModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const providerCapabilitiesSchema = z.object({
  /** Can branch an existing agent session so follow-ups reuse what the agent already read. */
  fork: z.boolean(),
  /** Can enforce a JSON schema on the final answer. */
  structuredOutput: z.boolean(),
  /** Reports cost (USD) or credits. */
  cost: z.boolean(),
  /** Streams tool activity while running. */
  streaming: z.boolean(),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

/** Runtime information about a provider (detection result + settings applied). */
export const providerInfoSchema = z.object({
  id: providerIdSchema,
  name: z.string(),
  description: z.string(),
  available: z.boolean(),
  enabled: z.boolean(),
  /** Resolved executable. */
  command: z.string().optional(),
  version: z.string().optional(),
  /** Why the provider is unavailable. */
  reason: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  models: z.array(providerModelSchema).default([]),
  defaultModel: z.string().optional(),
  capabilities: providerCapabilitiesSchema,
  experimental: z.boolean().default(false),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  kiro: 'Kiro CLI',
  claude: 'Claude Code',
  codex: 'Codex',
  acp: 'Custom ACP agent',
  mock: 'Demo (offline)',
};
