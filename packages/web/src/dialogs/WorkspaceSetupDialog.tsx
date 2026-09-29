import { useEffect, useMemo, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Plus,
  X,
} from 'lucide-react';
import { baseName, type Workspace } from '@codesplainer/shared';
import { api, errorMessage } from '../lib/api';
import { navigate, routes } from '../lib/router';
import { createWorkspace, toast, updateWorkspace, useAppStore } from '../store';
import { Button, Dialog, Field, IconButton, Input, Spinner, Tooltip } from '../ui';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { checkFolders, cleanPath, parentDir, type FolderCheck } from './folderChecks';

const MAX_FOLDERS = 20;

interface FolderRow {
  path: string;
  alias?: string;
  check: FolderCheck;
}

type Props =
  | { mode: 'create'; initialFolders?: string[]; onClose: () => void }
  | { mode: 'edit'; workspace: Workspace; onClose: () => void };

/** Native OS folder dialog; null when unavailable (use the in-app browser instead). */
export async function pickNativeFolders(): Promise<string[] | null> {
  try {
    const { paths } = await api.pickFolder();
    return paths;
  } catch {
    return null;
  }
}

/** Create a workspace or edit its folders. */
export function WorkspaceSetupDialog(props: Props) {
  const editing = props.mode === 'edit' ? props.workspace : null;
  const nativePicker = useAppStore((s) => s.health?.nativePicker ?? false);
  const [name, setName] = useState(editing?.name ?? '');
  const [rows, setRows] = useState<FolderRow[]>(() =>
    editing
      ? editing.folders.map((f) => ({
          path: f.path,
          alias: f.alias,
          check: { status: 'checking' },
        }))
      : (props.mode === 'create' ? (props.initialFolders ?? []) : []).map((p) => ({
          path: cleanPath(p),
          check: { status: 'checking' },
        })),
  );
  const [pathInput, setPathInput] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate rows that have not been checked yet.
  const pendingKey = rows
    .filter((r) => r.check.status === 'checking')
    .map((r) => r.path)
    .join('\n');
  useEffect(() => {
    if (!pendingKey) return;
    let alive = true;
    void checkFolders(pendingKey.split('\n')).then((checks) => {
      if (!alive) return;
      setRows((list) =>
        list.map((r) =>
          r.check.status === 'checking' && checks[r.path]
            ? { ...r, check: checks[r.path] as FolderCheck }
            : r,
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, [pendingKey]);

  const addPaths = (paths: string[]) => {
    setError(null);
    setRows((list) => {
      const known = new Set(list.map((r) => r.path));
      const next = [...list];
      for (const raw of paths) {
        const path = cleanPath(raw);
        if (!path || known.has(path)) continue;
        known.add(path);
        next.push({ path, check: { status: 'checking' } });
      }
      if (next.length > MAX_FOLDERS) setError(`Up to ${MAX_FOLDERS} folders per workspace.`);
      return next.slice(0, MAX_FOLDERS);
    });
  };

  const pickNative = async () => {
    setPicking(true);
    const paths = await pickNativeFolders();
    setPicking(false);
    if (paths === null) setBrowsing(true);
    else if (paths.length) addPaths(paths);
  };

  const allValid = rows.length > 0 && rows.every((r) => r.check.status === 'ok');
  const checking = rows.some((r) => r.check.status === 'checking');
  const placeholderName = useMemo(() => (rows[0] ? baseName(rows[0].path) : 'My project'), [rows]);

  const submit = async () => {
    if (!allValid || submitting) return;
    setSubmitting(true);
    setError(null);
    const folders = rows.map((r) => r.path);
    const cleanName = name.trim() || undefined;
    try {
      if (editing) {
        await updateWorkspace(editing.id, { name: cleanName, folders });
        toast({ tone: 'success', title: 'Workspace updated', duration: 2500 });
        props.onClose();
      } else {
        const workspace = await createWorkspace({ name: cleanName, folders });
        props.onClose();
        navigate(routes.workspace(workspace.id));
      }
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={props.onClose}
        dismissable={!submitting}
        size="md"
        title={editing ? 'Edit workspace' : 'New workspace'}
        description={editing ? undefined : 'One or more folders you want to understand.'}
        footer={
          <>
            {error ? (
              <span className="mr-auto flex min-w-0 items-center gap-1.5 text-xs text-danger">
                <CircleAlert size={13} className="shrink-0" />
                <span className="truncate">{error}</span>
              </span>
            ) : null}
            <Button variant="ghost" onClick={props.onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!allValid || checking}
              loading={submitting}
              onClick={() => void submit()}
            >
              {editing ? 'Save' : 'Create workspace'}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name">
            <Input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholderName}
              aria-label="Workspace name"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Folders</span>
            {rows.length ? (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {rows.map((row) => (
                  <li key={row.path} className="flex items-center gap-2 px-2.5 py-1.5">
                    <FolderOpen size={14} className="shrink-0 text-subtle" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">
                        {row.alias ?? baseName(row.path)}
                      </div>
                      <div className="truncate font-mono text-[11px] text-subtle" title={row.path}>
                        {row.path}
                      </div>
                    </div>
                    <CheckIcon check={row.check} />
                    <IconButton
                      icon={X}
                      size="xs"
                      label={`Remove ${baseName(row.path)}`}
                      onClick={() => setRows((list) => list.filter((r) => r.path !== row.path))}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[13px] text-subtle">
                No folders yet
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {nativePicker ? (
                <Button icon={FolderPlus} loading={picking} onClick={() => void pickNative()}>
                  Choose folder…
                </Button>
              ) : null}
              <Button
                icon={FolderSearch}
                variant={nativePicker ? 'ghost' : 'secondary'}
                onClick={() => setBrowsing(true)}
              >
                Browse…
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Folder path"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pathInput.trim()) {
                    e.preventDefault();
                    addPaths([pathInput]);
                    setPathInput('');
                  }
                }}
                placeholder="or paste a path, e.g. ~/code/my-app"
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <IconButton
                icon={Plus}
                label="Add path"
                variant="secondary"
                disabled={!pathInput.trim()}
                onClick={() => {
                  addPaths([pathInput]);
                  setPathInput('');
                }}
              />
            </div>
          </div>
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </Dialog>
      {browsing ? (
        <FolderBrowserDialog
          onClose={() => setBrowsing(false)}
          onSelect={addPaths}
          initialPath={parentDir(rows[rows.length - 1]?.path)}
        />
      ) : null}
    </>
  );
}

function CheckIcon({ check }: { check: FolderCheck }) {
  if (check.status === 'checking') return <Spinner size={13} />;
  if (check.status === 'ok') {
    return <CircleCheck size={14} className="shrink-0 text-ok" aria-label="Folder found" />;
  }
  return (
    <Tooltip label={check.message}>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger">
        <CircleAlert size={13} aria-hidden />
        {check.message}
      </span>
    </Tooltip>
  );
}
