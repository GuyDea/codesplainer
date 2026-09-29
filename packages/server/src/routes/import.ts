/** POST /api/import (conversation exports and workspace bundles). */
import type { FastifyInstance } from 'fastify';
import { importBodySchema } from '@codesplainer/shared';
import type { AppContext } from '../context';
import { parseWith } from '../http/validate';

/** Workspace bundles can be large. */
export const IMPORT_BODY_LIMIT = 64 * 1024 * 1024;

export function registerImportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (request) => {
    const body = parseWith(importBodySchema, request.body);
    return ctx.exchange.import(body);
  });
}
