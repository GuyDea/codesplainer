/**
 * Reading workspace files: the code viewer (up to 1.5 MB, binary detection), code snippets for
 * "ask about this code" prompts and line counting for ref validation.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import type { CodeRef, FileContent, Workspace } from '@codesplainer/shared';
import { badRequest } from '../errors';
import { languageId } from './languages';
import { resolveInFolder } from './paths';

export const FILE_LIMIT_BYTES = 1.5 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
export const SNIPPET_MAX_LINES = 400;
export const SNIPPET_MAX_BYTES = 40 * 1024;
/** Snippets are cut from the first bytes of a file only. */
const SNIPPET_READ_BYTES = 8 * 1024 * 1024;

/** Number of lines in a text ("a\nb" and "a\nb\n" both have 2; "" has 0). */
export function countTextLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return text.endsWith('\n') ? n : n + 1;
}

/** Read the first `limit` bytes of a file. */
async function readHead(path: string, limit: number): Promise<{ buf: Buffer; size: number }> {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(size, limit);
    const buf = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buf, offset, length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return { buf: buf.subarray(0, offset), size };
  } finally {
    await handle.close();
  }
}

const isBinary = (buf: Buffer) => buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);

function decode(buf: Buffer): string {
  const text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** GET /api/workspaces/:id/file */
export async function readWorkspaceFile(
  workspace: Workspace,
  alias: string | undefined,
  relPath: string,
): Promise<FileContent> {
  const target = await resolveInFolder(workspace, alias, relPath);
  if (target.stats.isDirectory()) throw badRequest(`"${target.rel}" is a folder, not a file.`);
  if (!target.stats.isFile()) throw badRequest(`"${target.rel}" is not a regular file.`);
  const { buf, size } = await readHead(target.real, FILE_LIMIT_BYTES);
  const language = languageId(basename(target.rel));
  const base = {
    folder: target.folder.alias,
    path: target.rel,
    absolutePath: target.abs,
    size,
    ...(language ? { language } : {}),
  };
  if (isBinary(buf)) {
    return { ...base, lineCount: 0, truncated: false, binary: true, content: '' };
  }
  let body = buf;
  const truncated = size > buf.length;
  if (truncated) {
    // Keep whole lines (and never split a multi-byte character).
    const nl = body.lastIndexOf(0x0a);
    if (nl > body.length - 64 * 1024) body = body.subarray(0, nl + 1);
  }
  const content = decode(body);
  return { ...base, lineCount: countTextLines(content), truncated, binary: false, content };
}

/** Count the lines of a file by streaming it (binary-safe, bounded memory). */
export function countFileLines(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let lines = 0;
    let last = -1;
    let any = false;
    const stream = createReadStream(path);
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      if (!buf.length) return;
      any = true;
      for (let i = buf.indexOf(0x0a); i >= 0; i = buf.indexOf(0x0a, i + 1)) lines++;
      last = buf[buf.length - 1] ?? -1;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(!any ? 0 : last === 0x0a ? lines : lines + 1));
  });
}

export interface CodeSnippet {
  /** The ref with the line range actually included. */
  ref: CodeRef;
  text: string;
  language?: string;
}

/**
 * The selected code of an ask-code ref: at most 400 lines / 40 KB, line range clamped to the
 * file. Undefined for binary files and empty selections.
 */
export async function readCodeSnippet(
  realPath: string,
  ref: CodeRef,
): Promise<CodeSnippet | undefined> {
  const { buf } = await readHead(realPath, SNIPPET_READ_BYTES);
  if (isBinary(buf)) return undefined;
  const lines = decode(buf).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) return undefined;
  const total = lines.length;
  let start = Math.min(Math.max(1, ref.startLine ?? 1), total);
  let end = ref.endLine ?? (ref.startLine !== undefined ? start : total);
  if (end < start) [start, end] = [end, start];
  start = Math.max(1, start);
  end = Math.min(total, end, start + SNIPPET_MAX_LINES - 1);
  const picked: string[] = [];
  let bytes = 0;
  for (let n = start; n <= end; n++) {
    const line = lines[n - 1] ?? '';
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > SNIPPET_MAX_BYTES && picked.length) break;
    picked.push(line);
  }
  const last = start + picked.length - 1;
  const language = languageId(basename(ref.path));
  return {
    ref: { ...ref, startLine: start, endLine: last },
    text: picked.join('\n'),
    ...(language ? { language } : {}),
  };
}
