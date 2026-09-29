/**
 * What counts as "not part of the code": dependency folders, build output, caches (default
 * ignores, not overridable) plus the rules of the root and nested .gitignore files.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';

export const DEFAULT_IGNORED_NAMES: readonly string[] = [
  '.git',
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
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  '.idea',
  'vendor',
  'Pods',
  'DerivedData',
];

export const DEFAULT_IGNORED_PATTERNS: readonly string[] = ['*.min.js', '*.map'];

const DEFAULT_NAMES = new Set(DEFAULT_IGNORED_NAMES);
const MAX_GITIGNORE_BYTES = 256 * 1024;

/** Default rules for a single path segment (a directory name, or the file name when !isDir). */
export function isDefaultIgnored(name: string, isDir: boolean): boolean {
  if (DEFAULT_NAMES.has(name)) return true;
  if (isDir) return false;
  const lower = name.toLowerCase();
  return lower.endsWith('.min.js') || lower.endsWith('.map');
}

/**
 * .gitignore rules of one workspace folder. Rules of a directory are loaded with load(dir) (the
 * scanner does this while descending); `ignores()` only consults loaded levels, `isIgnored()`
 * loads every ancestor level first and also checks the ancestor directories.
 */
export class IgnoreRules {
  private readonly levels = new Map<string, Ignore | null>();
  private readonly loading = new Map<string, Promise<void>>();

  constructor(readonly root: string) {}

  /** Load `<dirRel>/.gitignore` (once). */
  load(dirRel: string): Promise<void> {
    if (this.levels.has(dirRel)) return Promise.resolve();
    let pending = this.loading.get(dirRel);
    if (!pending) {
      pending = (async () => {
        let rules: Ignore | null = null;
        try {
          const file = join(this.root, ...(dirRel ? dirRel.split('/') : []), '.gitignore');
          const text = await readFile(file, 'utf8');
          if (text.length <= MAX_GITIGNORE_BYTES) rules = ignore().add(text);
        } catch {
          // no .gitignore here
        }
        this.levels.set(dirRel, rules);
        this.loading.delete(dirRel);
      })();
      this.loading.set(dirRel, pending);
    }
    return pending;
  }

  /** Mark a directory as having no .gitignore without touching the disk. */
  markEmpty(dirRel: string): void {
    if (!this.levels.has(dirRel)) this.levels.set(dirRel, null);
  }

  /** Is `rel` (folder-relative, forward slashes) ignored by the rules loaded so far? */
  ignores(rel: string, isDir: boolean): boolean {
    if (!rel) return false;
    const segments = rel.split('/');
    for (let i = 0; i < segments.length; i++) {
      const last = i === segments.length - 1;
      if (isDefaultIgnored(segments[i] as string, last ? isDir : true)) return true;
    }
    let ignored = false;
    for (let i = 0; i < segments.length; i++) {
      const rules = this.levels.get(segments.slice(0, i).join('/'));
      if (!rules) continue;
      const sub = segments.slice(i).join('/') + (isDir ? '/' : '');
      try {
        const result = rules.test(sub);
        if (result.ignored) ignored = true;
        else if (result.unignored) ignored = false;
      } catch {
        // `ignore` rejects some unusual path shapes; treat them as not ignored.
      }
    }
    return ignored;
  }

  /** Like ignores(), with every ancestor .gitignore loaded and ancestor directories checked. */
  async isIgnored(rel: string, isDir: boolean): Promise<boolean> {
    if (!rel) return false;
    const segments = rel.split('/');
    for (let i = 0; i < segments.length; i++) await this.load(segments.slice(0, i).join('/'));
    for (let i = 1; i < segments.length; i++) {
      if (this.ignores(segments.slice(0, i).join('/'), true)) return true;
    }
    return this.ignores(rel, isDir);
  }
}

/** Short-lived cache of IgnoreRules per folder (directory listings ask for them repeatedly). */
export class IgnoreRulesCache {
  private readonly entries = new Map<string, { at: number; rules: IgnoreRules }>();

  constructor(private readonly ttlMs = 30_000) {}

  get(root: string): IgnoreRules {
    const hit = this.entries.get(root);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.rules;
    const rules = new IgnoreRules(root);
    this.entries.set(root, { at: Date.now(), rules });
    if (this.entries.size > 50) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.entries.delete(oldest[0]);
    }
    return rules;
  }

  clear(): void {
    this.entries.clear();
  }
}
