/**
 * Provider registry: one provider per PROVIDER_IDS entry, cached detection (keyed by the settings
 * that influence it, ~10 min TTL), smoke tests and child-process cleanup.
 * Adding a provider = one module under ./providers exporting a ProviderFactory + an entry below.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  formatDuration,
  type GraphEntry,
  type ProviderId,
  type ProviderInfo,
  type ProviderTestResponse,
  type Settings,
} from '@codesplainer/shared';
import type { ProviderContext, ProviderFactory } from './context';
import { ProcessTracker } from './process';
import { buildTestPrompt } from './prompt';
import { createAcpProvider } from './providers/acp';
import { createClaudeProvider } from './providers/claude';
import { createCodexProvider } from './providers/codex';
import { createKiroProvider } from './providers/kiro';
import { createMockProvider } from './providers/mock';
import { TEST_OUTPUT_SCHEMA } from './schema';
import {
  AgentError,
  type AgentProvider,
  type DetectedProvider,
  type GenerationTask,
  type ProviderRegistry,
  type RegistryDeps,
} from './types';
import { clip, errorMessage, isObject, toAgentError } from './util';

const FACTORIES: Record<ProviderId, ProviderFactory> = {
  kiro: createKiroProvider,
  claude: createClaudeProvider,
  codex: createCodexProvider,
  acp: createAcpProvider,
  mock: createMockProvider,
};

export const DETECTION_TTL_MS = 10 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 30 * 1000;
const TEST_TIMEOUT_MS = 120_000;

/** Settings that influence detection of a provider (cache key). */
function detectionKey(id: ProviderId, settings: Settings): string {
  const p = settings.providers[id];
  const parts: unknown[] = [p.command, p.enabled];
  if (id === 'codex') parts.push(p.unsafeNoSandbox);
  if (id === 'acp') parts.push(settings.acp.name, settings.acp.command, settings.acp.args);
  return JSON.stringify(parts);
}

function unavailable(id: ProviderId, reason: string): DetectedProvider {
  return {
    id,
    name: PROVIDER_LABELS[id],
    description: PROVIDER_LABELS[id],
    available: false,
    reason,
    warnings: [],
    models: [],
    capabilities: { fork: false, structuredOutput: false, cost: false, streaming: false },
    experimental: id === 'acp',
  };
}

function testTask(id: ProviderId, settings: Settings, folder: string): GenerationTask {
  const now = new Date().toISOString();
  const graph: GraphEntry = {
    id: 'provider-test',
    origin: { type: 'question' },
    question: 'Connectivity test',
    status: 'running',
    provider: id,
    detail: 'simple',
    warnings: [],
    createdAt: now,
    activity: [],
    attempt: 1,
  };
  return {
    workspace: {
      id: 'scratch',
      name: 'Scratch',
      folders: [{ alias: 'scratch', path: folder }],
      createdAt: now,
      updatedAt: now,
    },
    conversation: {
      id: 'provider-test',
      title: 'Provider test',
      workspaceId: 'scratch',
      createdAt: now,
      updatedAt: now,
      graphs: [graph],
    },
    graph,
    ancestors: [],
    settings,
  };
}

export function createProviderRegistry(deps: RegistryDeps): ProviderRegistry {
  const ctx: ProviderContext = {
    dataDir: deps.dataDir,
    tracker: new ProcessTracker(),
    homeDir: deps.homeDir ?? homedir(),
  };
  // Providers are wrapped so run() only ever rejects with an AgentError (fs errors included).
  const providers = new Map<ProviderId, AgentProvider>(
    PROVIDER_IDS.map((id) => {
      const p = FACTORIES[id](ctx);
      const wrapped: AgentProvider = {
        id: p.id,
        detect: (settings, opts) => p.detect(settings, opts),
        run: (req) =>
          p.run(req).catch((e: unknown) => {
            throw toAgentError(e, 'unknown');
          }),
      };
      return [id, wrapped];
    }),
  );
  const cache = new Map<
    ProviderId,
    { key: string; at: number; ttl: number; value: Promise<DetectedProvider> }
  >();

  const get = (id: ProviderId): AgentProvider => {
    const p = providers.get(id);
    if (!p) throw new AgentError('unavailable', `Unknown provider: ${String(id)}`);
    return p;
  };

  const detect = (
    id: ProviderId,
    settings: Settings,
    refresh: boolean,
  ): Promise<DetectedProvider> => {
    const key = detectionKey(id, settings);
    const hit = cache.get(id);
    if (hit && !refresh && hit.key === key && Date.now() - hit.at < hit.ttl) return hit.value;
    const value = (async () => {
      try {
        return await get(id).detect(settings, { refresh });
      } catch (e) {
        return unavailable(id, `Detection failed: ${clip(errorMessage(e), 300)}`);
      }
    })();
    const entry = { key, at: Date.now(), ttl: DETECTION_TTL_MS, value };
    cache.set(id, entry);
    // "Not available" is kept briefly only: the user may be installing or logging in right now.
    void value.then((d) => {
      if (!d.available) entry.ttl = UNAVAILABLE_TTL_MS;
    });
    return value;
  };

  const info = async (
    id: ProviderId,
    settings: Settings,
    refresh = false,
  ): Promise<ProviderInfo> => {
    const detected = await detect(id, settings, refresh);
    return { ...detected, enabled: settings.providers[id].enabled };
  };

  async function test(id: ProviderId, settings: Settings): Promise<ProviderTestResponse> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    try {
      const provider = get(id);
      let detected = await info(id, settings);
      // Testing is user-initiated: re-check a provider that looked unavailable.
      if (!detected.available) detected = await info(id, settings, true);
      if (!detected.available) {
        return {
          ok: false,
          provider: id,
          durationMs: elapsed(),
          message: detected.reason ?? 'Not available.',
        };
      }
      const scratch = join(ctx.dataDir, 'scratch');
      await mkdir(scratch, { recursive: true });
      await writeFile(
        join(scratch, 'README.md'),
        '# Scratch\n\nCodesplainer uses this folder for provider connectivity tests.\n',
        'utf8',
      );
      const providerSettings = settings.providers[id];
      const model = providerSettings.model || undefined;
      const validate = (output: unknown) =>
        isObject(output) && output.ok === true
          ? ({ ok: true } as const)
          : ({ ok: false, error: 'Expected exactly {"ok": true}.' } as const);
      const controller = new AbortController();
      const result = await provider.run({
        task: testTask(id, settings, scratch),
        prompt: buildTestPrompt(),
        outputSchema: TEST_OUTPUT_SCHEMA,
        folders: [{ alias: 'scratch', path: scratch }],
        ...(model ? { model } : {}),
        providerSettings,
        settings,
        timeoutMs: TEST_TIMEOUT_MS,
        signal: controller.signal,
        onActivity: () => undefined,
        validate,
        purpose: 'test',
      });
      const ok = validate(result.output).ok;
      const usedModel = result.usage?.model ?? model;
      return {
        ok,
        provider: id,
        durationMs: elapsed(),
        message: ok
          ? `Answered in ${formatDuration(elapsed())}${usedModel ? ` (${usedModel})` : ''}.`
          : 'The agent answered, but not with the expected JSON.',
        output: clip(result.rawText, 2000),
      };
    } catch (e) {
      const message = e instanceof AgentError ? e.message : `Test failed: ${errorMessage(e)}`;
      const raw = e instanceof AgentError ? e.partial?.rawText : undefined;
      return {
        ok: false,
        provider: id,
        durationMs: elapsed(),
        message: clip(message, 600),
        ...(raw ? { output: clip(raw, 2000) } : {}),
      };
    }
  }

  return {
    list: (settings, opts) =>
      Promise.all(PROVIDER_IDS.map((id) => info(id, settings, opts?.refresh ?? false))),
    info: (id, settings) => info(id, settings),
    get,
    test,
    async dispose() {
      await ctx.tracker.killAll();
    },
  };
}
