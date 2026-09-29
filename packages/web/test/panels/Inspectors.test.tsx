import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EdgeInspector, NodeInspector, type NodeInspectorProps } from '../../src/panels';
import { conversation, spec } from './fixtures';

afterEach(cleanup);

function nodeProps(
  nodeId: string,
  overrides: Partial<NodeInspectorProps> = {},
): NodeInspectorProps {
  const conv = conversation();
  const graph = conv.graphs[0]!;
  return {
    conversation: conv,
    graph,
    node: graph.spec!.nodes.find((n) => n.id === nodeId)!,
    multiFolder: false,
    onExpand: vi.fn(),
    onAsk: vi.fn(),
    onOpenRef: vi.fn(),
    onOpenInEditor: vi.fn(),
    onOpenGraph: vi.fn(),
    onSelectNode: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('NodeInspector', () => {
  it('offers "Explain & expand" for a box without an expansion', () => {
    const p = nodeProps('ui');
    render(<NodeInspector {...p} />);
    expect(screen.getByRole('heading', { name: 'Web UI' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Explain & expand/ }));
    expect(p.onExpand).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ask about this/ }));
    expect(p.onAsk).toHaveBeenCalled();
    // Code refs
    fireEvent.click(screen.getByRole('button', { name: /App\.tsx/ }));
    expect(p.onOpenRef).toHaveBeenCalledWith(spec.nodes[0]!.refs[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    expect(p.onOpenInEditor).toHaveBeenCalledWith(spec.nodes[0]!.refs[0]);
    // Connections: outgoing call to the API server.
    fireEvent.click(screen.getByRole('button', { name: /API server/ }));
    expect(p.onSelectNode).toHaveBeenCalledWith('api');
  });

  it('opens an existing expansion and lists diagrams from the box', () => {
    const p = nodeProps('api');
    render(<NodeInspector {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Open expansion/ }));
    expect(p.onOpenGraph).toHaveBeenCalledWith('g2');
    expect(screen.getByRole('button', { name: /Expand again/ })).toBeTruthy();
    expect(screen.getByText('Diagrams from this box')).toBeTruthy();
    expect(screen.getByText('createApp · src/server')).toBeTruthy();
  });

  it('hides expansion for non-expandable boxes', () => {
    render(<NodeInspector {...nodeProps('db')} />);
    expect(screen.queryByRole('button', { name: /Explain & expand/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Ask about this/ })).toBeTruthy();
  });
});

describe('EdgeInspector', () => {
  it('shows both ends and explains the interaction', () => {
    const graph = conversation().graphs[0]!;
    const onExplain = vi.fn();
    const onSelectNode = vi.fn();
    render(
      <EdgeInspector
        graph={graph}
        edge={spec.edges[0]!}
        onExplain={onExplain}
        onSelectNode={onSelectNode}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'fetch /api' })).toBeTruthy();
    expect(screen.getByText('Step 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Postgres|API server/ }));
    expect(onSelectNode).toHaveBeenCalledWith('api');
    fireEvent.click(screen.getByRole('button', { name: 'Explain this interaction' }));
    expect(onExplain).toHaveBeenCalled();
  });
});
