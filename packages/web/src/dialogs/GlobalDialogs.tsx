import type { Workspace } from '@codesplainer/shared';
import { closeDialog, useAppStore, type DialogState } from '../store';
import { ImportDialog } from './ImportDialog';
import { ModalHost } from './ModalHost';
import { RawOutputDialog } from './RawOutputDialog';
import { SettingsDialog } from './settings/SettingsDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { WorkspaceSetupDialog } from './WorkspaceSetupDialog';

function renderDialog(dialog: DialogState | null, editWorkspace: Workspace | undefined) {
  switch (dialog?.type) {
    case 'settings':
      return <SettingsDialog tab={dialog.tab} onClose={closeDialog} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={closeDialog} />;
    case 'import':
      return (
        <ImportDialog
          key={dialog.file ? `${dialog.file.name}:${dialog.file.lastModified}` : 'pick'}
          initialFile={dialog.file}
          onClose={closeDialog}
        />
      );
    case 'workspace-create':
      return (
        <WorkspaceSetupDialog
          mode="create"
          initialFolders={dialog.initialFolders}
          onClose={closeDialog}
        />
      );
    case 'workspace-edit':
      return editWorkspace ? (
        <WorkspaceSetupDialog
          key={editWorkspace.id}
          mode="edit"
          workspace={editWorkspace}
          onClose={closeDialog}
        />
      ) : null;
    case 'raw-output':
      return (
        <RawOutputDialog
          conversationId={dialog.conversationId}
          graphId={dialog.graphId}
          title={dialog.title}
          onClose={closeDialog}
        />
      );
    default:
      return null;
  }
}

/** The dialog requested through the store (one at a time) + confirmations on top. */
export function GlobalDialogs() {
  const dialog = useAppStore((s) => s.dialog);
  const editWorkspace = useAppStore((s) =>
    s.dialog?.type === 'workspace-edit'
      ? s.workspaces.find((w) => w.id === (s.dialog as { workspaceId: string }).workspaceId)
      : undefined,
  );
  return (
    <>
      {renderDialog(dialog, editWorkspace)}
      <ModalHost />
    </>
  );
}
