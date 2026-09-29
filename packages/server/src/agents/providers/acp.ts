/**
 * Any user-configured agent that speaks ACP over stdio (OpenCode `opencode acp`, Gemini CLI
 * `gemini --experimental-acp`, ...). Settings: settings.acp.{name, command, args, allowExecute}.
 * The agent gets no fs/terminal capabilities from us; its own read/search tools are approved,
 * shell execution only when allowExecute is on.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PROVIDER_LABELS, type ProviderModel, type Settings } from '@codesplainer/shared';
import { AcpClient, acpModels } from '../acp/client';
import { runAcpGeneration } from '../acp/runner';
import type { ProviderContext, ProviderFactory } from '../context';
import { binaryKey, listCandidates } from '../detect';
import {
  AgentError,
  type AgentRunRequest,
  type AgentRunResult,
  type DetectedProvider,
} from '../types';
import { childEnv, clip, ensureFolder, toAgentError, TtlCache } from '../util';

const CAPABILITIES = { fork: false, structuredOutput: false, cost: false, streaming: true };
const PROBE_TIMEOUT_MS = 15_000;

interface AgentProbe {
  models: ProviderModel[];
  currentModelId?: string;
  agentName?: string;
  version?: string;
  error?: string;
  auth?: boolean;
}

function configured(settings: Settings): { name: string; command: string; args: string[] } {
  return {
    name: settings.acp.name.trim() || PROVIDER_LABELS.acp,
    command: settings.acp.command.trim() || settings.providers.acp.command.trim(),
    args: settings.acp.args,
  };
}

export const createAcpProvider: ProviderFactory = (ctx: ProviderContext) => {
  const probes = new TtlCache<AgentProbe>(60 * 60 * 1000);

  async function resolve(command: string): Promise<string | undefined> {
    const found = await listCandidates({ names: [] }, { override: command, homeDir: ctx.homeDir });
    return found[0]?.path;
  }

  /** initialize + session/new in a scratch dir (no prompt): agent info and models. */
  async function probe(command: string, args: string[], refresh: boolean): Promise<AgentProbe> {
    const key = `${await binaryKey(command)}|${JSON.stringify(args)}`;
    return probes.get(
      key,
      async () => {
        const scratch = join(ctx.dataDir, 'scratch');
        await mkdir(scratch, { recursive: true });
        const client = new AcpClient({
          command,
          args,
          cwd: scratch,
          env: childEnv(),
          tracker: ctx.tracker,
          timeoutMs: PROBE_TIMEOUT_MS,
          label: 'ACP agent',
        });
        try {
          const init = await client.initialize();
          const info = init.agentInfo ?? {};
          const session = await client.newSession(scratch);
          return {
            models: acpModels(session.models),
            currentModelId: session.models?.currentModelId,
            agentName: info.title ?? info.name,
            version: info.version,
          };
        } catch (e) {
          const err = toAgentError(e, 'process');
          const info = client.initializeResult?.agentInfo;
          return {
            models: [],
            agentName: info?.title ?? info?.name,
            version: info?.version,
            error: clip(err.message, 300),
            auth: err.code === 'auth',
          };
        } finally {
          await client.close('done');
        }
      },
      refresh,
      (p) => !p.error,
    );
  }

  async function detect(settings: Settings, opts: { refresh: boolean }): Promise<DetectedProvider> {
    const cfg = configured(settings);
    const base: DetectedProvider = {
      id: 'acp',
      name: cfg.name,
      description:
        'Any agent that speaks the Agent Client Protocol over stdio (OpenCode, Gemini CLI, ...).',
      available: false,
      warnings: [],
      models: [],
      capabilities: CAPABILITIES,
      experimental: true,
    };
    if (!cfg.command) {
      return {
        ...base,
        reason:
          'No command configured. Set the agent command in settings, e.g. "opencode" with args ["acp"].',
      };
    }
    const command = await resolve(cfg.command);
    if (!command) return { ...base, reason: `Command "${cfg.command}" not found.` };
    const p = await probe(command, cfg.args, opts.refresh);
    const found: DetectedProvider = {
      ...base,
      command,
      ...(p.version ? { version: p.version } : {}),
      ...(p.agentName ? { description: `${p.agentName} over the Agent Client Protocol.` } : {}),
    };
    if (p.auth)
      return { ...found, reason: `The agent needs a login first: ${p.error ?? ''}`.trim() };
    if (p.error && !p.agentName)
      return { ...found, reason: `The agent did not answer the ACP handshake: ${p.error}` };
    const warnings = [
      'Read-only relies on the agent: Codesplainer rejects edit and shell permission requests, but tools the agent approves on its own are not seen.',
    ];
    if (p.error) warnings.push(`Handshake problem: ${p.error}`);
    return {
      ...found,
      available: true,
      warnings,
      models: p.models,
      ...(p.currentModelId ? { defaultModel: p.currentModelId } : {}),
    };
  }

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const cfg = configured(req.settings);
    if (!cfg.command) throw new AgentError('unavailable', 'No ACP agent command configured.');
    const command = await resolve(cfg.command);
    if (!command) throw new AgentError('unavailable', `Command "${cfg.command}" not found.`);
    const cwd = await ensureFolder(req.folders[0]?.path);
    const allow = new Set([
      'read',
      'search',
      'think',
      ...(req.settings.acp.allowExecute ? ['execute'] : []),
    ]);
    const model = req.model && req.model !== 'default' ? req.model : undefined;
    // Spawned from a neutral directory: agent config shipped inside the explained repository
    // (project agents, MCP servers) is not loaded at startup; the workspace goes to session/new.
    const home = join(ctx.dataDir, 'acp-home');
    await mkdir(home, { recursive: true });
    return runAcpGeneration({
      req,
      label: cfg.name,
      command,
      args: [...cfg.args, ...req.providerSettings.extraArgs],
      spawnCwd: home,
      sessionCwd: cwd,
      env: childEnv(),
      // ACP has no system prompt channel: the instructions lead the first message.
      promptText: `<instructions>\n${req.prompt.system}\n</instructions>\n\n${req.prompt.user}`,
      allowKinds: allow,
      ...(model ? { setModel: model } : {}),
      tracker: ctx.tracker,
    });
  }

  return { id: 'acp', detect, run };
};
