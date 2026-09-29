/** UI actions: toasts, dialogs, confirmations, panels, selection, ask bar state. */
import type { Theme } from '@codesplainer/shared';
import type { AskScope } from '../panels/types';
import { errorMessage, isAbortError } from '../lib/api';
import { STORAGE_KEYS, writeJson, writeString } from '../lib/storage';
import { getState, setState } from './store';
import type {
  AskPrefs,
  ConfirmRequest,
  DialogState,
  PromptRequest,
  RightPanel,
  SidebarTab,
  Toast,
  ToastTone,
} from './types';

// ---- toasts ----------------------------------------------------------------------------------

let toastCounter = 0;
const MAX_TOASTS = 4;

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  action?: Toast['action'];
  /** ms; default 4 s (errors 8 s, with action 7 s). 0 = sticky. */
  duration?: number;
  /** Replace an existing toast with the same id (e.g. "copied" twice). */
  id?: string;
}

export function toast(input: ToastInput): string {
  const tone = input.tone ?? 'info';
  const id = input.id ?? `t${++toastCounter}`;
  const duration = input.duration ?? (tone === 'error' ? 8000 : input.action ? 7000 : 4000);
  const item: Toast = {
    id,
    tone,
    title: input.title,
    description: input.description,
    action: input.action,
    duration,
  };
  setState((s) => ({
    toasts: [...s.toasts.filter((t) => t.id !== id), item].slice(-MAX_TOASTS),
  }));
  return id;
}

export function dismissToast(id: string): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Surface a failed action as an error toast. */
export function reportError(err: unknown, title = 'Something went wrong'): void {
  if (isAbortError(err)) return;
  toast({ tone: 'error', title, description: errorMessage(err) });
}

// ---- dialogs ---------------------------------------------------------------------------------

export function openDialog(dialog: DialogState): void {
  setState({ dialog, paletteOpen: false });
}

export function closeDialog(): void {
  setState({ dialog: null });
}

export function openSettings(tab: 'general' | 'providers' = 'general'): void {
  openDialog({ type: 'settings', tab });
}

export function setPaletteOpen(open: boolean): void {
  setState({ paletteOpen: open });
}

export function togglePalette(): void {
  setState((s) => ({ paletteOpen: !s.paletteOpen }));
}

/** Dismiss the open confirmation/prompt (resolves it as cancelled). */
export function cancelModal(): void {
  const modal = getState().modal;
  if (!modal) return;
  if (modal.kind === 'confirm') modal.resolve(false);
  else modal.resolve(null);
}

let modalCounter = 0;

function closeModal(id: number): void {
  if (getState().modal?.id === id) setState({ modal: null });
}

/** Promise based confirmation dialog. */
export function confirmAction(
  request: Omit<ConfirmRequest, 'kind' | 'resolve' | 'id'>,
): Promise<boolean> {
  return new Promise((resolve) => {
    cancelModal();
    const id = ++modalCounter;
    let settled = false;
    setState({
      modal: {
        kind: 'confirm',
        ...request,
        id,
        resolve: (ok: boolean) => {
          closeModal(id);
          if (settled) return;
          settled = true;
          resolve(ok);
        },
      },
    });
  });
}

/** Promise based single-line text prompt (null = cancelled). */
export function promptText(
  request: Omit<PromptRequest, 'kind' | 'resolve' | 'id'>,
): Promise<string | null> {
  return new Promise((resolve) => {
    cancelModal();
    const id = ++modalCounter;
    let settled = false;
    setState({
      modal: {
        kind: 'prompt',
        ...request,
        id,
        resolve: (value: string | null) => {
          closeModal(id);
          if (settled) return;
          settled = true;
          resolve(value);
        },
      },
    });
  });
}

// ---- sidebar / legend / theme ------------------------------------------------------------------

function persistSidebar(): void {
  writeJson(STORAGE_KEYS.sidebar, getState().sidebar);
}

export function setSidebarOpen(open: boolean): void {
  setState((s) => ({ sidebar: { ...s.sidebar, open } }));
  persistSidebar();
}

export function toggleSidebar(): void {
  setSidebarOpen(!getState().sidebar.open);
}

export function setSidebarTab(tab: SidebarTab): void {
  setState({ sidebar: { open: true, tab } });
  persistSidebar();
}

export function setOutlineFilter(outlineFilter: string): void {
  setState({ outlineFilter });
}

export function setLegendVisible(legendVisible: boolean): void {
  setState({ legendVisible });
  writeString(STORAGE_KEYS.legend, legendVisible ? '1' : '0');
}

/** Local part of theme changes (the settings patch is sent by the caller). */
export function setThemeLocal(theme: Theme): void {
  setState({ theme });
  writeString(STORAGE_KEYS.theme, theme);
}

export function setResolvedTheme(resolvedTheme: 'light' | 'dark'): void {
  if (getState().resolvedTheme !== resolvedTheme) setState({ resolvedTheme });
}

// ---- selection / right panel -----------------------------------------------------------------

export function selectNode(nodeId: string | null): void {
  setState((s) => ({
    selection: { nodeId, edgeId: null },
    rightPanel: nodeId
      ? { type: 'node' }
      : s.rightPanel?.type === 'node' || s.rightPanel?.type === 'edge'
        ? null
        : s.rightPanel,
  }));
}

export function selectEdge(edgeId: string | null): void {
  setState((s) => ({
    selection: { nodeId: null, edgeId },
    rightPanel: edgeId
      ? { type: 'edge' }
      : s.rightPanel?.type === 'node' || s.rightPanel?.type === 'edge'
        ? null
        : s.rightPanel,
  }));
}

export function clearSelection(): void {
  setState((s) => ({
    selection: { nodeId: null, edgeId: null },
    rightPanel:
      s.rightPanel?.type === 'node' || s.rightPanel?.type === 'edge' ? null : s.rightPanel,
  }));
}

export function setRightPanel(rightPanel: RightPanel | null): void {
  setState({ rightPanel });
}

export function closeRightPanel(): void {
  setState((s) => ({
    rightPanel: null,
    selection:
      s.rightPanel?.type === 'node' || s.rightPanel?.type === 'edge'
        ? { nodeId: null, edgeId: null }
        : s.selection,
  }));
}

/** From the code viewer back to the inspector it was opened from. */
export function backFromCode(): void {
  const panel = getState().rightPanel;
  if (panel?.type !== 'code') return;
  const { selection } = getState();
  if (panel.back === 'node' && selection.nodeId) setState({ rightPanel: { type: 'node' } });
  else if (panel.back === 'edge' && selection.edgeId) setState({ rightPanel: { type: 'edge' } });
  else setState({ rightPanel: null });
}

export function toggleActivityPanel(): void {
  setState((s) => ({
    rightPanel: s.rightPanel?.type === 'activity' ? null : { type: 'activity' },
  }));
}

/** Diagram changed: drop selection-bound panels, keep code/activity. */
export function resetGraphUi(): void {
  setState((s) => ({
    selection: { nodeId: null, edgeId: null },
    rightPanel:
      s.rightPanel?.type === 'node' || s.rightPanel?.type === 'edge' ? null : s.rightPanel,
    askScope: s.askScope?.type === 'code' && !s.askScope.graphId ? s.askScope : null,
  }));
}

// ---- ask bar ---------------------------------------------------------------------------------

export function setAskScope(askScope: AskScope | null): void {
  setState({ askScope });
}

export function focusAsk(scope?: AskScope | null): void {
  setState((s) => ({
    askScope: scope === undefined ? s.askScope : scope,
    askFocus: s.askFocus + 1,
  }));
}

export function setAskDraft(text: string): void {
  setState((s) => ({
    askDraft: { text, nonce: (s.askDraft?.nonce ?? 0) + 1 },
    askFocus: s.askFocus + 1,
  }));
}

export function setAskPrefs(patch: Partial<AskPrefs>): void {
  setState((s) => ({ askPrefs: { ...s.askPrefs, ...patch } }));
  writeJson(STORAGE_KEYS.askPrefs, getState().askPrefs);
}
