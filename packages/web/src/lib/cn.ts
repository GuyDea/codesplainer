import clsx, { type ClassValue } from 'clsx';

/** Join class names (clsx). */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
