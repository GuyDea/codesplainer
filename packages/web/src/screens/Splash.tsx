import { useEffect, useState } from 'react';
import { LogoMark } from '../app/Logo';
import { Spinner } from '../ui';

/** Startup placeholder (appears only if connecting takes a moment, to avoid a flash). */
export function Splash() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 animate-fade-in"
      aria-busy="true"
    >
      <LogoMark size={36} />
      <Spinner size={16} />
    </div>
  );
}
