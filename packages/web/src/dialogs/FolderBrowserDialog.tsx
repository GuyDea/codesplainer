import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronRight,
  CornerDownLeft,
  Folder,
  FolderGit2,
  FolderPlus,
  House,
  X,
} from 'lucide-react';
import { baseName, type BrowseResult } from '@codesplainer/shared';
import { api, errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { Button, Dialog, IconButton, Input, Spinner, Switch } from '../ui';

export interface FolderBrowserDialogProps {
  onClose: () => void;
  /** Absolute folder paths chosen by the user. */
  onSelect: (paths: string[]) => void;
  multiple?: boolean;
  initialPath?: string;
  title?: string;
}

interface Crumb {
  label: string;
  path: string;
}

/** Split an absolute path into clickable segments (POSIX and Windows). */
export function pathCrumbs(path: string, separator: string): Crumb[] {
  if (!path) return [];
  if (separator === '\\') {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    const crumbs: Crumb[] = [];
    let acc = '';
    parts.forEach((part, index) => {
      acc = index === 0 ? `${part}\\` : `${acc}${acc.endsWith('\\') ? '' : '\\'}${part}`;
      crumbs.push({ label: part, path: acc });
    });
    return crumbs;
  }
  const crumbs: Crumb[] = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of path.split('/').filter(Boolean)) {
    acc += `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** Server-side folder picker: navigate directories, tick several, or add the current one. */
export function FolderBrowserDialog({
  onClose,
  onSelect,
  multiple = true,
  initialPath,
  title = 'Choose folders',
}: FolderBrowserDialogProps) {
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState('');
  const request = useRef(0);
  const list = useRef<HTMLUListElement>(null);

  const load = useCallback(
    async (path: string | undefined, showHidden: boolean, fallbackHome = false) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      try {
        let res: BrowseResult;
        try {
          res = await api.browse(path, showHidden);
        } catch (err) {
          // A remembered/exported path may not exist here: start at home instead.
          if (!fallbackHome || !path) throw err;
          res = await api.browse(undefined, showHidden);
        }
        if (id !== request.current) return;
        setResult(res);
        setManual(res.path);
        list.current?.scrollTo?.({ top: 0 });
      } catch (err) {
        if (id !== request.current) return;
        setError(errorMessage(err));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(initialPath, false, true);
  }, [load, initialPath]);

  const current = result?.path ?? '';
  const crumbs = useMemo(() => (result ? pathCrumbs(result.path, result.separator) : []), [result]);
  const visibleCrumbs =
    crumbs.length > 5 ? [crumbs[0] as Crumb, null, ...crumbs.slice(-3)] : crumbs;

  const open = (path: string) => void load(path, hidden);
  const toggle = (path: string) =>
    setSelected((list) =>
      list.includes(path) ? list.filter((p) => p !== path) : multiple ? [...list, path] : [path],
    );
  const finish = (paths: string[]) => {
    if (!paths.length) return;
    onSelect(paths);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={title}
      initialFocus="[data-autofocus]"
      className="overflow-hidden"
      footer={
        <>
          <span className="mr-auto truncate text-xs text-muted">
            {selected.length
              ? `${selected.length} selected`
              : 'Tick folders, or add the one you are in.'}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={FolderPlus}
            variant={selected.length ? 'secondary' : 'primary'}
            disabled={!current || loading}
            onClick={() => finish([current])}
          >
            Add this folder
          </Button>
          {multiple && selected.length ? (
            <Button variant="primary" onClick={() => finish(selected)}>
              Add {selected.length} selected
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex h-[min(56vh,460px)] min-h-72 gap-3">
        <aside
          aria-label="Places"
          className="hidden w-40 shrink-0 flex-col gap-0.5 overflow-y-auto sm:flex"
        >
          {result ? (
            <PlaceButton
              icon={House}
              label="Home"
              active={current === result.home}
              onClick={() => open(result.home)}
            />
          ) : null}
          {result?.shortcuts
            .filter((s) => s.path !== result.home)
            .map((s) => (
              <PlaceButton
                key={s.path}
                icon={Folder}
                label={s.label}
                title={s.path}
                active={current === s.path}
                onClick={() => open(s.path)}
              />
            ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1">
            <IconButton
              icon={ArrowUp}
              label="Parent folder"
              size="xs"
              variant="secondary"
              disabled={!result?.parent || loading}
              onClick={() => result?.parent && open(result.parent)}
            />
            <nav
              aria-label="Path"
              className="flex min-w-0 flex-1 items-center overflow-hidden text-[13px]"
            >
              {visibleCrumbs.map((crumb, index) =>
                crumb === null ? (
                  <span key="ellipsis" className="px-1 text-subtle">
                    …
                  </span>
                ) : (
                  <span key={crumb.path} className="flex min-w-0 items-center">
                    {index > 0 && crumb.label !== '/' ? (
                      <ChevronRight size={12} className="shrink-0 text-subtle" aria-hidden />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => open(crumb.path)}
                      title={crumb.path}
                      className={cn(
                        'max-w-[18ch] truncate rounded px-1 py-0.5 hover:bg-surface-2',
                        crumb.path === current ? 'font-medium text-fg' : 'text-muted',
                      )}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ),
              )}
            </nav>
            <Switch
              checked={hidden}
              onChange={(value) => {
                setHidden(value);
                void load(current || undefined, value);
              }}
              label={<span className="text-xs font-normal text-muted">Hidden</span>}
              className="shrink-0 items-center! gap-2!"
            />
          </div>

          <div className="relative min-h-0 flex-1 rounded-lg border border-border bg-surface-2/40">
            {error ? (
              <div className="p-4 text-[13px] text-danger">{error}</div>
            ) : result && result.entries.length === 0 && !loading ? (
              <div className="flex h-full items-center justify-center text-[13px] text-subtle">
                No sub-folders
              </div>
            ) : (
              <ul
                ref={list}
                aria-label="Folders"
                className="h-full overflow-y-auto p-1"
                onKeyDown={(e) => {
                  if (
                    (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) &&
                    result?.parent
                  ) {
                    e.preventDefault();
                    open(result.parent);
                  }
                }}
              >
                {result?.entries.map((entry) => {
                  const checked = selected.includes(entry.path);
                  const Icon = entry.isGitRepo ? FolderGit2 : Folder;
                  return (
                    <li
                      key={entry.path}
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 hover:bg-surface-2',
                        checked && 'bg-accent-soft/60',
                      )}
                    >
                      {multiple ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${entry.name}`}
                          checked={checked}
                          onChange={() => toggle(entry.path)}
                          className="h-3.5 w-3.5 shrink-0 accent-accent"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => open(entry.path)}
                        className={cn(
                          'flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-[13px]',
                          entry.hidden ? 'text-muted' : 'text-fg',
                        )}
                      >
                        <Icon
                          size={15}
                          className={cn(
                            'shrink-0',
                            entry.isGitRepo ? 'text-accent' : 'text-subtle',
                          )}
                        />
                        <span className="truncate">{entry.name}</span>
                        {entry.isGitRepo ? (
                          <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-accent-soft px-1.5 text-[10px] font-medium text-accent">
                            git
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => finish([entry.path])}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent-soft"
                      >
                        Add
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-surface/40">
                <Spinner />
              </div>
            ) : null}
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = manual.trim();
              if (value) open(value);
            }}
          >
            <Input
              data-autofocus
              aria-label="Folder path"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="/path/to/folder"
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
            />
            <IconButton
              icon={CornerDownLeft}
              label="Go to path"
              type="submit"
              variant="secondary"
            />
          </form>

          {multiple && selected.length ? (
            <div className="flex flex-wrap gap-1">
              {selected.map((path) => (
                <span
                  key={path}
                  title={path}
                  className="inline-flex h-6 max-w-[22ch] items-center gap-1 rounded-full border border-border bg-surface px-2 text-xs text-fg"
                >
                  <span className="truncate">{baseName(path)}</span>
                  <button
                    type="button"
                    aria-label={`Unselect ${baseName(path)}`}
                    onClick={() => toggle(path)}
                    className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-fg"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function PlaceButton({
  icon: Icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: typeof Folder;
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px]',
        active
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
