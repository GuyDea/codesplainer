/** Request validation with the shared zod schemas (400 invalid_request with prettified details). */
import { z } from 'zod';
import { badRequest } from '../errors';

function summary(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid value';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Parse `value` or throw HttpError 400. `what` names the thing in the message. */
export function parseWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what = 'request body',
): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw badRequest(`Invalid ${what}: ${summary(result.error)}`, z.prettifyError(result.error));
  }
  return result.data;
}

/** Query flag: 1/0, true/false, yes/no, on/off (missing = false). */
export const queryFlag = z
  .union([z.string(), z.boolean(), z.number()])
  .optional()
  .transform((v) => (typeof v === 'string' ? /^(1|true|yes|on)$/i.test(v.trim()) : Boolean(v)));
