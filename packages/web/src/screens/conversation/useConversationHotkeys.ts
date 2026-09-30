import { useHotkeys } from '../../lib/hotkeys';
import {
  askAboutNode,
  clearSelection,
  closeRightPanel,
  expandNode,
  fitView,
  getState,
  goToParent,
  goToSibling,
  moveStep,
  stopSteps,
  toggleSidebar,
  toggleSteps,
  toggleView,
} from '../../store';

/** Shortcuts of the conversation screen (see ShortcutsDialog). */
export function useConversationHotkeys(): void {
  useHotkeys([
    {
      combo: 'e',
      handler: () => {
        const { selection, view } = getState();
        if (view === 'diagram' && selection.nodeId) void expandNode(selection.nodeId);
      },
    },
    {
      combo: 'shift+e',
      handler: () => {
        const { selection, view } = getState();
        if (view === 'diagram' && selection.nodeId)
          void expandNode(selection.nodeId, { again: true });
      },
    },
    {
      combo: 'a',
      handler: () => {
        const { selection, view } = getState();
        if (view === 'diagram' && selection.nodeId) askAboutNode(selection.nodeId);
      },
    },
    { combo: 'm', handler: toggleView },
    { combo: ['u', 'alt+ArrowLeft'], handler: goToParent },
    { combo: '[', handler: () => goToSibling(-1) },
    { combo: ']', handler: () => goToSibling(1) },
    { combo: 'f', handler: fitView },
    { combo: 'p', handler: toggleSteps },
    { combo: ',', handler: () => void moveStep(-1) },
    { combo: '.', handler: () => void moveStep(1) },
    { combo: 'mod+b', handler: toggleSidebar, allowInInputs: true },
    {
      combo: 'Escape',
      preventDefault: false,
      handler: () => {
        // Innermost first: the step player, then the side panel, then the selection.
        if (stopSteps()) return;
        const { rightPanel, selection } = getState();
        if (rightPanel) closeRightPanel();
        else if (selection.nodeId || selection.edgeId) clearSelection();
      },
    },
  ]);
}
