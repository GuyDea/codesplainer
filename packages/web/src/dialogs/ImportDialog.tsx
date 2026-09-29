import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  CircleAlert,
  CircleCheck,
  FileBraces,
  FileUp,
  FolderSearch,
  MessagesSquare,
} from 'lucide-react';
import {
  importedConversations,
  parseImportPayload,
  type ImportBody,
  type ImportPayload,
  type Workspace,
} from '@codesplainer/shared';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { plural } from '../lib/format';
import { currentRoute, navigate, routes } from '../lib/router';
import { importData, sortWorkspacesRecent, toast, useAppStore } from '../store';
import { Button, Dialog, Field, Input, Segmented, Select, Spinner, Tooltip } from '../ui';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { checkFolders, cleanPath, parentDir, type FolderCheck } from './folderChecks';

interface Parsed {
  fileName: string;
  raw: unknown;
  payload: ImportPayload;
}

type Target = 'existing' | 'new';

function samePaths(workspace: Pick<Workspace, 'folders'>, paths: string[]): boolean {
  const a = workspace.folders.map((f) => cleanPath(f.path)).sort();
  const b = paths.map(cleanPath).sort();
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/** Read a .codesplainer.json export, show what is inside, choose where it goes, import. */
export function ImportDialog({
  initialFile,
  onClose,
}: {
  initialFile?: File;
  onClose: () => void;
}) {
  const workspaces = useAppStore((s) => s.workspaces);
  const sorted = useMemo(() => sortWorkspacesRecent(workspaces), [workspaces]);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reading, setReading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>('new');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [folderMap, setFolderMap] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, FolderCheck>>({});
  const [browseAlias, setBrowseAlias] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setReading(true);
    setParseError(null);
    setParsed(null);
    setSubmitError(null);
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      const result = parseImportPayload(raw);
      if (!result.ok) throw new Error(result.error);
      const exported = result.payload.data.workspace;
      setParsed({ fileName: file.name, raw, payload: result.payload });
      setWorkspaceName(exported.name);
      setFolderMap(Object.fromEntries(exported.folders.map((f) => [f.alias, f.path])));
      const all = sortWorkspacesRecent(useAppStore.getState().workspaces);
      const route = currentRoute();
      const routeWs =
        route.name === 'workspace' || route.name === 'conversation'
          ? all.find((w) => w.id === route.workspaceId)
          : undefined;
      const match = all.find((w) =>
        samePaths(
          w,
          exported.folders.map((f) => f.path),
        ),
      );
      const preferred = match ?? routeWs;
      setTarget(preferred ? 'existing' : 'new');
      setWorkspaceId(preferred?.id ?? all[0]?.id ?? '');
    } catch (err) {
      setParseError(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  useEffect(() => {
    if (initialFile) void readFile(initialFile);
    // Read once per file.
  }, [initialFile]);

  // Validate the folder mapping (new workspace target), debounced.
  useEffect(() => {
    if (!parsed || target !== 'new') return;
    const paths = Object.values(folderMap).map(cleanPath).filter(Boolean);
    let alive = true;
    setChecks((prev) => {
      const next = { ...prev };
      for (const p of paths) if (!next[p]) next[p] = { status: 'checking' };
      return next;
    });
    const timer = window.setTimeout(() => {
      void checkFolders(paths).then((result) => {
        if (alive) setChecks((prev) => ({ ...prev, ...result }));
      });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [folderMap, parsed, target]);

  const conversations = parsed ? importedConversations(parsed.payload) : [];
  const exported = parsed?.payload.data.workspace;
  const mappingValid =
    !!exported &&
    exported.folders.every((f) => {
      const path = cleanPath(folderMap[f.alias] ?? '');
      return path && checks[path]?.status === 'ok';
    });
  const canSubmit =
    !!parsed && !submitting && (target === 'existing' ? Boolean(workspaceId) : mappingValid);

  const submit = async () => {
    if (!parsed || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const body: ImportBody =
      target === 'existing'
        ? { data: parsed.raw, workspaceId }
        : {
            data: parsed.raw,
            folderMap: Object.fromEntries(
              Object.entries(folderMap).map(([alias, path]) => [alias, cleanPath(path)]),
            ),
            workspaceName: workspaceName.trim() || undefined,
          };
    try {
      const res = await importData(body);
      toast({
        tone: 'success',
        title: `Imported ${plural(res.conversations.length, 'conversation')}`,
        duration: 3000,
      });
      onClose();
      const first = res.conversations[0];
      navigate(
        first
          ? routes.conversation(res.workspace.id, first.id)
          : routes.workspace(res.workspace.id),
      );
    } catch (err) {
      setSubmitError(errorMessage(err));
      setSubmitting(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        dismissable={!submitting}
        size="lg"
        title="Import"
        description={
          parsed
            ? parsed.fileName
            : 'A conversation or workspace bundle exported from Codesplainer.'
        }
        footer={
          <>
            {submitError ? (
              <span className="mr-auto flex min-w-0 items-center gap-1.5 text-xs text-danger">
                <CircleAlert size={13} className="shrink-0" />
                <span className="truncate" title={submitError}>
                  {submitError}
                </span>
              </span>
            ) : null}
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              loading={submitting}
              onClick={() => void submit()}
            >
              Import
            </Button>
          </>
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = '';
          }}
        />
        {!parsed ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-accent bg-accent-soft/50' : 'border-border',
            )}
          >
            {reading ? (
              <Spinner size={20} />
            ) : (
              <FileUp size={26} className="text-subtle" aria-hidden />
            )}
            <div className="text-[13px] text-muted">Drop a .codesplainer.json file here</div>
            <Button icon={FileBraces} onClick={() => fileInput.current?.click()} data-autofocus>
              Choose file…
            </Button>
            {parseError ? (
              <p className="max-w-md rounded-lg bg-danger-soft px-3 py-2 text-left text-xs break-words whitespace-pre-wrap text-danger">
                {parseError}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <section aria-label="Contents" className="rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
                <MessagesSquare size={13} aria-hidden />
                {parsed.payload.kind === 'bundle'
                  ? `Workspace bundle · ${plural(conversations.length, 'conversation')}`
                  : 'Conversation'}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent-soft"
                >
                  Other file…
                </button>
              </div>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto">
                {conversations.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-fg">{c.title}</span>
                    <span className="shrink-0 text-xs text-subtle">
                      {plural(c.graphs.length, 'diagram')}
                    </span>
                  </li>
                ))}
              </ul>
              {exported ? (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted">
                  <span>From</span>
                  <span className="font-medium text-fg">{exported.name}</span>
                  {exported.folders.map((f) => (
                    <span
                      key={f.alias}
                      title={f.path}
                      className="inline-flex h-5 items-center rounded-full bg-surface-2 px-2 font-mono text-[11px] text-muted"
                    >
                      {f.alias}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

            <div className="flex flex-col gap-3">
              <Segmented<Target>
                aria-label="Import into"
                value={target}
                onChange={setTarget}
                options={[
                  { value: 'existing', label: 'Existing workspace' },
                  { value: 'new', label: 'New workspace' },
                ]}
                className="self-start"
              />
              {target === 'existing' ? (
                sorted.length ? (
                  <Field label="Workspace">
                    <Select
                      aria-label="Workspace"
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      options={sorted.map((w) => ({ value: w.id, label: w.name }))}
                    />
                  </Field>
                ) : (
                  <p className="text-[13px] text-muted">
                    No workspaces yet. Import into a new one.
                  </p>
                )
              ) : exported ? (
                <div className="flex flex-col gap-3">
                  <Field label="Name">
                    <Input
                      aria-label="Workspace name"
                      value={workspaceName}
                      maxLength={120}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                    />
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted">
                      Where are these folders on this machine?
                    </span>
                    {exported.folders.map((f) => {
                      const value = folderMap[f.alias] ?? '';
                      const check = checks[cleanPath(value)];
                      return (
                        <div key={f.alias} className="flex items-center gap-2">
                          <span
                            className="w-28 shrink-0 truncate font-mono text-xs text-fg"
                            title={`Exported from ${f.path}`}
                          >
                            {f.alias}
                          </span>
                          <Input
                            aria-label={`Local path for ${f.alias}`}
                            value={value}
                            invalid={check?.status === 'invalid'}
                            onChange={(e) =>
                              setFolderMap((m) => ({ ...m, [f.alias]: e.target.value }))
                            }
                            className="font-mono"
                            spellCheck={false}
                          />
                          <span className="flex w-5 shrink-0 justify-center">
                            {!value.trim() ? null : !check || check.status === 'checking' ? (
                              <Spinner size={13} />
                            ) : check.status === 'ok' ? (
                              <CircleCheck
                                size={14}
                                className="text-ok"
                                aria-label="Folder found"
                              />
                            ) : (
                              <Tooltip label={check.message}>
                                <CircleAlert
                                  size={14}
                                  className="text-danger"
                                  aria-label={check.message}
                                />
                              </Tooltip>
                            )}
                          </span>
                          <Button
                            size="sm"
                            icon={FolderSearch}
                            onClick={() => setBrowseAlias(f.alias)}
                          >
                            Browse…
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </Dialog>
      {browseAlias !== null ? (
        <FolderBrowserDialog
          title={`Folder for “${browseAlias}”`}
          multiple={false}
          initialPath={
            checks[cleanPath(folderMap[browseAlias] ?? '')]?.status === 'ok'
              ? parentDir(folderMap[browseAlias])
              : undefined
          }
          onClose={() => setBrowseAlias(null)}
          onSelect={(paths) => {
            const path = paths[0];
            if (path) setFolderMap((m) => ({ ...m, [browseAlias]: path }));
          }}
        />
      ) : null}
    </>
  );
}
