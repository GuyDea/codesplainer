import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GraphThumbnail } from '../../src/graph/GraphThumbnail';
import { Legend } from '../../src/graph/Legend';
import { ConversationMap } from '../../src/graph/ConversationMap';
import { architectureSpec, sequenceSpec } from '../../src/graph/dev/samples';

afterEach(cleanup);

describe('GraphThumbnail', () => {
  it('draws one box per node, groups and edges', () => {
    const { container } = render(
      <GraphThumbnail spec={architectureSpec} width={228} height={116} markedNodeIds={['api']} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('228');
    expect(container.querySelectorAll('rect.cs-thumb-box')).toHaveLength(
      architectureSpec.nodes.length,
    );
    expect(container.querySelectorAll('rect.cs-thumb-group')).toHaveLength(
      architectureSpec.groups.length,
    );
    expect(container.querySelectorAll('polyline.cs-thumb-edge')).toHaveLength(
      architectureSpec.edges.length,
    );
    expect(container.querySelectorAll('rect.cs-thumb-box.is-marked')).toHaveLength(1);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(architectureSpec.title);
  });

  it('draws lifelines for sequence diagrams', () => {
    const { container } = render(<GraphThumbnail spec={sequenceSpec} highlightNodeId="api" />);
    expect(container.querySelectorAll('line.cs-thumb-lifeline')).toHaveLength(
      sequenceSpec.nodes.length,
    );
    expect(container.querySelectorAll('rect.cs-thumb-box.is-focus')).toHaveLength(1);
  });
});

describe('Legend', () => {
  it('lists only the kinds used by the diagram', () => {
    render(<Legend spec={architectureSpec} />);
    expect(screen.getByText('Service')).toBeTruthy();
    expect(screen.getByText('Store')).toBeTruthy();
    expect(screen.queryByText('Decision')).toBeNull();
    expect(screen.getByText('Calls')).toBeTruthy();
    expect(screen.getByText('Event')).toBeTruthy();
  });

  it('omits line styles for sequence diagrams', () => {
    render(<Legend spec={sequenceSpec} />);
    expect(screen.queryByText('Lines')).toBeNull();
  });
});

describe('ConversationMap', () => {
  it('shows an empty state without diagrams', () => {
    render(
      <ConversationMap
        conversation={{
          id: 'c',
          title: 'Empty',
          workspaceId: 'w',
          createdAt: '',
          updatedAt: '',
          graphs: [],
        }}
        onOpenGraph={() => {}}
      />,
    );
    expect(screen.getByText('No diagrams yet')).toBeTruthy();
  });
});
