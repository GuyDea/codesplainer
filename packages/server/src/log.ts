/**
 * Minimal logger. The server keeps its output quiet: Fastify's logger is off and only concise
 * lines of our own are printed. Tests inject a silent (or capturing) logger.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

/** Prints to stdout/stderr with a short level prefix. */
export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
  error: (message, err) => console.error(`error: ${message}${err ? `\n${describe(err)}` : ''}`),
};

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Collects messages (handy in tests). */
export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info: ${m}`),
    warn: (m) => lines.push(`warn: ${m}`),
    error: (m, err) => lines.push(`error: ${m}${err ? ` (${describe(err)})` : ''}`),
  };
}
