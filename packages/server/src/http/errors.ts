/**
 * Error rendering: every failure becomes `{ error: { code, message, details? } }` (ApiError) with
 * a meaningful status. HttpError keeps its status/code; zod errors are 400; Fastify's own client
 * errors (bad JSON, too large, unsupported media type) keep their status; the rest is a 500.
 */
import type { FastifyError, FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiError } from '@codesplainer/shared';
import { isHttpError } from '../errors';
import type { Logger } from '../log';

const FASTIFY_CODES: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_request',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'invalid_request',
  FST_ERR_CTP_INVALID_JSON_BODY: 'invalid_request',
};

function body(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export function registerErrorHandler(app: FastifyInstance, log: Logger): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (isHttpError(error)) {
      return reply.status(error.status).send(body(error.code, error.message, error.details));
    }
    if (error instanceof z.ZodError) {
      return reply
        .status(400)
        .send(body('invalid_request', 'Invalid request.', z.prettifyError(error)));
    }
    const status = (error as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const fastifyCode = (error as FastifyError).code;
      const code =
        (fastifyCode && FASTIFY_CODES[fastifyCode]) ||
        (status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'invalid_request');
      return reply.status(status).send(body(code, error.message || 'Bad request.'));
    }
    log.error(`${request.method} ${request.url.split('?')[0]} failed`, error);
    return reply
      .status(500)
      .send(
        body(
          'internal_error',
          error.message ? `Internal error: ${error.message}` : 'Internal error.',
        ),
      );
  });
}
