/**
 * Bounded, dependency-free code scanning for the offline demo provider: directory listings,
 * import statements and top-level symbols (regex based, good enough for believable diagrams).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { toPosixPath } from '@codesplainer/shared';

export const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.idea',
  '.vscode',
  'vendor',
  'tmp',
  '.gradle',
  'obj',
  'Pods',
  'DerivedData',
]);

const LANG_BY_EXT: Record<string, Lang> = {
  '.ts': 'js',
  '.tsx': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.vue': 'js',
  '.svelte': 'js',
  '.py': 'py',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'java',
  '.kts': 'java',
  '.scala': 'java',
  '.cs': 'java',
  '.swift': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'c',
  '.cpp': 'c',
  '.hpp': 'c',
};

export type Lang = 'js' | 'py' | 'go' | 'rust' | 'java' | 'ruby' | 'php' | 'c';

export function languageOf(file: string): Lang | undefined {
  return LANG_BY_EXT[extname(file).toLowerCase()];
}

export const isSource = (file: string): boolean => languageOf(file) !== undefined;

export const NOTABLE_FILES: Record<string, string> = {
  'package.json': 'npm package manifest',
  'go.mod': 'Go module definition',
  'cargo.toml': 'Rust crate manifest',
  'pyproject.toml': 'Python project config',
  'requirements.txt': 'Python dependencies',
  'pom.xml': 'Maven build',
  'build.gradle': 'Gradle build',
  'build.gradle.kts': 'Gradle build',
  dockerfile: 'Container image build',
  'docker-compose.yml': 'Local services setup',
  'docker-compose.yaml': 'Local services setup',
  makefile: 'Build tasks',
};

export interface Entry {
  name: string;
  abs: string;
  /** Relative to the workspace folder root (posix). */
  rel: string;
  isDir: boolean;
  size: number;
}

/** Non-ignored, non-hidden entries of a directory, dirs first, sorted by name. */
export async function listEntries(abs: string, root: string): Promise<Entry[]> {
  let dirents;
  try {
    dirents = await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.') || IGNORED_DIRS.has(d.name)) continue;
    const p = join(abs, d.name);
    const isDir = d.isDirectory();
    if (!isDir && !d.isFile()) continue;
    let size = 0;
    if (!isDir) size = (await stat(p).catch(() => undefined))?.size ?? 0;
    out.push({ name: d.name, abs: p, rel: toPosixPath(relative(root, p)), isDir, size });
  }
  return out.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
  );
}

/** Breadth-first walk (bounded) returning files. */
export async function walkFiles(
  abs: string,
  opts: { limit: number; filter?: (file: string) => boolean; maxDirs?: number },
): Promise<string[]> {
  const files: string[] = [];
  const queue = [abs];
  let dirs = 0;
  while (queue.length && files.length < opts.limit && dirs < (opts.maxDirs ?? 400)) {
    const dir = queue.shift() as string;
    dirs++;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (d.name.startsWith('.') || IGNORED_DIRS.has(d.name)) continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) queue.push(p);
      else if (d.isFile() && (!opts.filter || opts.filter(p))) {
        files.push(p);
        if (files.length >= opts.limit) break;
      }
    }
  }
  return files;
}

export async function readText(file: string, maxBytes = 256 * 1024): Promise<string> {
  try {
    const buf = await readFile(file);
    const slice = buf.subarray(0, maxBytes);
    if (slice.includes(0)) return ''; // binary
    return slice.toString('utf8');
  } catch {
    return '';
  }
}

// ---- imports ---------------------------------------------------------------------------------

const IMPORT_PATTERNS: Record<Lang, RegExp[]> = {
  js: [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g,
    /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ],
  py: [/^\s*from\s+([.\w]+)\s+import\b/gm, /^\s*import\s+([\w.]+)/gm],
  go: [/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm, /^\s+(?:\w+\s+)?"([^"]+)"\s*$/gm],
  rust: [/^\s*(?:pub\s+)?use\s+([\w:]+)/gm, /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm],
  java: [/^\s*import\s+(?:static\s+)?([\w.]+)/gm, /^\s*using\s+([\w.]+)\s*;/gm],
  ruby: [/\brequire(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]/g],
  php: [/^\s*use\s+([\w\\]+)/gm, /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g],
  c: [/^\s*#\s*include\s+"([^"]+)"/gm],
};

export function parseImports(text: string, lang: Lang): string[] {
  const out = new Set<string>();
  for (const re of IMPORT_PATTERNS[lang]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/** Candidate names a bare import specifier may refer to ("@scope/pkg/x" → "@scope/pkg", "pkg", "x"). */
export function specifierNames(spec: string, lang: Lang): string[] {
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    if (s) names.add(s.toLowerCase());
  };
  if (lang === 'rust') {
    const parts = spec.split('::').filter((p) => !['crate', 'self', 'super'].includes(p));
    add(parts[0]);
    add(parts[1]);
  } else if (lang === 'py' || lang === 'java') {
    const parts = spec.replace(/^\.+/, '').split('.');
    parts.forEach(add);
  } else if (lang === 'php') {
    spec.split('\\').forEach(add);
  } else {
    const parts = spec.split('/');
    if (spec.startsWith('@') && parts.length >= 2) {
      add(`${parts[0]}/${parts[1]}`);
      add(parts[1]);
      add(parts[2]);
    } else {
      add(parts[0]);
      add(parts[parts.length - 1]);
    }
  }
  return [...names];
}

/** Resolve a relative specifier to an absolute path (without extension guessing). */
export function resolveRelative(spec: string, fromFile: string, lang: Lang): string | undefined {
  if (lang === 'py' && spec.startsWith('.')) {
    const dots = spec.match(/^\.+/)?.[0].length ?? 0;
    const rest = spec.slice(dots).replace(/\./g, '/');
    return resolve(dirname(fromFile), `${dots > 1 ? '../'.repeat(dots - 1) : './'}${rest}`);
  }
  if (lang === 'ruby' && !spec.startsWith('.')) return resolve(dirname(fromFile), spec);
  if (lang === 'c') return resolve(dirname(fromFile), spec);
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    return resolve(dirname(fromFile), spec);
  }
  return undefined;
}

export const stripExt = (p: string): string => {
  const ext = extname(p);
  return ext ? p.slice(0, -ext.length) : p;
};

/** Does absolute path `target` fall inside (or name) the entry at `abs`? */
export function pathHits(target: string, abs: string, isDir: boolean): boolean {
  if (target === abs || stripExt(target) === stripExt(abs)) return true;
  if (isDir) return target.startsWith(abs + sep);
  return stripExt(target) === join(dirname(abs), basename(stripExt(abs)));
}

// ---- symbols ---------------------------------------------------------------------------------

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'data';
  startLine: number;
  endLine: number;
  indent: number;
  exported: boolean;
}

type SymbolRule = [RegExp, SymbolInfo['kind']];

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'else',
  'new',
  'await',
  'typeof',
  'constructor',
  'super',
  'do',
  'try',
  'with',
]);

const SYMBOL_RULES: Record<Lang, SymbolRule[]> = {
  js: [
    [
      /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
      'function',
    ],
    [/^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
    [
      /^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
      'function',
    ],
    [/^(\s*)(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'data'],
    [/^(\s*)(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/, 'data'],
    [/^(\s*)(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'data'],
    [
      /^(\s+)(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
      'function',
    ],
  ],
  py: [
    [/^(\s*)(?:async\s+)?def\s+(\w+)/, 'function'],
    [/^(\s*)class\s+(\w+)/, 'class'],
  ],
  go: [
    [/^()func\s+(?:\([^)]*\)\s*)?(\w+)/, 'function'],
    [/^()type\s+(\w+)\s+(?:struct|interface)\b/, 'class'],
  ],
  rust: [
    [
      /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/,
      'function',
    ],
    [/^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:struct|trait)\s+(\w+)/, 'class'],
    [/^(\s*)(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, 'data'],
  ],
  java: [
    [
      /^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|open|data|sealed|partial)\s+)*(?:class|interface|enum|record|object|struct|trait)\s+(\w+)/,
      'class',
    ],
    [
      /^(\s*)(?:(?:public|private|protected|internal|override|suspend|inline)\s+)*(?:fun|func|def)\s+(\w+)/,
      'function',
    ],
    [
      /^(\s+)(?:(?:public|private|protected|static|final|synchronized|override|virtual|async)\s+)+[\w<>[\],.? ]+?\s+(\w+)\s*\([^;]*$/,
      'function',
    ],
  ],
  ruby: [
    [/^(\s*)def\s+(?:self\.)?(\w+[?!]?)/, 'function'],
    [/^(\s*)(?:class|module)\s+([\w:]+)/, 'class'],
  ],
  php: [
    [
      /^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)/,
      'function',
    ],
    [/^(\s*)(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)/, 'class'],
  ],
  c: [
    [
      /^()(?:static\s+|inline\s+|extern\s+)*[\w:*&<>, ]+?[\s*&]+(\w+)\s*\([^;{]*\)\s*\{?\s*$/,
      'function',
    ],
    [/^()(?:typedef\s+)?(?:struct|class|enum)\s+(\w+)\s*\{?/, 'class'],
  ],
};

const BRACE_LANGS = new Set<Lang>(['js', 'go', 'rust', 'java', 'php', 'c']);

function stripStrings(line: string): string {
  return line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '');
}

/** End line of a brace block starting at `start` (0-based index), bounded by `limit`. */
function braceEnd(lines: string[], start: number, limit: number): number | undefined {
  let depth = 0;
  let opened = false;
  for (let i = start; i <= limit && i < lines.length; i++) {
    const line = stripStrings(lines[i] ?? '');
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
        if (opened && depth <= 0) return i;
      }
    }
    if (!opened && i - start >= 2) return undefined;
    if (!opened && /;\s*$/.test(line)) return i;
  }
  return undefined;
}

/** Top-level symbols of a source file (falls back to members when there is a single container). */
export function findSymbols(text: string, lang: Lang): SymbolInfo[] {
  const lines = text.split(/\r?\n/);
  const found: SymbolInfo[] = [];
  lines.forEach((line, i) => {
    if (line.length > 400) return;
    for (const [re, kind] of SYMBOL_RULES[lang]) {
      const m = line.match(re);
      const name = m?.[2];
      if (!m || !name || KEYWORDS.has(name)) continue;
      found.push({
        name,
        kind,
        startLine: i + 1,
        endLine: i + 1,
        indent: (m[1] ?? '').replace(/\t/g, '    ').length,
        exported: /^\s*(?:export|pub\b|public\b)/.test(line),
      });
      break;
    }
  });
  if (!found.length) return [];
  const lastLine = (() => {
    let n = lines.length;
    while (n > 1 && !(lines[n - 1] ?? '').trim()) n--;
    return n;
  })();
  const endOf = (list: SymbolInfo[], bound: number) => {
    list.forEach((s, idx) => {
      const next = list[idx + 1];
      const limit = (next ? next.startLine - 1 : bound) - 1; // 0-based inclusive
      let end = BRACE_LANGS.has(lang) ? braceEnd(lines, s.startLine - 1, limit) : undefined;
      if (end === undefined) {
        end = limit;
        while (end > s.startLine - 1 && !(lines[end] ?? '').trim()) end--;
      }
      s.endLine = Math.max(s.startLine, end + 1);
    });
  };
  const minIndent = Math.min(...found.map((s) => s.indent));
  const top = found.filter((s) => s.indent === minIndent);
  endOf(top, lastLine);
  if (top.length === 1 && top[0]) {
    const container = top[0];
    const members = found.filter(
      (s) =>
        s.indent > minIndent &&
        s.startLine > container.startLine &&
        s.startLine <= container.endLine,
    );
    const memberIndent = Math.min(...members.map((s) => s.indent));
    const direct = members.filter((s) => s.indent === memberIndent);
    if (direct.length >= 2) {
      endOf(direct, container.endLine);
      return direct;
    }
  }
  return top;
}

/** Count files below a directory (bounded). */
export async function countFiles(abs: string, limit = 2000): Promise<number> {
  return (await walkFiles(abs, { limit, maxDirs: 300 })).length;
}
