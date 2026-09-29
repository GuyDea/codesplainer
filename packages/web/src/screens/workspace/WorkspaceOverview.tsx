import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { FileCode, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  formatBytes,
  type LanguageStat,
  type WorkspaceOverview as Overview,
} from '@codesplainer/shared';
import { api, errorMessage } from '../../lib/api';
import { formatCount, formatPercent } from '../../lib/format';
import { IconButton, Tooltip } from '../../ui';

/** Hues for the language bar (fed to the .kind-solid token class, so light/dark both work). */
const HUES = [255, 155, 45, 305, 200, 85, 355, 115];
const MAX_LANGUAGES = 6;

function hueStyle(index: number | null): CSSProperties {
  return (
    index === null
      ? { '--kind-h': 260, '--kind-c': 0.1 }
      : { '--kind-h': HUES[index % HUES.length], '--kind-c': 0.9 }
  ) as CSSProperties;
}

export function WorkspaceOverview({
  workspaceId,
  multiFolder,
}: {
  workspaceId: string;
  multiFolder: boolean;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const overview = await api.getOverview(workspaceId, refresh, signal);
        setData(overview);
      } catch (err) {
        if (signal?.aborted) return;
        setError(errorMessage(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const languages = data?.languages ?? [];
  const totalBytes = languages.reduce((sum, l) => sum + l.bytes, 0);
  const top = languages.slice(0, MAX_LANGUAGES);
  const otherBytes = languages.slice(MAX_LANGUAGES).reduce((sum, l) => sum + l.bytes, 0);
  const segments: {
    stat: LanguageStat | null;
    bytes: number;
    label: string;
    index: number | null;
  }[] = [
    ...top.map((stat, index) => ({ stat, bytes: stat.bytes, label: stat.language, index })),
    ...(otherBytes > 0 ? [{ stat: null, bytes: otherBytes, label: 'Other', index: null }] : []),
  ];
  const manifests = (data?.folders ?? []).flatMap((f) =>
    f.manifests.map((m) => ({
      key: `${f.alias}:${m}`,
      label: multiFolder ? `${f.alias}/${m}` : m,
    })),
  );
  const missing = (data?.folders ?? []).filter((f) => !f.exists);
  const truncated = (data?.folders ?? []).some((f) => f.truncated);

  return (
    <section
      aria-label="Overview"
      aria-busy={loading}
      className="rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[13px]">
        <FileCode size={14} className="text-subtle" aria-hidden />
        {data ? (
          <span className="text-fg">
            <span className="font-medium tabular-nums">{formatCount(data.totals.files)}</span>
            <span className="text-muted"> files · </span>
            <span className="font-medium tabular-nums">{formatBytes(data.totals.bytes)}</span>
            {truncated ? (
              <Tooltip label="Large workspace: the scan stopped early.">
                <span className="ml-1 text-xs text-subtle">(partial)</span>
              </Tooltip>
            ) : null}
          </span>
        ) : error ? (
          <span className="truncate text-xs text-danger">{error}</span>
        ) : (
          <span className="h-3 w-40 animate-pulse-soft rounded bg-surface-2" aria-hidden />
        )}
        <IconButton
          icon={RefreshCw}
          label="Rescan"
          size="xs"
          className="ml-auto"
          disabled={loading}
          onClick={() => void load(true)}
        />
      </div>

      {segments.length && totalBytes > 0 ? (
        <>
          <div
            className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
            role="img"
            aria-label={segments
              .map((s) => `${s.label} ${formatPercent(s.bytes / totalBytes)}`)
              .join(', ')}
          >
            {segments.map((s) => (
              <span
                key={s.label}
                style={{ ...hueStyle(s.index), width: `${(s.bytes / totalBytes) * 100}%` }}
                className="kind-solid h-full min-w-[3px] border-r border-surface last:border-r-0"
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {segments.map((s) => (
              <li key={s.label} className="inline-flex items-center gap-1.5">
                <span
                  style={hueStyle(s.index)}
                  className="kind-solid h-2 w-2 rounded-full"
                  aria-hidden
                />
                <span className="text-fg">{s.label}</span>
                <span className="tabular-nums text-subtle">
                  {formatPercent(s.bytes / totalBytes)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {manifests.length ? (
        <ul aria-label="Manifests" className="mt-2.5 flex flex-wrap gap-1">
          {manifests.slice(0, 12).map((m) => (
            <li
              key={m.key}
              className="inline-flex h-5 items-center rounded-md border border-border px-1.5 font-mono text-[11px] text-muted"
            >
              {m.label}
            </li>
          ))}
          {manifests.length > 12 ? (
            <li className="inline-flex h-5 items-center px-1 text-[11px] text-subtle">
              +{manifests.length - 12}
            </li>
          ) : null}
        </ul>
      ) : null}

      {missing.length ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warn">
          <TriangleAlert size={12} aria-hidden />
          Not found: {missing.map((f) => f.path).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
