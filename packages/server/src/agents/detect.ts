/**
 * Locating agent CLIs: explicit setting > PATH (PATHEXT on Windows) > well-known install dirs >
 * binaries bundled in editor extensions (newest version first). Version probes are cached per
 * binary (path + mtime + size), lookups for a minute.
 */
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { runProcess, type ProcessTracker } from './process';
import { stripAnsi } from './util';

const IS_WINDOWS = process.platform === 'win32';

export type BinarySource = 'setting' | 'path' | 'known' | 'extension';

export interface BinaryCandidate {
  path: string;
  source: BinarySource;
  /** Version parsed from the extension folder name. */
  dirVersion?: string;
}

export interface BinarySpec {
  /** Executable names (without extension) looked up on PATH and in well-known directories. */
  names: string[];
  /** Binaries bundled in editor extensions: extension folder prefix + paths inside the folder. */
  extensions?: { prefix: string; binaries: string[] }[];
  /** Extra absolute candidates, checked after the well-known directories. */
  extraPaths?: string[];
}

export interface LocateOptions {
  /** User setting (absolute path or command name). When set, nothing else is tried. */
  override?: string;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  refresh?: boolean;
  tracker?: ProcessTracker;
  versionArgs?: string[];
  versionTimeoutMs?: number;
}

export interface LocatedBinary {
  path: string;
  source: BinarySource;
  version?: string;
}

export type LocateResult =
  { ok: true; binary: LocatedBinary } | { ok: false; reason: string; tried: string[] };

// ---- file helpers ----------------------------------------------------------------------------

export async function isExecutable(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    if (!s.isFile()) return false;
    if (IS_WINDOWS) return true;
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function pathExts(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!IS_WINDOWS) return [''];
  const raw = env.PATHEXT ?? env.Pathext ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * File names to try for a command. Windows: PATHEXT variants only (npm puts an extensionless
 * `#!/bin/sh` shim next to `claude.cmd`), unless the name already has an executable extension.
 */
export function nameVariants(name: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!IS_WINDOWS) return [name];
  const exts = pathExts(env);
  const ext = extname(name).toLowerCase();
  return ext && exts.includes(ext) ? [name] : exts.map((e) => name + e);
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  return raw
    .split(delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

/** Look a command up on PATH. */
export async function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const dir of pathDirs(env)) {
    for (const variant of nameVariants(name, env)) {
      const candidate = join(dir, variant);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function knownDirs(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = [
    join(home, '.claude', 'local'),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
  ];
  if (IS_WINDOWS) {
    if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Programs'));
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin');
  }
  return dirs;
}

export function editorExtensionDirs(home: string): string[] {
  return [
    '.vscode',
    '.vscode-insiders',
    '.vscode-server',
    '.vscode-server-insiders',
    '.vscode-oss',
    '.cursor',
    '.cursor-server',
    '.kiro',
    '.windsurf',
    '.windsurf-server',
  ].map((d) => join(home, d, 'extensions'));
}

/** Platform folder used by the OpenAI extension ("linux-x86_64", "macos-aarch64", ...). */
export function codexPlatformDir(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
  const cpu = arch === 'arm64' ? 'aarch64' : 'x86_64';
  return `${os}-${cpu}`;
}

// ---- versions ------------------------------------------------------------------------------

/** First version-looking token ("2.1.284", "0.155.0-alpha.16.3") in a text. */
export function parseVersion(text: string): string | undefined {
  const m = stripAnsi(text).match(
    /(?<![\d.])(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)/,
  );
  return m?.[1];
}

/** Numeric comparison of dotted versions (pre-release suffixes sort below the release). */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = a.split('-', 2);
  const [coreB = '', preB] = b.split('-', 2);
  const pa = coreA.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = coreB.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  if (preA && preB)
    return compareVersions(preA.replace(/[^\d.]/g, ''), preB.replace(/[^\d.]/g, ''));
  return 0;
}

// ---- candidates ------------------------------------------------------------------------------

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

async function extensionCandidates(spec: BinarySpec, home: string): Promise<BinaryCandidate[]> {
  const out: BinaryCandidate[] = [];
  if (!spec.extensions?.length) return out;
  for (const root of editorExtensionDirs(home)) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const ext of spec.extensions) {
      const prefix = ext.prefix.toLowerCase();
      for (const name of entries) {
        if (!name.toLowerCase().startsWith(prefix)) continue;
        const dirVersion = name.slice(ext.prefix.length).match(/^(\d+(?:\.\d+)*)/)?.[1];
        for (const bin of ext.binaries) {
          out.push({ path: join(root, name, bin), source: 'extension', dirVersion });
        }
      }
    }
  }
  out.sort((a, b) => compareVersions(b.dirVersion ?? '0', a.dirVersion ?? '0'));
  return out;
}

/** All existing, executable candidates in priority order (deduplicated). */
export async function listCandidates(
  spec: BinarySpec,
  opts: LocateOptions,
): Promise<BinaryCandidate[]> {
  const env = opts.env ?? process.env;
  const home = opts.homeDir;
  const raw: BinaryCandidate[] = [];
  const override = opts.override?.trim();
  if (override) {
    const expanded = expandHome(override, home);
    if (isAbsolute(expanded) || /[\\/]/.test(expanded)) {
      raw.push({ path: resolve(expanded), source: 'setting' });
    } else {
      const found = await findOnPath(expanded, env);
      if (found) raw.push({ path: found, source: 'setting' });
    }
  } else {
    for (const name of spec.names) {
      const found = await findOnPath(name, env);
      if (found) raw.push({ path: found, source: 'path' });
    }
    for (const dir of knownDirs(home, env)) {
      for (const name of spec.names) {
        for (const variant of nameVariants(name, env))
          raw.push({ path: join(dir, variant), source: 'known' });
      }
    }
    for (const p of spec.extraPaths ?? []) raw.push({ path: expandHome(p, home), source: 'known' });
    raw.push(...(await extensionCandidates(spec, home)));
  }
  const seen = new Set<string>();
  const out: BinaryCandidate[] = [];
  for (const c of raw) {
    const key = IS_WINDOWS ? c.path.toLowerCase() : c.path;
    if (seen.has(key)) continue;
    seen.add(key);
    if (await isExecutable(c.path)) out.push(c);
  }
  return out;
}

// ---- probes --------------------------------------------------------------------------------

export interface ProbeResult {
  ok: boolean;
  code: number | null;
  output: string;
  timedOut: boolean;
  error?: string;
}

/** Run a short command (stdin closed) and capture stdout + stderr. Never throws. */
export async function runProbe(
  command: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    tracker?: ProcessTracker;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ProbeResult> {
  try {
    const res = await runProcess({
      command,
      args,
      cwd: opts.cwd,
      env: opts.env,
      stdin: '',
      timeoutMs: opts.timeoutMs ?? 10_000,
      killGraceMs: 1000,
      tracker: opts.tracker,
      maxStdoutChars: 64 * 1024,
    });
    const output = stripAnsi(`${res.stdout}${res.stderrTail ? `\n${res.stderrTail}` : ''}`).trim();
    if (res.spawnError)
      return { ok: false, code: null, output, timedOut: false, error: res.spawnError };
    if (res.timedOut) {
      return { ok: false, code: res.code, output, timedOut: true, error: 'Timed out.' };
    }
    return { ok: res.code === 0, code: res.code, output, timedOut: false };
  } catch (e) {
    return { ok: false, code: null, output: '', timedOut: false, error: String(e) };
  }
}

/** Identity of a binary on disk (changes when it is updated). */
export async function binaryKey(p: string): Promise<string> {
  try {
    const s = await stat(p);
    return `${p}|${s.mtimeMs}|${s.size}`;
  } catch {
    return p;
  }
}

const versionCache = new Map<string, Promise<ProbeResult & { version?: string }>>();

/** `<binary> --version`, cached per binary identity. */
export async function probeVersion(
  command: string,
  opts: { args?: string[]; timeoutMs?: number; tracker?: ProcessTracker; refresh?: boolean } = {},
): Promise<ProbeResult & { version?: string }> {
  const args = opts.args ?? ['--version'];
  const key = `${await binaryKey(command)}|${args.join(' ')}`;
  const cached = versionCache.get(key);
  if (cached && !opts.refresh) return cached;
  const promise = runProbe(command, args, {
    timeoutMs: opts.timeoutMs ?? 10_000,
    tracker: opts.tracker,
  }).then((r) => ({ ...r, version: r.ok ? parseVersion(r.output) : undefined }));
  versionCache.set(key, promise);
  const r = await promise;
  if (!r.ok) versionCache.delete(key);
  return r;
}

const locateCache = new Map<string, { at: number; value: Promise<LocateResult> }>();
const LOCATE_TTL_MS = 60_000;

/**
 * Find a working binary: the first candidate whose version probe succeeds (a few tries).
 * With an override only that command is considered.
 */
export async function locateBinary(spec: BinarySpec, opts: LocateOptions): Promise<LocateResult> {
  const env = opts.env ?? process.env;
  const key = JSON.stringify([spec, opts.override ?? '', opts.homeDir, env.PATH ?? env.Path ?? '']);
  const hit = locateCache.get(key);
  if (hit && !opts.refresh && Date.now() - hit.at < LOCATE_TTL_MS) return hit.value;
  const value = (async (): Promise<LocateResult> => {
    const candidates = await listCandidates(spec, opts);
    const tried: string[] = [];
    let lastError = '';
    for (const c of candidates.slice(0, 4)) {
      tried.push(c.path);
      const probe = await probeVersion(c.path, {
        args: opts.versionArgs,
        timeoutMs: opts.versionTimeoutMs,
        tracker: opts.tracker,
        refresh: opts.refresh,
      });
      if (probe.ok) {
        return {
          ok: true,
          binary: { path: c.path, source: c.source, version: probe.version ?? c.dirVersion },
        };
      }
      lastError = probe.error ?? (probe.output.split('\n')[0] || `exit code ${probe.code}`);
    }
    const override = opts.override?.trim();
    if (override) {
      return {
        ok: false,
        tried,
        reason: candidates.length
          ? `"${override}" failed to run: ${lastError}`
          : `Command "${override}" not found.`,
      };
    }
    return {
      ok: false,
      tried,
      reason: candidates.length
        ? `Found ${tried.join(', ')} but it failed to run: ${lastError}`
        : 'not found',
    };
  })();
  locateCache.set(key, { at: Date.now(), value });
  return value;
}
