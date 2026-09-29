import { z } from 'zod';

/** A folder that is part of a workspace. `alias` is unique within the workspace and used in refs. */
export const workspaceFolderSchema = z.object({
  alias: z.string().min(1),
  path: z.string().min(1),
});
export type WorkspaceFolder = z.infer<typeof workspaceFolderSchema>;

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  folders: z.array(workspaceFolderSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().optional(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const languageStatSchema = z.object({
  language: z.string(),
  files: z.number().int().nonnegative(),
  bytes: z.number().nonnegative(),
});
export type LanguageStat = z.infer<typeof languageStatSchema>;

/** Result of scanning one workspace folder (ignores .git, node_modules, build output, .gitignore). */
export const folderOverviewSchema = z.object({
  alias: z.string(),
  path: z.string(),
  exists: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  dirCount: z.number().int().nonnegative(),
  totalBytes: z.number().nonnegative(),
  /** True when the scan hit its file/time budget. */
  truncated: z.boolean(),
  languages: z.array(languageStatSchema),
  /** Manifest / entry files relative to the folder root (package.json, go.mod, Dockerfile...). */
  manifests: z.array(z.string()),
  isGitRepo: z.boolean(),
});
export type FolderOverview = z.infer<typeof folderOverviewSchema>;

export const workspaceOverviewSchema = z.object({
  workspaceId: z.string(),
  scannedAt: z.string(),
  folders: z.array(folderOverviewSchema),
  totals: z.object({ files: z.number(), bytes: z.number() }),
  languages: z.array(languageStatSchema),
});
export type WorkspaceOverview = z.infer<typeof workspaceOverviewSchema>;

/** One entry of a directory listing inside a workspace folder. */
export const dirEntrySchema = z.object({
  name: z.string(),
  /** Relative to the folder root, forward slashes. */
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().optional(),
  /** Matched by ignore rules (node_modules, .gitignore...). Still listed so users can browse. */
  ignored: z.boolean().optional(),
});
export type DirEntry = z.infer<typeof dirEntrySchema>;

export const dirListingSchema = z.object({
  folder: z.string(),
  path: z.string(),
  entries: z.array(dirEntrySchema),
  truncated: z.boolean(),
});
export type DirListing = z.infer<typeof dirListingSchema>;

export const fileContentSchema = z.object({
  folder: z.string(),
  path: z.string(),
  absolutePath: z.string(),
  size: z.number(),
  lineCount: z.number(),
  /** Content was cut at the size limit. */
  truncated: z.boolean(),
  /** Binary files are not returned (content is empty). */
  binary: z.boolean(),
  /** Best-effort language id derived from the file name (e.g. "typescript"). */
  language: z.string().optional(),
  content: z.string(),
});
export type FileContent = z.infer<typeof fileContentSchema>;

/** Folder picker listing of the local filesystem (directories only). */
export const browseEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
  isGitRepo: z.boolean().optional(),
});
export type BrowseEntry = z.infer<typeof browseEntrySchema>;

export const browseResultSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  home: z.string(),
  separator: z.string(),
  entries: z.array(browseEntrySchema),
  /** Suggested starting points (home, cwd, recent workspace folders). */
  shortcuts: z.array(z.object({ label: z.string(), path: z.string() })),
});
export type BrowseResult = z.infer<typeof browseResultSchema>;
