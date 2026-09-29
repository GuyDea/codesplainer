/** Internal wiring shared by the registry and the provider modules. */
import type { ProcessTracker } from './process';
import type { AgentProvider } from './types';

export interface ProviderContext {
  /** Codesplainer data directory; providers keep files under it (kiro-home, tmp, cache). */
  dataDir: string;
  /** Tracks child processes so the registry can kill them on dispose(). */
  tracker: ProcessTracker;
  /** Home directory used to discover CLIs (overridable for tests). */
  homeDir: string;
}

/** A provider module exports one factory; the registry lists them in PROVIDER_IDS order. */
export type ProviderFactory = (ctx: ProviderContext) => AgentProvider;
