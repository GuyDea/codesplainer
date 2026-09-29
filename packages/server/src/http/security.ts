/**
 * Request guard for a local server without accounts (onRequest hook: every request, 404s and the
 * UI included, before the body is parsed):
 * - Host must be localhost / 127.0.0.1 / [::1] / the configured host, any port
 *   (DNS-rebinding protection) -> 403 forbidden_host
 * - Origin, when present, must be http(s)://<allowed host>[:port] -> 403 forbidden_origin
 * - every non-GET/HEAD/OPTIONS request must send `x-codesplainer: 1` (a cross-site form or fetch
 *   cannot set it without a CORS preflight) -> 403 missing_client_header. The contract asks for this
 *   under /api; it is enforced for every path so percent-encoded variants of /api (which the router
 *   decodes, e.g. /%61pi/...) cannot slip past a path check. Nothing outside /api accepts writes.
 * No CORS headers are ever sent.
 */
import type { FastifyInstance } from 'fastify';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@codesplainer/shared';
import { forbidden } from '../errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

/** Host names (no port) accepted in Host / Origin headers. */
export function allowedHostnames(configuredHost: string): Set<string> {
  const set = new Set(['localhost', '127.0.0.1', '::1']);
  if (configuredHost.trim()) set.add(normalizeHost(configuredHost));
  return set;
}

/** Host name part of a Host header ("[::1]:4777" -> "::1", "localhost:80" -> "localhost"). */
export function hostnameOf(hostHeader: string): string | undefined {
  const value = hostHeader.trim();
  if (!value) return undefined;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return undefined;
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return undefined;
    return normalizeHost(value.slice(1, end));
  }
  const colon = value.indexOf(':');
  if (colon >= 0) {
    if (value.indexOf(':', colon + 1) >= 0) return undefined; // bare IPv6 without brackets
    if (!/^\d{1,5}$/.test(value.slice(colon + 1))) return undefined;
    return normalizeHost(value.slice(0, colon));
  }
  return normalizeHost(value);
}

export function isAllowedOrigin(origin: string, hosts: Set<string>): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) return false;
  return hosts.has(normalizeHost(url.hostname));
}

export function registerSecurity(app: FastifyInstance, configuredHost: string): void {
  const hosts = allowedHostnames(configuredHost);
  app.addHook('onRequest', async (request) => {
    const host = request.headers.host;
    const hostname = typeof host === 'string' ? hostnameOf(host) : undefined;
    if (!hostname || !hosts.has(hostname)) {
      throw forbidden(
        'forbidden_host',
        'This server only answers requests addressed to localhost (Host header rejected).',
      );
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(String(origin), hosts)) {
      throw forbidden('forbidden_origin', 'Cross-origin requests are not allowed.');
    }
    if (!SAFE_METHODS.has(request.method)) {
      const value = request.headers[CLIENT_HEADER];
      if (value !== CLIENT_HEADER_VALUE) {
        throw forbidden(
          'missing_client_header',
          `Requests that change data must send the "${CLIENT_HEADER}: ${CLIENT_HEADER_VALUE}" header.`,
        );
      }
    }
  });
  // A few cheap hardening headers for everything we send.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });
}
