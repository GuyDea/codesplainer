/** Small networking helpers shared by the CLI (index.ts) and the embedded server (start.ts). */
import { createServer } from 'node:net';

/** Host used in URLs: wildcard binds are reached through localhost; IPv6 needs brackets. */
export function urlHost(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Address of the UI served on host:port. */
export function serverUrl(host: string, port: number): string {
  return `http://${urlHost(host)}:${port}/`;
}

/**
 * False when something already listens on host:port (port 0 means "any free port": always
 * true). Other errors are left to the real listen() call, which reports them.
 */
export function portIsFree(host: string, port: number): Promise<boolean> {
  if (port === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (e: NodeJS.ErrnoException) => resolve(e.code !== 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen({ host, port, exclusive: true });
  });
}
