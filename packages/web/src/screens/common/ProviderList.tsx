import { CircleCheck, CircleX, Settings } from 'lucide-react';
import { PROVIDER_IDS } from '@codesplainer/shared';
import { cn } from '../../lib/cn';
import { openSettings, useAppStore } from '../../store';
import { Spinner } from '../../ui';

/** Detected agent CLIs with ✓/✗ and the reason when missing. */
export function ProviderList({ className }: { className?: string }) {
  const providers = useAppStore((s) => s.providers);
  const loaded = useAppStore((s) => s.providersLoaded);
  const ordered = PROVIDER_IDS.map((id) => providers.find((p) => p.id === id)).filter(
    (p): p is NonNullable<typeof p> => Boolean(p),
  );
  return (
    <section aria-label="Agents on this machine" className={cn('w-full', className)}>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h2 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">
          Agents on this machine
        </h2>
        <button
          type="button"
          onClick={() => openSettings('providers')}
          className="inline-flex items-center gap-1 rounded px-1 text-xs text-muted hover:text-fg"
        >
          <Settings size={12} aria-hidden />
          Settings
        </button>
      </div>
      {!loaded ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-left">
          {ordered.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
              {p.available ? (
                <CircleCheck size={15} className="shrink-0 text-ok" aria-label="Available" />
              ) : (
                <CircleX size={15} className="shrink-0 text-subtle" aria-label="Not available" />
              )}
              <span
                className={cn(
                  'shrink-0 text-[13px] font-medium whitespace-nowrap',
                  p.available ? 'text-fg' : 'text-muted',
                )}
              >
                {p.name}
              </span>
              <span
                className="ml-auto min-w-0 truncate text-xs text-subtle"
                title={p.reason ?? p.command}
              >
                {p.available
                  ? p.enabled
                    ? (p.version ?? 'ready')
                    : 'disabled'
                  : (p.reason ?? 'not found')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
