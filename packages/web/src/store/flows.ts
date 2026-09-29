/**
 * User-level flows that combine API calls, navigation and UI state (asking, expanding,
 * exporting, opening code...). Components call these; they never throw (errors become toasts).
 */
import {
  descendantsOf,
  exportFileName,
  expansionOfNode,
  findNode,
  getGraph,
  graphDisplayTitle,
  slugify,
  toMermaid,
  truncate,
  type AskBody,
  type CodeRef,
  type ConversationSummary,
  type DetailLevel,
  type GraphOrigin,
  type ProviderId,
  type Theme,
  type Workspace,
} from '@codesplainer/shared';
import type { AskScope, DiagramExportFormat, RetryOptions } from '../panels/types';
import { api, download, errorMessage } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { downloadDataUrl } from '../lib/download';
import { currentRoute, navigate, routes, type AppView } from '../lib/router';
import { graphCanvasRef, conversationMapRef } from './bridges';
import {
  askQuestion,
  cancelGraph,
  createConversation,
  deleteConversation,
  deleteGraph,
  deleteWorkspace,
  duplicateConversation,
  patchGraph,
  refreshProviders,
  renameConversation,
  retryGraph,
  updateSettings,
} from './data';
import { effectiveAskChoice, parentGraphId, refFolder, siblingGraphId } from './selectors';
import { getState, setState } from './store';
import {
  confirmAction,
  focusAsk,
  openDialog,
  promptText,
  reportError,
  selectNode,
  setAskDraft,
  setAskPrefs,
  setSidebarTab,
  setThemeLocal,
  toast,
} from './ui';

function context() {
  const s = getState();
  const conversation = s.conversation;
  const graph =
    conversation && s.currentGraphId ? getGraph(conversation, s.currentGraphId) : undefined;
  const workspace = conversation
    ? s.workspaces.find((w) => w.id === conversation.workspaceId)
    : undefined;
  return { s, conversation, graph, workspace };
}

function askExtras(): Pick<AskBody, 'provider' | 'model' | 'detail'> {
  const s = getState();
  const choice = effectiveAskChoice(s.askPrefs, s.settings, s.providers);
  return { provider: choice.provider, model: choice.model || undefined, detail: choice.detail };
}

// ---- navigation ------------------------------------------------------------------------------

/** Show a diagram (switches to the diagram view unless `keepView`). */
export function openGraph(graphId: string, options: { keepView?: boolean } = {}): void {
  const { conversation, s } = context();
  if (!conversation) return;
  const view = options.keepView ? s.view : 'diagram';
  navigate(routes.conversation(conversation.workspaceId, conversation.id, graphId, view));
}

export function openConversationRoute(workspaceId: string, conversationId: string): void {
  navigate(routes.conversation(workspaceId, conversationId));
}

export function setView(view: AppView): void {
  const route = currentRoute();
  if (route.name !== 'conversation') return;
  const graphId = route.graphId ?? getState().currentGraphId ?? undefined;
  navigate(routes.conversation(route.workspaceId, route.conversationId, graphId, view), {
    replace: true,
  });
}

export function toggleView(): void {
  setView(getState().view === 'map' ? 'diagram' : 'map');
}

export function goToParent(): void {
  const { conversation, graph } = context();
  if (!conversation || !graph) return;
  const id = parentGraphId(conversation, graph.id);
  if (id) openGraph(id, { keepView: true });
}

export function goToSibling(delta: -1 | 1): void {
  const { conversation, graph } = context();
  if (!conversation || !graph) return;
  const id = siblingGraphId(conversation, graph.id, delta);
  if (id) openGraph(id, { keepView: true });
}

export function fitView(): void {
  if (getState().view === 'map') conversationMapRef.current?.fitView();
  else graphCanvasRef.current?.fitView();
}

// ---- asking ----------------------------------------------------------------------------------

/** Hero ask on the workspace screen: new conversation + question, then open the diagram. */
export async function askInWorkspace(workspaceId: string, question: string): Promise<void> {
  const text = question.trim();
  if (!text || getState().askBusy) return;
  setState({ askBusy: true });
  let createdId: string | null = null;
  try {
    const conversation = await createConversation(workspaceId, truncate(text, 80));
    createdId = conversation.id;
    const graph = await askQuestion(conversation.id, {
      question: text,
      origin: { type: 'question' },
      ...askExtras(),
    });
    navigate(routes.conversation(workspaceId, conversation.id, graph.id));
  } catch (err) {
    reportError(err, "Couldn't ask");
    setAskDraft(text);
    if (createdId) {
      // Do not leave an empty conversation behind.
      deleteConversation(createdId, workspaceId).catch(() => undefined);
    }
  } finally {
    setState({ askBusy: false });
  }
}

function originFor(scope: AskScope): GraphOrigin {
  switch (scope.type) {
    case 'new':
      return { type: 'question' };
    case 'graph':
      return { type: 'ask-graph', parentGraphId: scope.graphId };
    case 'node':
      return {
        type: 'ask-node',
        parentGraphId: scope.graphId,
        nodeId: scope.nodeId,
        nodeLabel: scope.nodeLabel,
      };
    case 'code':
      return {
        type: 'ask-code',
        ref: scope.ref,
        ...(scope.graphId ? { parentGraphId: scope.graphId } : {}),
        ...(scope.nodeId ? { nodeId: scope.nodeId } : {}),
      };
  }
}

/** Ask inside the current conversation; navigates to the new diagram right away. */
export async function submitAsk(question: string, scope: AskScope): Promise<void> {
  const { conversation } = context();
  const text = question.trim();
  if (!conversation || !text || getState().askBusy) return;
  setState({ askBusy: true });
  try {
    const graph = await askQuestion(conversation.id, {
      question: text,
      origin: originFor(scope),
      ...askExtras(),
    });
    setState({ askScope: null });
    navigate(routes.conversation(conversation.workspaceId, conversation.id, graph.id));
  } catch (err) {
    reportError(err, "Couldn't ask");
    setAskDraft(text);
  } finally {
    setState({ askBusy: false });
  }
}

const expanding = new Set<string>();

/** "Explain & expand": open the existing expansion, or create one (always with `again`). */
export async function expandNode(nodeId: string, options: { again?: boolean } = {}): Promise<void> {
  const { conversation, graph } = context();
  if (!conversation || !graph?.spec) return;
  const node = findNode(graph.spec, nodeId);
  if (!node) return;
  if (!options.again) {
    const existing = expansionOfNode(conversation, graph.id, nodeId);
    if (existing) {
      openGraph(existing.id);
      return;
    }
  }
  const key = `${graph.id}:${nodeId}`;
  if (expanding.has(key)) return;
  expanding.add(key);
  try {
    const created = await askQuestion(conversation.id, {
      question: '',
      origin: { type: 'expand', parentGraphId: graph.id, nodeId, nodeLabel: node.label },
      ...askExtras(),
    });
    navigate(routes.conversation(conversation.workspaceId, conversation.id, created.id));
  } catch (err) {
    reportError(err, `Couldn't expand “${node.label}”`);
  } finally {
    expanding.delete(key);
  }
}

/** Ask about one box: node scope in the ask bar + focus. */
export function askAboutNode(nodeId: string): void {
  const { graph } = context();
  const node = graph?.spec ? findNode(graph.spec, nodeId) : undefined;
  if (!graph || !node) return;
  if (getState().selection.nodeId !== nodeId) selectNode(nodeId);
  focusAsk({ type: 'node', graphId: graph.id, nodeId, nodeLabel: node.label });
}

/** Edge inspector "Explain this interaction". */
export async function explainEdge(edgeId: string): Promise<void> {
  const { graph } = context();
  const spec = graph?.spec;
  const edge = spec?.edges.find((e) => e.id === edgeId);
  if (!graph || !spec || !edge) return;
  const from = findNode(spec, edge.from)?.label ?? edge.from;
  const to = findNode(spec, edge.to)?.label ?? edge.to;
  const question = `How does “${from}” ${edge.label || 'interact with'} “${to}”?`;
  await submitAsk(question, { type: 'graph', graphId: graph.id, title: graphDisplayTitle(graph) });
}

/** Suggestion chip: follow-up about the current diagram. */
export async function askSuggestion(question: string): Promise<void> {
  const { graph } = context();
  if (!graph) return;
  await submitAsk(question, { type: 'graph', graphId: graph.id, title: graphDisplayTitle(graph) });
}

export function setAskProvider(provider: ProviderId): void {
  setAskPrefs({ provider });
}

export function setAskModel(model: string): void {
  const s = getState();
  const provider = effectiveAskChoice(s.askPrefs, s.settings, s.providers).provider;
  setAskPrefs({ models: { ...s.askPrefs.models, [provider]: model } });
}

export function setAskDetail(detail: DetailLevel): void {
  setAskPrefs({ detail });
}

// ---- diagram management ------------------------------------------------------------------------

export async function retryDiagram(graphId: string, options: RetryOptions = {}): Promise<void> {
  const { conversation } = context();
  if (!conversation) return;
  try {
    await retryGraph(conversation.id, graphId, options);
  } catch (err) {
    reportError(err, "Couldn't retry");
  }
}

export async function cancelDiagram(graphId: string): Promise<void> {
  const { conversation } = context();
  if (!conversation) return;
  try {
    await cancelGraph(conversation.id, graphId);
  } catch (err) {
    reportError(err, "Couldn't cancel");
  }
}

export async function deleteDiagram(graphId: string): Promise<void> {
  const { conversation, s } = context();
  if (!conversation) return;
  const target = getGraph(conversation, graphId);
  if (!target) return;
  const descendants = descendantsOf(conversation, graphId);
  const ok = await confirmAction({
    title: 'Delete diagram?',
    message: descendants.length
      ? `“${graphDisplayTitle(target)}” and ${descendants.length} diagram${descendants.length === 1 ? '' : 's'} created from it will be removed.`
      : `“${graphDisplayTitle(target)}” will be removed.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const removed = new Set([graphId, ...descendants.map((g) => g.id)]);
  if (s.currentGraphId && removed.has(s.currentGraphId)) {
    const parent = parentGraphId(conversation, graphId);
    navigate(routes.conversation(conversation.workspaceId, conversation.id, parent ?? undefined), {
      replace: true,
    });
  }
  try {
    await deleteGraph(conversation.id, graphId);
  } catch (err) {
    reportError(err, "Couldn't delete");
  }
}

async function patchCurrent(
  graphId: string,
  body: Parameters<typeof patchGraph>[2],
  failTitle: string,
) {
  const { conversation } = context();
  if (!conversation) return;
  try {
    await patchGraph(conversation.id, graphId, body);
  } catch (err) {
    reportError(err, failTitle);
  }
}

export function renameDiagram(graphId: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) return Promise.resolve();
  return patchCurrent(graphId, { title: clean }, "Couldn't rename");
}

export function setDiagramStar(graphId: string, starred: boolean): Promise<void> {
  return patchCurrent(graphId, { starred }, "Couldn't update");
}

export function saveDiagramNote(graphId: string, note: string): Promise<void> {
  return patchCurrent(graphId, { note }, "Couldn't save the note");
}

export function showRawOutput(graphId: string): void {
  const { conversation } = context();
  const graph = conversation ? getGraph(conversation, graphId) : undefined;
  if (!conversation || !graph) return;
  openDialog({
    type: 'raw-output',
    conversationId: conversation.id,
    graphId,
    title: graphDisplayTitle(graph),
  });
}

export async function exportDiagram(format: DiagramExportFormat): Promise<void> {
  const { graph } = context();
  const spec = graph?.spec;
  if (!graph || !spec) return;
  const base = slugify(spec.title, 'diagram');
  try {
    if (format === 'png' || format === 'svg') {
      const handle = graphCanvasRef.current;
      if (!handle) throw new Error('The diagram is not on screen.');
      const dataUrl = await handle.toImage(format);
      if (!dataUrl) throw new Error('Nothing to export.');
      downloadDataUrl(dataUrl, `${base}.${format}`);
      return;
    }
    const text = format === 'mermaid' ? toMermaid(spec) : JSON.stringify(spec, null, 2);
    const ok = await copyText(text);
    if (!ok) throw new Error('Clipboard is not available.');
    toast({
      id: 'copied',
      tone: 'success',
      title: format === 'mermaid' ? 'Mermaid copied' : 'Diagram JSON copied',
      duration: 2500,
    });
  } catch (err) {
    reportError(err, "Couldn't export");
  }
}

// ---- code ------------------------------------------------------------------------------------

let codeRequest = 0;

/** Open a code ref in the right panel (directories are revealed in the file explorer). */
export async function openCode(
  ref: CodeRef,
  options: {
    back?: 'node' | 'edge' | null;
    context?: { graphId: string; nodeId?: string } | null;
  } = {},
): Promise<void> {
  const { s, conversation, workspace } = context();
  const workspaceId = conversation?.workspaceId ?? routeWorkspaceId();
  if (!workspaceId) return;
  const folder = refFolder(workspace ?? s.workspaces.find((w) => w.id === workspaceId), ref.folder);
  const normalized: CodeRef = { ...ref, folder };
  if (ref.isDir || !ref.path) {
    setState({ explorerRef: normalized });
    setSidebarTab('files');
    return;
  }
  const previous = s.rightPanel;
  const sameFile =
    previous?.type === 'code' &&
    previous.file !== null &&
    previous.file.folder === folder &&
    previous.file.path === ref.path;
  const back =
    options.back !== undefined
      ? options.back
      : s.selection.nodeId
        ? 'node'
        : s.selection.edgeId
          ? 'edge'
          : null;
  setState({
    explorerRef: normalized,
    rightPanel: {
      type: 'code',
      ref: normalized,
      file: sameFile ? previous.file : null,
      loading: !sameFile,
      error: null,
      back,
      context: options.context ?? null,
    },
  });
  if (sameFile) return;
  const request = ++codeRequest;
  try {
    const file = await api.readFile(workspaceId, folder, ref.path);
    if (request !== codeRequest) return;
    setState((st) =>
      st.rightPanel?.type === 'code'
        ? { rightPanel: { ...st.rightPanel, file, loading: false } }
        : {},
    );
  } catch (err) {
    if (request !== codeRequest) return;
    setState((st) =>
      st.rightPanel?.type === 'code'
        ? { rightPanel: { ...st.rightPanel, loading: false, error: errorMessage(err) } }
        : {},
    );
  }
}

function routeWorkspaceId(): string | null {
  const route = currentRoute();
  return route.name === 'workspace' || route.name === 'conversation' ? route.workspaceId : null;
}

/** Ask about a code selection (code viewer) or a file/folder (file explorer). */
export function askAboutCode(
  ref: CodeRef,
  context?: { graphId?: string; nodeId?: string } | null,
): void {
  focusAsk({
    type: 'code',
    ref,
    ...(context?.graphId ? { graphId: context.graphId } : {}),
    ...(context?.nodeId ? { nodeId: context.nodeId } : {}),
  });
}

export async function openInEditor(
  ref: Pick<CodeRef, 'folder' | 'path'>,
  line?: number,
): Promise<void> {
  const { s, conversation, workspace } = context();
  const workspaceId = conversation?.workspaceId ?? routeWorkspaceId();
  if (!workspaceId) return;
  const folder = refFolder(workspace ?? s.workspaces.find((w) => w.id === workspaceId), ref.folder);
  try {
    await api.openInEditor(workspaceId, { folder, path: ref.path, ...(line ? { line } : {}) });
  } catch (err) {
    reportError(err, "Couldn't open the editor");
  }
}

// ---- conversations / workspaces --------------------------------------------------------------

export async function exportConversation(
  conversation: Pick<ConversationSummary, 'id' | 'title'>,
  format: 'json' | 'md',
): Promise<void> {
  try {
    await download(
      api.conversationExportUrl(conversation.id, format),
      exportFileName(conversation.title, format),
    );
  } catch (err) {
    reportError(err, "Couldn't export");
  }
}

export async function exportWorkspaceBundle(
  workspace: Pick<Workspace, 'id' | 'name'>,
): Promise<void> {
  try {
    await download(api.workspaceExportUrl(workspace.id), exportFileName(workspace.name, 'json'));
  } catch (err) {
    reportError(err, "Couldn't export");
  }
}

export async function renameConversationFlow(
  conversation: Pick<ConversationSummary, 'id' | 'title'>,
): Promise<void> {
  const title = await promptText({
    title: 'Rename conversation',
    initialValue: conversation.title,
    submitLabel: 'Rename',
    maxLength: 200,
  });
  if (!title || title.trim() === conversation.title) return;
  try {
    await renameConversation(conversation.id, title.trim());
  } catch (err) {
    reportError(err, "Couldn't rename");
  }
}

export async function renameConversationInline(id: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) return;
  try {
    await renameConversation(id, clean);
  } catch (err) {
    reportError(err, "Couldn't rename");
  }
}

export async function duplicateConversationFlow(
  conversation: Pick<ConversationSummary, 'id' | 'workspaceId'>,
): Promise<void> {
  try {
    const copy = await duplicateConversation(conversation.id);
    toast({
      tone: 'success',
      title: 'Conversation duplicated',
      action: { label: 'Open', onClick: () => openConversationRoute(copy.workspaceId, copy.id) },
    });
  } catch (err) {
    reportError(err, "Couldn't duplicate");
  }
}

export async function deleteConversationFlow(
  conversation: Pick<ConversationSummary, 'id' | 'title' | 'workspaceId' | 'graphCount'>,
): Promise<void> {
  const ok = await confirmAction({
    title: 'Delete conversation?',
    message: `“${conversation.title}” and its ${conversation.graphCount} diagram${conversation.graphCount === 1 ? '' : 's'} will be removed.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const route = currentRoute();
  if (route.name === 'conversation' && route.conversationId === conversation.id) {
    navigate(routes.workspace(conversation.workspaceId), { replace: true });
  }
  try {
    await deleteConversation(conversation.id, conversation.workspaceId);
  } catch (err) {
    reportError(err, "Couldn't delete");
  }
}

export async function deleteWorkspaceFlow(
  workspace: Pick<Workspace, 'id' | 'name'>,
): Promise<void> {
  const ok = await confirmAction({
    title: 'Delete workspace?',
    message: `“${workspace.name}” and all of its conversations will be removed. Your folders on disk are not touched.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const route = currentRoute();
  if (
    (route.name === 'workspace' || route.name === 'conversation') &&
    route.workspaceId === workspace.id
  ) {
    navigate(routes.home(), { replace: true });
  }
  try {
    await deleteWorkspace(workspace.id);
  } catch (err) {
    reportError(err, "Couldn't delete");
  }
}

// ---- settings shortcuts ------------------------------------------------------------------------

export function setTheme(theme: Theme): void {
  if (getState().settings) updateSettings({ theme });
  else setThemeLocal(theme);
}

const THEME_CYCLE: Theme[] = ['system', 'light', 'dark'];

export function cycleTheme(): void {
  const current = getState().theme;
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length] ?? 'system';
  setTheme(next);
}

/** Flip between light and dark (relative to what is shown now). */
export function toggleTheme(): void {
  setTheme(getState().resolvedTheme === 'dark' ? 'light' : 'dark');
}

export async function redetectProviders(): Promise<void> {
  if (await refreshProviders())
    toast({ tone: 'success', title: 'Providers re-detected', duration: 2500 });
}
