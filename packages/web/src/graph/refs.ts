import { baseName, type CodeRef } from '@codesplainer/shared';

/**
 * Compact text of a ref chip: `api.ts:42` or `src/`. The folder alias of multi-folder workspaces
 * is left to the tooltip (refTitle): in the chip it crowded out the line number.
 */
export function refChipText(ref: CodeRef, _multiFolder = false): string {
  const name = ref.path ? `${baseName(ref.path)}${ref.isDir ? '/' : ''}` : `${ref.folder ?? ''}/`;
  const line = ref.startLine ? `:${ref.startLine}` : '';
  return `${name}${line}`;
}

/** Full, human readable location of a ref (used for tooltips / aria labels). */
export function refTitle(ref: CodeRef): string {
  const path = ref.path || '/';
  const folder = ref.folder ? `${ref.folder}:` : '';
  const lines = ref.startLine
    ? `:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ''}`
    : '';
  const symbol = ref.symbol ? ` (${ref.symbol})` : '';
  return `${folder}${path}${lines}${symbol}`;
}
