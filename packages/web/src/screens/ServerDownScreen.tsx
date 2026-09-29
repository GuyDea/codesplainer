import { useEffect, useState } from 'react';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { DEFAULT_PORT } from '@codesplainer/shared';
import { bootstrap, getState, useAppStore } from '../store';
import { Button } from '../ui';

const RETRY_SECONDS = 5;

/** Shown when the local server cannot be reached; retries by itself. */
export function ServerDownScreen() {
  const error = useAppStore((s) => s.connectionError);
  const retrying = useAppStore((s) => s.connection === 'connecting');
  const [countdown, setCountdown] = useState(RETRY_SECONDS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((c) => {
        if (c > 1) return c - 1;
        if (getState().connection === 'offline') void bootstrap();
        return RETRY_SECONDS;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center animate-fade-in">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <ServerCrash size={24} aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-fg">Can&apos;t reach the Codesplainer server</h1>
        <p className="text-[13px] text-muted">
          It runs on this machine (port {DEFAULT_PORT}). Start it with{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-fg">
            npm run dev
          </code>{' '}
          and this page reconnects on its own.
        </p>
        <Button
          variant="primary"
          icon={RefreshCw}
          loading={retrying}
          onClick={() => {
            setCountdown(RETRY_SECONDS);
            void bootstrap();
          }}
        >
          Retry now
        </Button>
        <p className="text-xs text-subtle" aria-live="polite">
          {retrying ? 'Connecting…' : `Retrying in ${countdown} s`}
        </p>
        {error ? <p className="font-mono text-[11px] text-subtle">{error}</p> : null}
      </div>
    </div>
  );
}
