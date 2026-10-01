import {
  defaultSettings,
  type Conversation,
  type ConversationSummary,
  type GraphEntry,
  type GraphSpec,
  type Workspace,
} from '@codesplainer/shared';
import { initialDataState } from '../src/store/reducers';
import type { DataState } from '../src/store/types';

export const spec: GraphSpec = {
  title: 'System',
  kind: 'architecture',
  nodes: [
    {
      id: 'ui',
      label: 'UI',
      kind: 'ui',
      refs: [{ path: 'src/ui.tsx', startLine: 1, endLine: 9 }],
      expandable: true,
    },
    { id: 'api', label: 'API', kind: 'service', refs: [], expandable: true },
    { id: 'db', label: 'DB', kind: 'store', refs: [], expandable: false },
  ],
  edges: [
    { id: 'e1', from: 'ui', to: 'api', kind: 'call', label: 'calls' },
    { id: 'e2', from: 'api', to: 'db', kind: 'write' },
  ],
  groups: [],
};

export function graph(id: string, extra: Partial<GraphEntry> = {}): GraphEntry {
  return {
    id,
    origin: { type: 'question' },
    question: `Q ${id}`,
    status: 'done',
    provider: 'mock',
    detail: 'balanced',
    spec: { ...spec, title: `T ${id}` },
    warnings: [],
    createdAt: `2024-01-01T00:00:0${id.length % 10}.000Z`,
    activity: [],
    attempt: 1,
    ...extra,
  };
}

export function conversation(
  id: string,
  graphs: GraphEntry[],
  extra: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title: `Conversation ${id}`,
    workspaceId: 'w1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    graphs,
    ...extra,
  };
}

export function summary(id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    title: `Conversation ${id}`,
    workspaceId: 'w1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    graphCount: 1,
    runningCount: 0,
    ...extra,
  };
}

export function workspace(id: string, extra: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name: `Workspace ${id}`,
    folders: [{ alias: 'app', path: `/code/${id}` }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...extra,
  };
}

export function dataState(extra: Partial<DataState> = {}): DataState {
  return { ...initialDataState(), settings: defaultSettings(), ...extra };
}
