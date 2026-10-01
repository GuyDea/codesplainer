/**
 * Claude Code in print mode:
 *   claude -p --output-format stream-json --verbose --tools Read,Grep,Glob --permission-mode dontAsk
 *          --strict-mcp-config [--model M] [--effort E] [--settings {"fastMode":true}]
 *          --append-system-prompt <system>
 *          [--json-schema <schema>] [--add-dir <other folders>] [--resume <sid> [--fork-session]]
 * The prompt goes to stdin. Forks use --resume <parent> --fork-session (new session id); the repair
 * round resumes the run's own session.
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROVIDER_LABELS,
  type ProviderModel,
  type Settings,
  type Usage,
} from '@codesplainer/shared';
import type { ProviderContext, ProviderFactory } from '../context';
import { binaryKey, locateBinary, runProbe, type BinarySpec } from '../detect';
import { extractJson } from '../extract';
import { startProcess } from '../process';
import { buildRepairPrompt } from '../prompt';
import {
  AgentError,
  type ActivityInput,
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
  displayPath,
  ensureFolder,
  firstLine,
  isObject,
  remaining,
  runEffort,
  runFast,
  stripAnsi,
  TtlCache,
  type FolderRef,
} from '../util';

const IS_WINDOWS = process.platform === 'win32';

const SPEC: BinarySpec = {
  names: ['claude'],
  extensions: [
    {
      prefix: 'anthropic.claude-code-',
      binaries: [join('resources', 'native-binary', IS_WINDOWS ? 'claude.exe' : 'claude')],
    },
  ],
};

const CAPABILITIES = { fork: true, structuredOutput: true, cost: true, streaming: true };
const DESCRIPTION = 'Claude Code in print mode with read-only tools (Read, Grep, Glob).';
const TOOLS = 'Read,Grep,Glob';

export const CLAUDE_MODELS: ProviderModel[] = [
  { id: 'default', label: 'Default', description: 'Claude Code default for your account' },
  { id: 'sonnet', label: 'Sonnet', description: 'Latest Sonnet: fast and capable' },
  { id: 'opus', label: 'Opus', description: 'Latest Opus: most capable, slower' },
  { id: 'haiku', label: 'Haiku', description: 'Latest Haiku: fastest' },
  { id: 'fable', label: 'Fable', description: 'Latest Fable model' },
];

interface Turn {
  output: unknown;
  rawText: string;
  sessionId?: string;
}

export function claudeToolActivity(
  name: string,
  input: unknown,
  folders: FolderRef[],
): ActivityInput {
  const i = isObject(input) ? input : {};
  const p = asString(i.file_path) ?? asString(i.path) ?? asString(i.notebook_path);
  const shown = p ? displayPath(p, folders) : undefined;
  const withPath = p ? { path: p } : {};
  switch (name) {
    case 'Read':
      return { kind: 'tool', text: `Reading ${shown ?? 'a file'}`, ...withPath };
    case 'Grep': {
      const pattern = clip(asString(i.pattern) ?? '', 50);
      const glob = asString(i.glob) ?? asString(i.type);
      return {
        kind: 'tool',
        text: clip(
          `Searching “${pattern}”${shown ? ` in ${shown}` : ''}${glob ? ` (${glob})` : ''}`,
          140,
        ),
        ...withPath,
      };
    }
    case 'Glob':
      return {
        kind: 'tool',
        text: clip(`Finding ${asString(i.pattern) ?? 'files'}${shown ? ` in ${shown}` : ''}`, 140),
        ...withPath,
      };
    case 'LS':
      return { kind: 'tool', text: `Listing ${shown ?? '.'}`, ...withPath };
    default:
      return { kind: 'tool', text: `Using ${name}` };
  }
}

/** Readable reasons Claude Code reports for fast mode being off (`fast_mode_disabled_reason`). */
const FAST_MODE_REASONS: Record<string, string> = {
  extra_usage_disabled: 'it needs usage credits, which are turned off for this account',
  member_level_disabled: 'usage credits are turned off for your account',
  member_zero_credit_limit: 'usage credits are not available for your plan',
  org_service_level_disabled: 'usage credits are turned off by your organization',
  disabled_by_env: 'CLAUDE_CODE_DISABLE_FAST_MODE is set',
};

/** Warning when fast mode was requested but the init event says it is off; else undefined. */
export function fastModeUnavailable(init: Record<string, unknown>): string | undefined {
  const state = asString(init.fast_mode_state);
  if (!state || state === 'on') return undefined;
  const code = asString(init.fast_mode_disabled_reason);
  const reason = code ? (FAST_MODE_REASONS[code] ?? code.replaceAll('_', ' ')) : undefined;
  return `Fast mode is off${reason ? `: ${reason}` : ''}. This run used standard speed.`;
}

function parseAnswer(text: string): unknown {
  const value = extractJson(text);
  return value === undefined ? text : value;
}

export const createClaudeProvider: ProviderFactory = (ctx: ProviderContext) => {
  const authCache = new TtlCache<boolean | undefined>(10 * 60 * 1000);

  const locate = (settings: Settings, refresh: boolean) =>
    locateBinary(SPEC, {
      override: settings.providers.claude.command,
      homeDir: ctx.homeDir,
      refresh,
      tracker: ctx.tracker,
    });

  /** `claude auth status` → loggedIn (undefined when unknown). */
  async function loggedIn(command: string, refresh: boolean): Promise<boolean | undefined> {
    return authCache.get(
      await binaryKey(command),
      async () => {
        const r = await runProbe(command, ['auth', 'status'], {
          timeoutMs: 10_000,
          tracker: ctx.tracker,
        });
        const json = extractJson(r.output, { prefer: (v) => isObject(v) && 'loggedIn' in v });
        return isObject(json) && typeof json.loggedIn === 'boolean' ? json.loggedIn : undefined;
      },
      refresh,
      (v) => v === true, // re-check until logged in
    );
  }

  async function detect(settings: Settings, opts: { refresh: boolean }): Promise<DetectedProvider> {
    const base: DetectedProvider = {
      id: 'claude',
      name: PROVIDER_LABELS.claude,
      description: DESCRIPTION,
      available: false,
      warnings: [],
      models: CLAUDE_MODELS,
      defaultModel: 'default',
      capabilities: CAPABILITIES,
      experimental: false,
    };
    const loc = await locate(settings, opts.refresh);
    if (!loc.ok) {
      return {
        ...base,
        reason:
          loc.reason === 'not found'
            ? 'Claude Code (claude) not found. Install it (npm install -g @anthropic-ai/claude-code) or set its path in settings.'
            : loc.reason,
      };
    }
    const warnings: string[] = [];
    if ((await loggedIn(loc.binary.path, opts.refresh).catch(() => undefined)) === false) {
      warnings.push('Not logged in: run `claude auth login` (or /login inside claude).');
    }
    return {
      ...base,
      available: true,
      command: loc.binary.path,
      version: loc.binary.version,
      warnings,
    };
  }

  /** Content-addressed system prompt file (Windows: avoids multi-line arguments through cmd.exe). */
  async function systemPromptFile(system: string): Promise<string> {
    const dir = join(ctx.dataDir, 'tmp');
    await mkdir(dir, { recursive: true });
    const file = join(
      dir,
      `claude-system-${createHash('sha256').update(system).digest('hex').slice(0, 12)}.md`,
    );
    if (await stat(file).catch(() => undefined)) return file;
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, system, 'utf8');
    await rename(tmp, file).catch(() => rm(tmp, { force: true }));
    return file;
  }

  async function run(req: AgentRunRequest): Promise<AgentRunResult> {
    const loc = await locate(req.settings, false);
    if (!loc.ok) throw new AgentError('unavailable', `Claude Code unavailable: ${loc.reason}`);
    const command = loc.binary.path;
    const ps = req.providerSettings;
    const folders = req.folders;
    const cwd = await ensureFolder(folders[0]?.path);
    const started = Date.now();
    const deadline = started + req.timeoutMs;
    const warnings: string[] = [];
    const usage: Usage = {};
    const model = req.model && req.model !== 'default' ? req.model : undefined;
    const effort = runEffort(req);
    const fast = runFast(req);
    const systemFile = IS_WINDOWS ? await systemPromptFile(req.prompt.system) : undefined;
    let lastSession: string | undefined;

    const buildArgs = (resume: string | undefined, fork: boolean): string[] => {
      const args = ['-p', '--output-format', 'stream-json', '--verbose'];
      const extraDirs = folders.slice(1).map((f) => f.path);
      if (extraDirs.length) args.push('--add-dir', ...extraDirs);
      args.push('--tools', TOOLS, '--permission-mode', 'dontAsk', '--strict-mcp-config');
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      if (fast) args.push('--settings', JSON.stringify({ fastMode: true }));
      if (resume) {
        args.push('--resume', resume);
        if (fork) args.push('--fork-session');
      }
      if (systemFile) args.push('--append-system-prompt-file', systemFile);
      else args.push('--append-system-prompt', req.prompt.system);
      if (ps.structuredOutput) args.push('--json-schema', JSON.stringify(req.outputSchema));
      args.push(...ps.extraArgs);
      return args;
    };

    const invoke = async (
      prompt: string,
      resume: string | undefined,
      fork: boolean,
    ): Promise<Turn> => {
      let sessionId: string | undefined;
      let result: Record<string, unknown> | undefined;
      let fromTool: unknown;
      let rateLimited = false;
      const texts: string[] = [];

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
          case 'system':
            if (ev.subtype === 'init') {
              sessionId = asString(ev.session_id) ?? sessionId;
              const m = asString(ev.model);
              if (m) usage.model = m;
              req.onActivity({ kind: 'status', text: `Claude Code started${m ? ` (${m})` : ''}` });
              const fastOff = fast ? fastModeUnavailable(ev) : undefined;
              if (fastOff && !warnings.includes(fastOff)) {
                warnings.push(fastOff);
                req.onActivity({ kind: 'warning', text: fastOff });
              }
            }
            break;
          case 'assistant': {
            const content =
              isObject(ev.message) && Array.isArray(ev.message.content) ? ev.message.content : [];
            for (const block of content) {
              if (!isObject(block)) continue;
              if (block.type === 'tool_use') {
                const name = asString(block.name) ?? 'tool';
                if (name === 'StructuredOutput') {
                  fromTool = block.input;
                  req.onActivity({ kind: 'status', text: 'Writing answer' });
                } else {
                  req.onActivity(claudeToolActivity(name, block.input, folders));
                }
              } else if (block.type === 'thinking') {
                const t = asString(block.thinking);
                if (t) req.onActivity({ kind: 'thinking', text: clip(firstLine(t) || t, 140) });
              } else if (block.type === 'text') {
                const t = asString(block.text);
                if (!t) continue;
                texts.push(t);
                const trimmed = t.trim();
                if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) {
                  req.onActivity({ kind: 'message', text: clip(firstLine(trimmed), 140) });
                }
              }
            }
            break;
          }
          case 'rate_limit_event': {
            const info = isObject(ev.rate_limit_info) ? ev.rate_limit_info : {};
            const status = asString(info.status);
            if (status && status !== 'allowed') {
              const kind = asString(info.rateLimitType) ?? asString(info.rate_limit_type);
              rateLimited = status === 'rejected';
              req.onActivity({
                kind: status === 'rejected' ? 'error' : 'warning',
                text: `Usage limit ${status === 'rejected' ? 'reached' : 'warning'}${kind ? ` (${kind})` : ''}`,
              });
            }
            break;
          }
          case 'result':
            result = ev;
            sessionId = asString(ev.session_id) ?? sessionId;
            break;
          default:
            break;
        }
      };

      const proc = startProcess({
        command,
        args: buildArgs(resume, fork),
        cwd,
        env: childEnv({}, ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']),
        stdin: prompt,
        onStdoutLine: onLine,
        timeoutMs: remaining(deadline),
        signal: req.signal,
        tracker: ctx.tracker,
      });
      const res = await proc.done;
      if (sessionId) lastSession = sessionId;
      const partial = (): Partial<AgentRunResult> => ({
        rawText: texts.join('\n'),
        usage: { ...usage, durationMs: Date.now() - started },
        warnings,
        ...(lastSession ? { session: { provider: 'claude' as const, id: lastSession } } : {}),
      });

      if (res.cancelled) throw new AgentError('cancelled', 'Cancelled.', partial());
      if (res.timedOut) {
        throw new AgentError(
          'timeout',
          `Claude Code timed out after ${Math.round(req.timeoutMs / 1000)} s.`,
          partial(),
        );
      }
      if (res.spawnError)
        throw new AgentError('unavailable', `Could not start Claude Code: ${res.spawnError}`);

      if (result) {
        const u = isObject(result.usage) ? result.usage : {};
        const cacheRead = asNumber(u.cache_read_input_tokens) ?? 0;
        const input =
          (asNumber(u.input_tokens) ?? 0) +
          (asNumber(u.cache_creation_input_tokens) ?? 0) +
          cacheRead;
        usage.inputTokens = (usage.inputTokens ?? 0) + input;
        usage.cachedTokens = (usage.cachedTokens ?? 0) + cacheRead;
        usage.outputTokens = (usage.outputTokens ?? 0) + (asNumber(u.output_tokens) ?? 0);
        const cost = asNumber(result.total_cost_usd);
        if (cost !== undefined) usage.costUsd = (usage.costUsd ?? 0) + cost;
        const turns = asNumber(result.num_turns);
        if (turns !== undefined) usage.turns = (usage.turns ?? 0) + turns;
        if (!usage.model && isObject(result.modelUsage))
          usage.model = Object.keys(result.modelUsage)[0];

        const resultText = asString(result.result);
        const text = resultText ?? texts.join('\n');
        const subtype = asString(result.subtype) ?? 'success';
        const failed = result.is_error === true || subtype !== 'success';
        if (failed && subtype !== 'error_max_structured_output_retries') {
          const detail = clip(text || subtype, 600);
          // Classify only what the CLI wrote (error result, stderr), never the model's own text:
          // explaining login or rate-limit code must not turn into an "auth" failure.
          const cliText = `${result.is_error === true ? (resultText ?? '') : ''}\n${stripAnsi(res.stderrTail)}`;
          const code = rateLimited ? 'rate_limit' : (classifyErrorText(cliText) ?? 'process');
          const message =
            subtype === 'error_max_turns'
              ? 'Claude Code stopped: maximum number of turns reached.'
              : subtype === 'error_max_budget_usd'
                ? 'Claude Code stopped: budget limit reached.'
                : `Claude Code failed: ${detail}`;
          throw new AgentError(code, message, partial());
        }
        if (failed)
          warnings.push('Claude Code could not produce structured output; parsed its text answer.');
        const structured = result.structured_output ?? fromTool;
        if (structured !== undefined && structured !== null) {
          return { output: structured, rawText: JSON.stringify(structured), sessionId };
        }
        if (ps.structuredOutput && !failed)
          warnings.push('Structured output missing; parsed the text answer.');
        return { output: parseAnswer(text), rawText: text, sessionId };
      }

      const stderr = stripAnsi(res.stderrTail).trim();
      const detail = stderr ? `: ${clip(stderr.split('\n').slice(-6).join(' '), 600)}` : '';
      const code = rateLimited ? 'rate_limit' : (classifyErrorText(stderr) ?? 'process');
      throw new AgentError(
        code,
        `Claude Code exited with code ${res.code ?? res.signal}${detail}`,
        partial(),
      );
    };

    // With --json-schema Claude Code expects the answer through its StructuredOutput tool.
    const deliver = ps.structuredOutput
      ? '\n\nSubmit the JSON object with the StructuredOutput tool.'
      : '';
    const forked = Boolean(req.forkSessionId);
    let turn: Turn;
    try {
      const text = forked ? (req.prompt.followUp ?? req.prompt.user) : req.prompt.user;
      turn = await invoke(text + deliver, req.forkSessionId, forked);
    } catch (e) {
      // The parent session may be gone (deleted, other machine): start fresh once.
      const noSession =
        lastSession === undefined && e instanceof AgentError && e.code === 'process';
      if (!forked || !noSession || req.signal.aborted) throw e;
      warnings.push('Could not fork the parent session; started a fresh one.');
      req.onActivity({ kind: 'warning', text: 'Parent session unavailable, starting fresh' });
      turn = await invoke(req.prompt.user + deliver, undefined, false);
    }

    let { output, rawText } = turn;
    const check = req.validate(output);
    if (!check.ok && turn.sessionId) {
      warnings.push(`First answer was invalid (${clip(check.error, 200)}); asked for a fix.`);
      req.onActivity({ kind: 'status', text: 'Answer invalid, asking for a fix' });
      const fix = await invoke(buildRepairPrompt(check.error) + deliver, turn.sessionId, false);
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
      ...(lastSession ? { session: { provider: 'claude' as const, id: lastSession } } : {}),
      usage,
      warnings,
    };
  }

  return { id: 'claude', detect, run };
};
