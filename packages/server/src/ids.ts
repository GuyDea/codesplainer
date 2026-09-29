import { customAlphabet } from 'nanoid';

const generate = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

/** Short, URL-safe, lower-case id used for workspaces, conversations and diagrams. */
export function newId(): string {
  return generate();
}
