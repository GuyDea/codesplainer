/**
 * OpenAI Codex CLI:
 *   codex exec --json -s read-only --skip-git-repo-check -C <folder> --output-schema <file>
 *              -o <last message file> [-m M] [-c model_reasoning_effort="E"] -
 * Forks: `codex exec fork <thread> -`, repair: `codex exec resume <thread> -` (both take the sandbox
 * via -c sandbox_mode=... and the working dir from the process cwd).
 *
 * Some Linux hosts cannot start Codex's bubblewrap sandbox; every command then fails and Codex
 * answers without reading code. Detection probes `codex sandbox true`; when broken the provider is
 * unavailable unless providerSettings.unsafeNoSandbox (danger-full-access, read-only by prompt only).
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROVIDER_LABELS,
  type ProviderModel,
  type Settings,
  type Usage,
} from '@codesplainer/shared';
import type { ProviderContext, ProviderFactory } from '../context';
import { binaryKey, codexPlatformDir, locateBinary, runProbe, type BinarySpec } from '../detect';
import { extractJson } from '../extract';
import { startProcess } from '../process';
import { buildRepairPrompt } from '../prompt';
import {
  AgentError,
  type AgentRunRequest,
  type AgentRunResult,
  type DetectedProvider,
} from '../types';
import {
  asNumber,
  asString,
  childEnv,
  classifyErrorText,
  clip,
  ensureFolder,
  errorMessage,
  firstLine,
  isObject,
  remaining,
  shortenPaths,
  stripAnsi,
  TtlCache,
} from '../util';

const IS_WINDOWS = process.platform === 'win32';

const SPEC: BinarySpec = {
  names: ['codex'],
  extensions: [
    {
      prefix: 'openai.chatgpt-',
      binaries: [join('bin', codexPlatformDir(), IS_WINDOWS ? 'codex.exe' : 'codex')],
    },
  ],
};

const CAPABILITIES = { fork: true, structuredOutput: true, cost: false, streaming: true };
const DESCRIPTION = 'OpenAI Codex CLI (codex exec) in a read-only sandbox.';
const STALE_TMP_MS = 24 * 60 * 60 * 1000;

export interface SandboxStatus {
  state: 'ok' | 'broken' | 'unknown';
  detail?: string;
}

interface CodexStatic {
  sandbox: SandboxStatus;
  loggedIn?: boolean;
  /** Enabled MCP servers (disabled per run: they are slow to start and unrelated). */
  mcpServers: string[];
}

export function codexHome(homeDir: string): string {
  return process.env.CODEX_HOME?.trim() || join(homeDir, '.codex');
}

/** Models from ~/.codex/models_cache.json (hidden ones skipped). Never throws. */
export async function readCodexModels(home: string): Promise<ProviderModel[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8'));
    const list =
      isObject(raw) && Array.isArray(raw.models) ? raw.models : Array.isArray(raw) ? raw : [];
    const out: ProviderModel[] = [];
    for (const m of list) {
      if (!isObject(m)) continue;
      const id = asString(m.slug) ?? asString(m.id) ?? asString(m.model);
      if (!id || m.visibility === 'hide' || m.visibility === 'hidden') continue;
      out.push({
        id,
        label: asString(m.display_name) ?? asString(m.displayName) ?? id,
        ...(asString(m.description) ? { description: asString(m.description) } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Top-level `model = "..."` of ~/.codex/config.toml (nothing else is read). */
export async function readCodexDefaultModel(home: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(home, 'config.toml'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) break; // first table: top-level keys are over
      const m = line.match(/^\s*model\s*=\s*["']([^"']+)["']/);
      if (m?.[1]) return m[1];
    }
  } catch {
    // no config
  }
  return undefined;
}

/** Names of MCP servers declared in config.toml (fallback when `codex mcp list --json` fails). */
async function mcpServersFromConfig(home: string): Promise<string[]> {
  try {
    const text = await readFile(join(home, 'config.toml'), 'utf8');
    const names = new Set<string>();
    for (const m of text.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)) {
      const name = m[1] ?? m[2];
      if (name) names.add(name);
    }
    return [...names];
  } catch {
    return [];
  }
}

const tomlKey = (name: string) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name));

/** Strip the `bash -lc '...'` wrapper Codex puts around commands. */
export function unwrapShell(command: unknown): string {
  const text = Array.isArray(command) ? command.map(String).join(' ') : String(command ?? '');
  const m = text.match(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+([\s\S]+)$/);
  if (!m?.[1]) return text;
  // Display only: drop the outer quotes and unescape inner double quotes.
  let inner = m[1].trim();
  if (/^["']/.test(inner)) inner = inner.slice(1);
  if (/["']$/.test(inner)) inner = inner.slice(0, -1);
  return inner.replace(/\\"/g, '"');
}

function parseAnswer(text: string): unknown {
  const value = extractJson(text);
  return value === undefined ? text : value;
}

async function cleanupStale(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      if (!name.startsWith('codex-')) continue;
      const p = join(dir, name);
      const s = await stat(p).catch(() => undefined);
      if (s && Date.now() - s.mtimeMs > STALE_TMP_MS) await rm(p, { recursive: true, force: true });
    }
  } catch {
    // nothing to clean
  }
}

export const createCodexProvider: ProviderFactory = (ctx: ProviderContext) => {
  const staticCache = new TtlCache<CodexStatic>(10 * 60 * 1000);
  let cleaned = false;

  const locate = (settings: Settings, refresh: boolean) =>
    locateBinary(SPEC, {
      override: settings.providers.codex.command,
      homeDir: ctx.homeDir,
      refresh,
      tracker: ctx.tracker,
    });

  async function probeSandbox(command: string): Promise<SandboxStatus> {
    if (IS_WINDOWS) return { state: 'unknown' };
    const r = await runProbe(command, ['sandbox', 'true'], {
      timeoutMs: 10_000,
      tracker: ctx.tracker,
      cwd: tmpdir(),
    });
    if (r.ok) return { state: 'ok' };
    const out = r.output;
    // Sandbox-specific failure markers (clap usage text also contains the word "sandbox").
    const sandboxError =
      /bubblewrap|bwrap|landlock|seccomp|seatbelt|sandbox-exec|mountinfo|namespace/i.test(out);
    const usageError = /unrecognized|unexpected argument|invalid value|usage:|not a valid/i.test(
      out,
    );
    if (r.timedOut || r.error || (usageError && !sandboxError)) {
      // Could not tell (old CLI without `sandbox`, slow start...): do not block Codex.
      return { state: 'unknown', detail: clip(firstLine(out) || r.error || '', 200) };
    }
    return { state: 'broken', detail: clip(firstLine(out) || `exit code ${r.code}`, 200) };
  }

  async function probeMcp(command: string): Promise<string[]> {
    const r = await runProbe(command, ['mcp', 'list', '--json'], {
      timeoutMs: 10_000,
      tracker: ctx.tracker,
      cwd: tmpdir(),
    });
    if (r.ok) {
      const start = r.output.indexOf('[');
      const end = r.output.lastIndexOf(']');
      let list: unknown;
      try {
        list = start >= 0 && end > start ? JSON.parse(r.output.slice(start, end + 1)) : undefined;
      } catch {
        list = undefined;
      }
      if (Array.isArray(list)) {
        return list
          .filter((s) => isObject(s) && typeof s.name === 'string' && s.enabled !== false)
          .map((s) => (s as { name: string }).name);
      }
    }
    return mcpServersFromConfig(codexHome(ctx.homeDir));
  }

  const statics = async (command: string, refresh: boolean): Promise<CodexStatic> =>
    staticCache.get(
      await binaryKey(command),
      async () => {
        const [sandbox, login, mcpServers] = await Promise.all([
          probeSandbox(command),
          runProbe(command, ['login', 'status'], {
            timeoutMs: 10_000,
            tracker: ctx.tracker,
            cwd: tmpdir(),
          }),
          probeMcp(command).catch(() => []),
        ]);
        return { sandbox, loggedIn: login.timedOut ? undefined : login.ok, mcpServers };
      },
      refresh,
      (s) => s.loggedIn !== false, // re-check until the user has logged in
    );

  async function detect(settings: Settings, opts: { refresh: boolean }): Promise<DetectedProvider> {
    const home = codexHome(ctx.homeDir);
    const [models, defaultModel] = await Promise.all([
      readCodexModels(home),
      readCodexDefaultModel(home),
    ]);
    const base: DetectedProvider = {
      id: 'codex',
      name: PROVIDER_LABELS.codex,
      description: DESCRIPTION,
      available: false,
      warnings: [],
      models,
      ...(defaultModel ? { defaultModel } : {}),
      capabilities: CAPABILITIES,
      experimental: false,
    };
    const loc = await locate(settings, opts.refresh);
    if (!loc.ok) {
      return {
        ...base,
        reason:
          loc.reason === 'not found'
            ? 'Codex CLI (codex) not found. Install it (npm install -g @openai/codex) or set its path in settings.'
            : loc.reason,
      };
    }
    const found = { ...base, command: loc.binary.path, version: loc.binary.version };
    const info = await statics(loc.binary.path, opts.refresh);
    const unsafe = settings.providers.codex.unsafeNoSandbox;
    const warnings: string[] = [];
    if (info.sandbox.state === 'broken') {
      if (!unsafe) {
        return {
          ...found,
          reason: `The Codex sandbox cannot start on this machine (${info.sandbox.detail}), so Codex could not read your code. Enable "Run without sandbox" in the Codex settings to use it anyway; it is then only instructed, not forced, to stay read-only.`,
        };
      }
      warnings.push(
        'Sandbox unavailable: Codex runs with full access and is only instructed to stay read-only.',
      );
    } else if (unsafe) {
      warnings.push(
        'Running without the sandbox (setting): Codex is only instructed to stay read-only.',
      );
    }
    if (info.loggedIn === false) warnings.push('Not logged in: run `codex login` in a terminal.');
    return { ...found, available: true, warnings };
  }

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const loc = await locate(req.settings, false);
    if (!loc.ok) throw new AgentError('unavailable', `Codex unavailable: ${loc.reason}`);
    const command = loc.binary.path;
    const ps = req.providerSettings;
    const cwd = await ensureFolder(req.folders[0]?.path);
    const info = await statics(command, false);
    if (info.sandbox.state === 'broken' && !ps.unsafeNoSandbox) {
      throw new AgentError(
        'unavailable',
        `The Codex sandbox cannot start on this machine (${info.sandbox.detail}).`,
      );
    }
    const sandbox = ps.unsafeNoSandbox ? 'danger-full-access' : 'read-only';
    const home = codexHome(ctx.homeDir);
    const model = req.model && req.model !== 'default' ? req.model : undefined;
    const effort = /^[a-z]+$/.test(ps.effort.trim()) ? ps.effort.trim() : undefined;
    const started = Date.now();
    const deadline = started + req.timeoutMs;
    const warnings: string[] = [];
    const usage: Usage = { model: model ?? (await readCodexDefaultModel(home)) };
    let threadId: string | undefined;

    const tmpRoot = join(ctx.dataDir, 'tmp');
    await mkdir(tmpRoot, { recursive: true });
    if (!cleaned) {
      cleaned = true;
      void cleanupStale(tmpRoot);
    }
    const dir = await mkdtemp(join(tmpRoot, 'codex-'));
    const schemaFile = join(dir, 'schema.json');
    await writeFile(schemaFile, JSON.stringify(req.outputSchema), 'utf8');
    let invocation = 0;

    const buildArgs = (
      mode: 'exec' | 'fork' | 'resume',
      session: string | undefined,
      lastFile: string,
    ) => {
      const common = ['--json', '--skip-git-repo-check'];
      if (ps.structuredOutput) common.push('--output-schema', schemaFile);
      common.push('-o', lastFile);
      if (model) common.push('-m', model);
      if (effort) common.push('-c', `model_reasoning_effort="${effort}"`);
      for (const name of info.mcpServers)
        common.push('-c', `mcp_servers.${tomlKey(name)}.enabled=false`);
      if (mode === 'exec')
        return ['exec', ...common, '-s', sandbox, '-C', cwd, ...ps.extraArgs, '-'];
      return [
        'exec',
        mode,
        ...common,
        '-c',
        `sandbox_mode="${sandbox}"`,
        ...ps.extraArgs,
        session ?? '',
        '-',
      ];
    };

    const invoke = async (
      mode: 'exec' | 'fork' | 'resume',
      session: string | undefined,
      prompt: string,
    ): Promise<{ output: unknown; rawText: string }> => {
      const lastFile = join(dir, `last-${++invocation}.txt`);
      let lastMessage = '';
      let failure: string | undefined;
      const errors: string[] = [];
      let touchedFiles = false;
      const changedPaths = new Set<string>();

      const onItem = (item: Record<string, unknown>, phase: 'started' | 'completed') => {
        switch (item.type) {
          case 'command_execution':
            if (phase === 'started') {
              const cmd = shortenPaths(unwrapShell(item.command), req.folders);
              req.onActivity({ kind: 'tool', text: clip(`Running ${cmd}`, 140) });
            }
            break;
          case 'reasoning':
            if (phase === 'completed') {
              const t = asString(item.text);
              if (t) req.onActivity({ kind: 'thinking', text: clip(firstLine(t) || t, 140) });
            }
            break;
          case 'agent_message':
            if (phase === 'completed') lastMessage = asString(item.text) ?? lastMessage;
            break;
          case 'mcp_tool_call':
            if (phase === 'started') {
              req.onActivity({
                kind: 'tool',
                text: `Using ${asString(item.server) ?? 'mcp'}.${asString(item.tool) ?? 'tool'}`,
              });
            }
            break;
          case 'web_search':
            if (phase === 'started')
              req.onActivity({
                kind: 'tool',
                text: clip(`Web search: ${asString(item.query) ?? ''}`, 140),
              });
            break;
          case 'file_change': {
            touchedFiles = true;
            const changes = Array.isArray(item.changes) ? item.changes : [];
            for (const c of changes) {
              const p = isObject(c) ? asString(c.path) : undefined;
              if (p) changedPaths.add(shortenPaths(p, req.folders));
            }
            req.onActivity({
              kind: 'warning',
              text: clip(`Codex changed files: ${[...changedPaths].join(', ') || '?'}`, 140),
            });
            if (ps.unsafeNoSandbox) void proc.kill('cancelled');
            break;
          }
          case 'error': {
            const msg = asString(item.message) ?? asString(item.text);
            if (msg && phase === 'completed') {
              errors.push(msg);
              req.onActivity({ kind: 'warning', text: clip(msg, 140) });
            }
            break;
          }
          default:
            break;
        }
      };

      const onLine = (line: string) => {
        if (!line.startsWith('{')) return;
        let ev: unknown;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (!isObject(ev)) return;
        switch (ev.type) {
          case 'thread.started':
            threadId = asString(ev.thread_id) ?? threadId;
            req.onActivity({
              kind: 'status',
              text: `Codex started${usage.model ? ` (${usage.model})` : ''}`,
            });
            break;
          case 'item.started':
          case 'item.completed':
            if (isObject(ev.item))
              onItem(ev.item, ev.type === 'item.started' ? 'started' : 'completed');
            break;
          case 'turn.completed': {
            const u = isObject(ev.usage) ? ev.usage : {};
            usage.inputTokens = (usage.inputTokens ?? 0) + (asNumber(u.input_tokens) ?? 0);
            usage.cachedTokens = (usage.cachedTokens ?? 0) + (asNumber(u.cached_input_tokens) ?? 0);
            usage.outputTokens = (usage.outputTokens ?? 0) + (asNumber(u.output_tokens) ?? 0);
            usage.turns = (usage.turns ?? 0) + 1;
            break;
          }
          case 'turn.failed':
            failure =
              (isObject(ev.error) ? asString(ev.error.message) : undefined) ?? 'Turn failed.';
            break;
          case 'error': {
            const msg = asString(ev.message);
            if (msg) {
              errors.push(msg);
              req.onActivity({ kind: 'warning', text: clip(msg, 140) });
            }
            break;
          }
          default:
            break;
        }
      };

      const proc = startProcess({
        command,
        args: buildArgs(mode, session, lastFile),
        cwd,
        env: childEnv(),
        stdin: prompt,
        onStdoutLine: onLine,
        timeoutMs: remaining(deadline),
        signal: req.signal,
        tracker: ctx.tracker,
      });
      const res = await proc.done;
      const partial = (): Partial<AgentRunResult> => ({
        rawText: lastMessage,
        usage: { ...usage, durationMs: Date.now() - started },
        warnings,
        ...(threadId ? { session: { provider: 'codex' as const, id: threadId } } : {}),
      });
      const changed = [...changedPaths].join(', ') || 'unknown files';
      if (touchedFiles && ps.unsafeNoSandbox) {
        // Without the sandbox the change is already on disk when we hear about it.
        throw new AgentError(
          'process',
          `Codex modified files despite the read-only instruction (${changed}); the run was stopped.`,
          partial(),
        );
      }
      if (touchedFiles)
        warnings.push(
          `Codex tried to change files (${changed}); the read-only sandbox should have blocked it.`,
        );
      if (res.cancelled) throw new AgentError('cancelled', 'Cancelled.', partial());
      if (res.timedOut) {
        throw new AgentError(
          'timeout',
          `Codex timed out after ${Math.round(req.timeoutMs / 1000)} s.`,
          partial(),
        );
      }
      if (res.spawnError)
        throw new AgentError('unavailable', `Could not start Codex: ${res.spawnError}`);

      const text = ((await readFile(lastFile, 'utf8').catch(() => '')) || lastMessage).trim();
      if (text && res.code === 0) return { output: parseAnswer(text), rawText: text };
      const stderr = stripAnsi(res.stderrTail).trim();
      const reason =
        failure ??
        errors[errors.length - 1] ??
        (stderr ? clip(stderr.split('\n').slice(-6).join(' '), 600) : '');
      const code = classifyErrorText(`${reason}\n${stderr}`) ?? 'process';
      throw new AgentError(
        code,
        `Codex failed${res.code !== null ? ` (exit code ${res.code})` : ''}${reason ? `: ${clip(reason, 600)}` : ''}`,
        partial(),
      );
    };

    try {
      const systemPart = `<instructions>\n${req.prompt.system}\n</instructions>\n\n`;
      let turn: { output: unknown; rawText: string };
      if (req.forkSessionId) {
        try {
          turn = await invoke('fork', req.forkSessionId, req.prompt.followUp ?? req.prompt.user);
        } catch (e) {
          // The parent thread may be gone (deleted, other machine): start fresh once.
          const noThread =
            threadId === undefined && e instanceof AgentError && e.code === 'process';
          if (!noThread || req.signal.aborted) throw e;
          warnings.push('Could not fork the parent session; started a fresh one.');
          req.onActivity({ kind: 'warning', text: 'Parent session unavailable, starting fresh' });
          turn = await invoke('exec', undefined, systemPart + req.prompt.user);
        }
      } else {
        turn = await invoke('exec', undefined, systemPart + req.prompt.user);
      }

      let { output, rawText } = turn;
      const check = req.validate(output);
      if (!check.ok && threadId) {
        warnings.push(`First answer was invalid (${clip(check.error, 200)}); asked for a fix.`);
        req.onActivity({ kind: 'status', text: 'Answer invalid, asking for a fix' });
        const fix = await invoke('resume', threadId, buildRepairPrompt(check.error));
        const again = req.validate(fix.output);
        if (again.ok || fix.rawText.trim()) {
          output = fix.output;
          rawText = fix.rawText;
        }
        if (!again.ok)
          warnings.push(`Answer still invalid after the repair round: ${clip(again.error, 200)}`);
      }
      usage.durationMs = Date.now() - started;
      return {
        output,
        rawText,
        ...(threadId ? { session: { provider: 'codex' as const, id: threadId } } : {}),
        usage,
        warnings,
      };
    } catch (e) {
      if (e instanceof AgentError) throw e;
      throw new AgentError(classifyErrorText(errorMessage(e)) ?? 'process', errorMessage(e));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { id: 'codex', detect, run };
};
