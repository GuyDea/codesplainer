import { useRef } from 'react';

/** Returns the previous reference while the value is structurally (JSON) equal. */
export function useStableJson<T>(value: T): T {
  const ref = useRef<{ key: string; value: T } | null>(null);
  const key = JSON.stringify(value);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}
