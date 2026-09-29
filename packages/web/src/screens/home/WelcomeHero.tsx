import { useState } from 'react';
import {
  ArrowRight,
  FolderPlus,
  Maximize2,
  MessageSquare,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { LogoMark } from '../../app/Logo';
import { FolderBrowserDialog } from '../../dialogs/FolderBrowserDialog';
import { checkFolders, cleanPath } from '../../dialogs/folderChecks';
import { pickNativeFolders } from '../../dialogs/WorkspaceSetupDialog';
import { navigate, routes } from '../../lib/router';
import { createWorkspace, reportError, useAppStore } from '../../store';
import { Button, Input } from '../../ui';
import { ProviderList } from '../common/ProviderList';

/** First run: add folders (native picker or in-app browser) or paste a path. */
export function WelcomeHero() {
  const nativePicker = useAppStore((s) => s.health?.nativePicker ?? false);
  const [browsing, setBrowsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [path, setPath] = useState('');
  const [checking, setChecking] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const createFrom = async (paths: string[]) => {
    if (!paths.length) return;
    setCreating(true);
    try {
      const workspace = await createWorkspace({ folders: paths });
      navigate(routes.workspace(workspace.id));
    } catch (err) {
      reportError(err, "Couldn't create the workspace");
      setCreating(false);
    }
  };

  const addFolders = async () => {
    if (!nativePicker) {
      setBrowsing(true);
      return;
    }
    setCreating(true);
    const paths = await pickNativeFolders();
    setCreating(false);
    if (paths === null) setBrowsing(true);
    else await createFrom(paths);
  };

  const submitPath = async () => {
    const clean = cleanPath(path);
    if (!clean) return;
    setChecking(true);
    setPathError(null);
    const check = (await checkFolders([clean]))[clean];
    setChecking(false);
    if (check?.status !== 'ok') {
      setPathError(check?.status === 'invalid' ? check.message : 'Not found');
      return;
    }
    await createFrom([clean]);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col items-center px-6 pt-[12vh] pb-16 text-center animate-fade-in">
        <LogoMark size={48} />
        <h1 className="mt-6 text-[26px] leading-tight font-semibold tracking-tight text-balance text-fg">
          Understand any codebase, one diagram at a time.
        </h1>

        <Button
          variant="primary"
          size="md"
          icon={FolderPlus}
          loading={creating}
          onClick={() => void addFolders()}
          className="mt-9 h-11! rounded-xl! px-6! text-[15px]!"
        >
          Add folders
        </Button>

        <form
          className="mt-4 flex w-full max-w-sm items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPath();
          }}
        >
          <Input
            aria-label="Folder path"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setPathError(null);
            }}
            invalid={Boolean(pathError)}
            placeholder="or paste a path"
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="submit" loading={checking} disabled={!path.trim() || creating}>
            Open
          </Button>
        </form>
        <p className="mt-1.5 h-4 text-xs text-danger" aria-live="polite">
          {pathError}
        </p>

        <HowItWorks />
        <ProviderList className="mt-12 max-w-sm" />
      </div>
      {browsing ? (
        <FolderBrowserDialog
          onClose={() => setBrowsing(false)}
          onSelect={(paths) => void createFrom(paths)}
        />
      ) : null}
    </div>
  );
}

function HowItWorks() {
  return (
    <ol aria-label="How it works" className="mt-12 flex items-center gap-3 text-muted">
      <Step icon={MessageSquare} label="Ask" />
      <ArrowRight size={14} className="text-subtle" aria-hidden />
      <Step icon={Network} label="Diagram" />
      <ArrowRight size={14} className="text-subtle" aria-hidden />
      <Step icon={Maximize2} label="Expand" />
    </ol>
  );
}

function Step({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <li className="flex flex-col items-center gap-1.5">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-accent shadow-card">
        <Icon size={18} aria-hidden />
      </span>
      <span className="text-xs font-medium">{label}</span>
    </li>
  );
}
