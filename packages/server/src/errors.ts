/**
 * HTTP-aware errors. Anything thrown from a route handler (or a module it calls) as HttpError is
 * rendered as `{ error: { code, message, details } }` with the given status (see ApiError in
 * @codesplainer/shared). Other errors become 500 `internal_error`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'invalid_request', message, details);

export const forbidden = (code: string, message: string) => new HttpError(403, code, message);

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);

export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
