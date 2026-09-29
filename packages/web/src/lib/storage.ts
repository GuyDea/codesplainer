/** Safe localStorage access (private mode / disabled storage never throws). */

export const STORAGE_KEYS = {
  theme: 'codesplainer.theme',
  askPrefs: 'codesplainer.ask',
  sidebar: 'codesplainer.sidebar',
  legend: 'codesplainer.legend',
  lastGraph: (conversationId: string) => `codesplainer.lastGraph.${conversationId}`,
} as const;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // quota / disabled: ignore
  }
}

export function removeItem(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}
