/**
 * Workspace scanning: one bounded breadth-first walk per folder (ignore rules applied) that
 * produces the FolderOverview (counts, languages by bytes, manifests, git) and a compact
 * directory model used to render the prompt tree (see tree.ts).
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FolderOverview,
  LanguageStat,
  Workspace,
  WorkspaceFolder,
  WorkspaceOverview,
} from '@codesplainer/shared';
import { IgnoreRules } from './ignore';
import { languageName } from './languages';

export const SCAN_MAX_FILES = 100_000;
export const SCAN_TIME_BUDGET_MS = 4_000;
/** Manifests deeper than this many directories are not reported. */
export const MANIFEST_MAX_DEPTH = 3;
const MAX_MANIFESTS = 100;
/** File names kept per directory for the tree (besides notable files). */
const SAMPLE_FILES = 12;
const STAT_CONCURRENCY = 64;

export interface ScanOptions {
  maxFiles?: number;
  timeBudgetMs?: number;
}

/** A directory in the scanned tree. `files` counts direct files, `total` the whole subtree. */
export interface DirNode {
  name: string;
  rel: string;
  depth: number;
  files: number;
  total: number;
  /** Some file names of this directory (notable files first, then the first few). */
  fileNames: string[];
  notable: string[];
  dirs: DirNode[];
}

export interface FolderScan {
  folder: WorkspaceFolder;
  overview: FolderOverview;
  /** null when the folder does not exist. */
  tree: DirNode | null;
}

export interface WorkspaceScan {
  overview: WorkspaceOverview;
  folders: FolderScan[];
}

const MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'go.mod',
  'cargo.toml',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gemfile',
  'composer.json',
  'mix.exs',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'makefile',
  'cmakelists.txt',
]);

/** Build / package manifests and READMEs. */
export function isManifest(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    MANIFEST_NAMES.has(lower) ||
    lower.endsWith('.csproj') ||
    lower.endsWith('.sln') ||
    lower.startsWith('readme')
  );
}

const ENTRY_POINT = /^(?:main|index|app|server|cli|program)\.[a-z0-9]+$/i;
const ENTRY_NAMES = new Set(['__main__.py', 'program.cs', 'lib.rs', 'mod.rs', 'manage.py']);

/** Files worth showing in a compact tree: manifests, READMEs and typical entry points. */
export function isNotableFile(name: string): boolean {
  return isManifest(name) || ENTRY_POINT.test(name) || ENTRY_NAMES.has(name.toLowerCase());
}

function emptyOverview(folder: WorkspaceFolder, exists: boolean): FolderOverview {
  return {
    alias: folder.alias,
    path: folder.path,
    exists,
    fileCount: 0,
    dirCount: 0,
    totalBytes: 0,
    truncated: false,
    languages: [],
    manifests: [],
    isGitRepo: false,
  };
}

async function sizes(paths: string[]): Promise<number[]> {
  const out = new Array<number>(paths.length).fill(0);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      out[i] = (await stat(paths[i] as string).catch(() => undefined))?.size ?? 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, paths.length) }, worker));
  return out;
}

function sortLanguages(map: Map<string, { files: number; bytes: number }>): LanguageStat[] {
  return [...map.entries()]
    .map(([language, v]) => ({ language, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.language.localeCompare(b.language));
}

function finishTree(node: DirNode): number {
  node.dirs.sort((a, b) => a.name.localeCompare(b.name));
  node.total = node.files + node.dirs.reduce((sum, d) => sum + finishTree(d), 0);
  return node.total;
}

/** Scan one workspace folder within the file/time budget. Never throws for missing folders. */
export async function scanFolder(
  folder: WorkspaceFolder,
  opts: ScanOptions = {},
): Promise<FolderScan> {
  const maxFiles = opts.maxFiles ?? SCAN_MAX_FILES;
  const budgetMs = opts.timeBudgetMs ?? SCAN_TIME_BUDGET_MS;
  const started = Date.now();
  const root = folder.path;
  const rootStat = await stat(root).catch(() => undefined);
  if (!rootStat?.isDirectory()) {
    return { folder, overview: emptyOverview(folder, false), tree: null };
  }
  const isGitRepo = await stat(join(root, '.git')).then(
    () => true,
    () => false,
  );

  const rules = new IgnoreRules(root);
  const tree: DirNode = {
    name: '',
    rel: '',
    depth: 0,
    files: 0,
    total: 0,
    fileNames: [],
    notable: [],
    dirs: [],
  };
  const languages = new Map<string, { files: number; bytes: number }>();
  const manifests: { path: string; depth: number }[] = [];
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  let truncated = false;
  const outOfBudget = () => fileCount >= maxFiles || Date.now() - started > budgetMs;

  const queue: DirNode[] = [tree];
  for (let head = 0; head < queue.length; head++) {
    if (outOfBudget()) {
      truncated = true;
      break;
    }
    const node = queue[head] as DirNode;
    let entries: Dirent[];
    try {
      entries = await readdir(node.rel ? join(root, ...node.rel.split('/')) : root, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    if (entries.some((e) => e.name === '.gitignore' && e.isFile())) await rules.load(node.rel);
    else rules.markEmpty(node.rel);

    const files: string[] = [];
    for (const entry of entries) {
      const rel = node.rel ? `${node.rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (rules.ignores(rel, true)) continue;
        const child: DirNode = {
          name: entry.name,
          rel,
          depth: node.depth + 1,
          files: 0,
          total: 0,
          fileNames: [],
          notable: [],
          dirs: [],
        };
        node.dirs.push(child);
        queue.push(child);
        dirCount++;
      } else if (entry.isFile()) {
        if (!rules.ignores(rel, false)) files.push(entry.name);
      }
    }
    files.sort((a, b) => a.localeCompare(b));
    const room = Math.max(0, maxFiles - fileCount);
    if (files.length > room) {
      files.length = room;
      truncated = true;
    }
    const fileSizes = await sizes(files.map((name) => join(root, ...node.rel.split('/'), name)));
    files.forEach((name, i) => {
      const size = fileSizes[i] ?? 0;
      fileCount++;
      totalBytes += size;
      node.files++;
      const language = languageName(name);
      if (language) {
        const counts = languages.get(language) ?? { files: 0, bytes: 0 };
        counts.files++;
        counts.bytes += size;
        languages.set(language, counts);
      }
      const notable = isNotableFile(name);
      if (notable) node.notable.push(name);
      if (notable || node.fileNames.length < SAMPLE_FILES) node.fileNames.push(name);
      if (node.depth <= MANIFEST_MAX_DEPTH && isManifest(name)) {
        manifests.push({ path: node.rel ? `${node.rel}/${name}` : name, depth: node.depth });
      }
    });
  }
  finishTree(tree);

  manifests.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  return {
    folder,
    tree,
    overview: {
      alias: folder.alias,
      path: folder.path,
      exists: true,
      fileCount,
      dirCount,
      totalBytes,
      truncated,
      languages: sortLanguages(languages),
      manifests: manifests.slice(0, MAX_MANIFESTS).map((m) => m.path),
      isGitRepo,
    },
  };
}

/** Scan all folders of a workspace (in parallel, each with its own budget). */
export async function scanWorkspace(
  workspace: Workspace,
  opts: ScanOptions = {},
): Promise<WorkspaceScan> {
  const folders = await Promise.all(workspace.folders.map((f) => scanFolder(f, opts)));
  const languages = new Map<string, { files: number; bytes: number }>();
  for (const scan of folders) {
    for (const l of scan.overview.languages) {
      const counts = languages.get(l.language) ?? { files: 0, bytes: 0 };
      counts.files += l.files;
      counts.bytes += l.bytes;
      languages.set(l.language, counts);
    }
  }
  return {
    folders,
    overview: {
      workspaceId: workspace.id,
      scannedAt: new Date().toISOString(),
      folders: folders.map((s) => s.overview),
      totals: {
        files: folders.reduce((n, s) => n + s.overview.fileCount, 0),
        bytes: folders.reduce((n, s) => n + s.overview.totalBytes, 0),
      },
      languages: sortLanguages(languages),
    },
  };
}
