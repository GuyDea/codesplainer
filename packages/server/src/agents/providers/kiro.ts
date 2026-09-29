/**
 * Kiro CLI over ACP (`kiro-cli acp --agent codesplainer`).
 *
 * Kiro discovers workspace agents from the *process* cwd (`.kiro/agents/*.json`), so we keep a
 * private agent home under the data dir with a read-only agent (tools read/grep/glob, all
 * pre-approved, no MCP servers), spawn kiro-cli there and point session/new at the workspace.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROVIDER_LABELS,
  type ProviderModel,
  type Settings,
  type Usage,
} from '@codesplainer/shared';
import { runAcpGeneration } from '../acp/runner';
import { AcpClient, acpModels } from '../acp/client';
import type { ProviderContext, ProviderFactory } from '../context';
import { binaryKey, locateBinary, type BinarySpec } from '../detect';
import { SYSTEM_PROMPT } from '../prompt';
import {
  AgentError,
  type AgentRunRequest,
  type AgentRunResult,
  type DetectedProvider,
} from '../types';
import {
  asNumber,
  childEnv,
  clip,
  ensureFolder,
  errorMessage,
  isObject,
  toAgentError,
  TtlCache,
} from '../util';

export const KIRO_AGENT_NAME = 'codesplainer';
const KIRO_TOOLS = ['read', 'grep', 'glob'];
const MODELS_TTL_MS = 60 * 60 * 1000;
const MODELS_PROBE_TIMEOUT_MS = 20_000;

const SPEC: BinarySpec = {
  names: ['kiro-cli'],
  extraPaths: ['/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli'],
};

const CAPABILITIES = { fork: false, structuredOutput: false, cost: false, streaming: true };
const DESCRIPTION = 'Kiro CLI over the Agent Client Protocol, limited to read, grep and glob.';

interface ModelsProbe {
  models: ProviderModel[];
  currentModelId?: string;
  error?: string;
  auth?: boolean;
}

/** Kiro agent config for Codesplainer (read-only tools, everything pre-approved, no MCP). */
export function kiroAgentConfig(system: string): Record<string, unknown> {
  return {
    name: KIRO_AGENT_NAME,
    description:
      'Codesplainer diagram agent (read-only). Managed by Codesplainer; edits are overwritten.',
    prompt: system,
    mcpServers: {},
    tools: KIRO_TOOLS,
    toolAliases: {},
    allowedTools: KIRO_TOOLS,
    resources: [],
    hooks: {},
    toolsSettings: {},
    includeMcpJson: false,
    model: null,
  };
}

export const createKiroProvider: ProviderFactory = (ctx: ProviderContext) => {
  const kiroHome = join(ctx.dataDir, 'kiro-home');
  const agentFile = join(kiroHome, '.kiro', 'agents', `${KIRO_AGENT_NAME}.json`);
  const modelsFile = join(ctx.dataDir, 'cache', 'kiro-models.json');
  const modelCache = new TtlCache<ModelsProbe>(MODELS_TTL_MS);
  let writes: Promise<unknown> = Promise.resolve();

  /** Write (or refresh) the agent config when its content changed. Serialized, atomic via rename. */
  function ensureAgent(system: string): Promise<void> {
    const content = `${JSON.stringify(kiroAgentConfig(system), null, 2)}\n`;
    const task = writes.then(async () => {
      const current = await readFile(agentFile, 'utf8').catch(() => '');
      if (current === content) return;
      await mkdir(join(kiroHome, '.kiro', 'agents'), { recursive: true });
      const tmp = `${agentFile}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, agentFile);
    });
    writes = task.catch(() => undefined);
    return task;
  }

  const locate = (settings: Settings, refresh: boolean) =>
    locateBinary(SPEC, {
      override: settings.providers.kiro.command,
      homeDir: ctx.homeDir,
      refresh,
      tracker: ctx.tracker,
    });

  /** initialize + session/new in a scratch dir, then kill: lists models without using credits. */
  async function probeModels(command: string): Promise<ModelsProbe> {
    await ensureAgent(SYSTEM_PROMPT);
    const scratch = join(ctx.dataDir, 'scratch');
    await mkdir(scratch, { recursive: true });
    const client = new AcpClient({
      command,
      args: ['acp', '--agent', KIRO_AGENT_NAME],
      cwd: kiroHome,
      env: childEnv(),
      tracker: ctx.tracker,
      timeoutMs: MODELS_PROBE_TIMEOUT_MS,
      label: PROVIDER_LABELS.kiro,
    });
    try {
      await client.initialize();
      const session = await client.newSession(scratch);
      return { models: acpModels(session.models), currentModelId: session.models?.currentModelId };
    } catch (e) {
      const err = toAgentError(e, 'process');
      return { models: [], error: clip(err.message, 300), auth: err.code === 'auth' };
    } finally {
      await client.close('done');
    }
  }

  async function models(command: string, refresh: boolean): Promise<ModelsProbe> {
    const key = await binaryKey(command);
    return modelCache.get(
      key,
      async () => {
        if (!refresh) {
          try {
            const disk: unknown = JSON.parse(await readFile(modelsFile, 'utf8'));
            if (
              isObject(disk) &&
              disk.key === key &&
              typeof disk.at === 'number' &&
              Date.now() - disk.at < MODELS_TTL_MS &&
              Array.isArray(disk.models)
            ) {
              return {
                models: disk.models as ProviderModel[],
                currentModelId:
                  typeof disk.currentModelId === 'string' ? disk.currentModelId : undefined,
              };
            }
          } catch {
            // no usable disk cache
          }
        }
        const probe = await probeModels(command);
        if (!probe.error && probe.models.length) {
          await mkdir(join(ctx.dataDir, 'cache'), { recursive: true }).catch(() => undefined);
          await writeFile(
            modelsFile,
            JSON.stringify({
              key,
              at: Date.now(),
              currentModelId: probe.currentModelId,
              models: probe.models,
            }),
          ).catch(() => undefined);
        }
        return probe;
      },
      refresh,
      (probe) => !probe.error, // failures (e.g. not logged in yet) are retried next time
    );
  }

  async function detect(settings: Settings, opts: { refresh: boolean }): Promise<DetectedProvider> {
    const base: DetectedProvider = {
      id: 'kiro',
      name: PROVIDER_LABELS.kiro,
      description: DESCRIPTION,
      available: false,
      warnings: [],
      models: [],
      capabilities: CAPABILITIES,
      experimental: false,
    };
    const loc = await locate(settings, opts.refresh);
    if (!loc.ok) {
      return {
        ...base,
        reason:
          loc.reason === 'not found'
            ? 'Kiro CLI (kiro-cli) not found. Install it from https://kiro.dev/cli or set its path in settings.'
            : loc.reason,
      };
    }
    const found = { ...base, command: loc.binary.path, version: loc.binary.version };
    const probe = await models(loc.binary.path, opts.refresh).catch((e): ModelsProbe => ({
      models: [],
      error: errorMessage(e),
    }));
    if (probe.auth) {
      return {
        ...found,
        reason: 'Not logged in. Run `kiro-cli login` in a terminal, then refresh.',
      };
    }
    return {
      ...found,
      available: true,
      warnings: probe.error ? [`Could not list models: ${probe.error}`] : [],
      models: probe.models,
      defaultModel: probe.currentModelId ?? 'auto',
    };
  }

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const loc = await locate(req.settings, false);
    if (!loc.ok) throw new AgentError('unavailable', `Kiro CLI unavailable: ${loc.reason}`);
    const cwd = await ensureFolder(req.folders[0]?.path);
    await ensureAgent(req.prompt.system);
    const model = req.model && req.model !== 'default' ? req.model : undefined;
    return runAcpGeneration({
      req,
      label: PROVIDER_LABELS.kiro,
      command: loc.binary.path,
      args: [
        'acp',
        '--agent',
        KIRO_AGENT_NAME,
        ...(model ? ['--model', model] : []),
        ...req.providerSettings.extraArgs,
      ],
      spawnCwd: kiroHome,
      sessionCwd: cwd,
      env: childEnv(),
      promptText: req.prompt.user,
      allowKinds: new Set(['read', 'search']),
      tracker: ctx.tracker,
      onVendorNotification: (method, params, usage: Usage) => {
        if (!method.startsWith('_kiro.dev/metadata') || !isObject(params)) return;
        for (const [k, v] of Object.entries(params)) {
          const n = asNumber(v);
          if (n !== undefined && /credit/i.test(k)) usage.credits = n;
        }
      },
    });
  }

  return { id: 'kiro', detect, run };
};
