import { useEffect, useState } from 'react';
import { Download, FolderSearch, Import, Pencil } from 'lucide-react';
import type { ConversationSummary, Workspace } from '@codesplainer/shared';
// Direct import (not the panels index) keeps the code viewer / CodeMirror out of the main chunk;
// the conversation screen (canvas, editor) is loaded lazily.
import { AskBar } from '../../panels/AskBar';
import { navigate, routes } from '../../lib/router';
import {
  askInWorkspace,
  effectiveAskChoice,
  exportWorkspaceBundle,
  fetchWorkspace,
  openDialog,
  openWorkspaceConversations,
  setAskDetail,
  setAskModel,
  setAskProvider,
  useAppStore,
} from '../../store';
import { Button, EmptyState, IconButton, Spinner } from '../../ui';
import { FolderChips } from '../common/FolderChips';
import { StarterQuestions } from '../common/StarterQuestions';
import { ConversationList } from './ConversationList';
import { WorkspaceOverview } from './WorkspaceOverview';

const EMPTY: ConversationSummary[] = [];
const NEW_SCOPE = { type: 'new' } as const;
const NEW_SCOPES = [NEW_SCOPE];

export function WorkspaceScreen({ workspaceId }: { workspaceId: string }) {
  const workspace = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const [missing, setMissing] = useState<'missing' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    openWorkspaceConversations(workspaceId).catch(() => undefined);
    // Fresh copy (also records "last opened" on the server).
    let alive = true;
    fetchWorkspace(workspaceId)
      .then((ws) => alive && !ws && setMissing('missing'))
      .catch(() => alive && setMissing('error'));
    return () => {
      alive = false;
    };
  }, [workspaceId, attempt]);

  if (!workspace) {
    if (missing) {
      return (
        <EmptyState
          className="h-full"
          icon={FolderSearch}
          title={missing === 'missing' ? 'Workspace not found' : "Couldn't load this workspace"}
          description={missing === 'missing' ? 'It may have been deleted.' : undefined}
          action={
            <div className="flex gap-2">
              {missing === 'error' ? (
                <Button
                  onClick={() => {
                    setMissing(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  Retry
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => navigate(routes.home())}>
                All workspaces
              </Button>
            </div>
          }
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return <WorkspaceHome workspace={workspace} />;
}

function WorkspaceHome({ workspace }: { workspace: Workspace }) {
  const conversations = useAppStore((s) =>
    s.conversationsWorkspaceId === workspace.id ? s.conversations : EMPTY,
  );
  const listStatus = useAppStore((s) => s.conversationsStatus);
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const askPrefs = useAppStore((s) => s.askPrefs);
  const askFocus = useAppStore((s) => s.askFocus);
  const askDraft = useAppStore((s) => s.askDraft);
  const askBusy = useAppStore((s) => s.askBusy);
  const choice = effectiveAskChoice(askPrefs, settings, providers);
  const ask = (question: string) => askInWorkspace(workspace.id, question);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-10 pb-16 animate-fade-in">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg">
              {workspace.name}
            </h1>
            <div className="mt-1.5 flex items-center gap-1">
              <FolderChips folders={workspace.folders} max={6} />
              <IconButton
                icon={Pencil}
                size="xs"
                label="Edit folders"
                onClick={() => openDialog({ type: 'workspace-edit', workspaceId: workspace.id })}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              icon={Import}
              label="Import conversations"
              onClick={() => openDialog({ type: 'import' })}
            />
            <IconButton
              icon={Download}
              label="Export workspace bundle"
              onClick={() => void exportWorkspaceBundle(workspace)}
            />
          </div>
        </header>

        <WorkspaceOverview workspaceId={workspace.id} multiFolder={workspace.folders.length > 1} />

        <section aria-label="Ask" className="flex flex-col items-stretch gap-4">
          <AskBar
            variant="hero"
            scope={NEW_SCOPE}
            scopes={NEW_SCOPES}
            onScopeChange={() => undefined}
            providers={providers}
            provider={choice.provider}
            model={choice.model}
            detail={choice.detail}
            onProviderChange={setAskProvider}
            onModelChange={setAskModel}
            onDetailChange={setAskDetail}
            onSubmit={ask}
            busy={askBusy}
            focusSignal={askFocus}
            draft={askDraft}
            placeholder="Ask anything about this code…"
            autoFocus
          />
          <StarterQuestions onPick={(q) => void ask(q)} disabled={askBusy} />
        </section>

        <section aria-label="Conversations" className="flex flex-col gap-2">
          <h2 className="px-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
            Conversations
          </h2>
          <ConversationList conversations={conversations} loading={listStatus === 'loading'} />
        </section>
      </div>
    </div>
  );
}
