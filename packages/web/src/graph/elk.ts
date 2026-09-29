/**
 * Lazily loaded, shared ELK instance. elkjs is large (~1.4 MB), so it is split into its own
 * chunk and only fetched when the first layout runs.
 */
import type { ELK } from 'elkjs/lib/elk-api';

let instance: Promise<ELK> | undefined;

export function getElk(): Promise<ELK> {
  instance ??= import('elkjs/lib/elk.bundled.js').then((mod) => new mod.default());
  return instance;
}
