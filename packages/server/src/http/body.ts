/**
 * JSON body parsing: an empty body counts as `{}` (the web client sends `{}`, other clients may
 * send nothing with a JSON content type), invalid JSON is a 400, and `__proto__` keys are dropped.
 */
import type { FastifyInstance } from 'fastify';
import { badRequest } from '../errors';

export function parseJsonBody(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text, (key, value: unknown) => (key === '__proto__' ? undefined : value));
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

export function registerJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, raw, done) => {
    try {
      done(null, parseJsonBody(typeof raw === 'string' ? raw : raw.toString('utf8')));
    } catch (e) {
      done(e as Error, undefined);
    }
  });
}
