import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Outline } from '../../src/panels';
import { conversation } from './fixtures';

afterEach(cleanup);

const labels = () => screen.getAllByRole('treeitem').map((el) => el.getAttribute('aria-label'));

describe('Outline', () => {
  it('renders the discussion tree nested by parent', () => {
    render(<Outline conversation={conversation()} currentGraphId="g2" onOpen={() => {}} />);
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((r) => r.getAttribute('data-row-id'))).toEqual(['g1', 'g2', 'g4', 'g3', 'g5']);
    expect(rows.map((r) => r.getAttribute('aria-level'))).toEqual(['1', '2', '3', '2', '1']);
    // Pending diagrams show their question; expansions carry a relation hint.
    expect(labels()[2]).toBe('Expand: Postgres, from Postgres, Generating');
    expect(screen.getByText('↳ API server')).toBeTruthy();
    // Current diagram is selected.
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('filters rows but keeps matching ancestors', () => {
    const { rerender } = render(
      <Outline
        conversation={conversation()}
        currentGraphId={null}
        onOpen={() => {}}
        filter="postgres"
      />,
    );
    // Every diagram contains a "Postgres" node, so everything matches.
    expect(screen.getAllByRole('treeitem')).toHaveLength(5);

    rerender(
      <Outline
        conversation={conversation()}
        currentGraphId={null}
        onOpen={() => {}}
        filter="expand: post"
      />,
    );
    // Only g4 matches (its question); g1 and g2 stay visible as ancestors.
    expect(screen.getAllByRole('treeitem').map((r) => r.getAttribute('data-row-id'))).toEqual([
      'g1',
      'g2',
      'g4',
    ]);

    rerender(
      <Outline
        conversation={conversation()}
        currentGraphId={null}
        onOpen={() => {}}
        filter="deployment"
      />,
    );
    expect(screen.getAllByRole('treeitem').map((r) => r.getAttribute('data-row-id'))).toEqual([
      'g5',
    ]);

    rerender(
      <Outline
        conversation={conversation()}
        currentGraphId={null}
        onOpen={() => {}}
        filter="zzz"
      />,
    );
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('opens with the keyboard and collapses with ArrowLeft', () => {
    const onOpen = vi.fn();
    render(<Outline conversation={conversation()} currentGraphId="g1" onOpen={onOpen} />);
    const tree = screen.getByRole('tree');
    const first = within(tree).getAllByRole('treeitem')[0] as HTMLElement;
    expect(first.tabIndex).toBe(0);
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('g2');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('g2');

    // Collapse g2 (has a child) -> g4 disappears; ArrowRight expands it again.
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(screen.queryByRole('treeitem', { name: /Expand: Postgres/ })).toBeNull();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: /Expand: Postgres/ })).toBeTruthy();

    // ArrowLeft on a leaf moves to the parent.
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('g4');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('g2');
  });

  it('opens on click and renames inline on double-click', () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    render(
      <Outline
        conversation={conversation()}
        currentGraphId="g1"
        onOpen={onOpen}
        onRename={onRename}
      />,
    );
    const row = screen.getByRole('treeitem', { name: /Diagram g3/ });
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('g3');

    fireEvent.doubleClick(row);
    const input = screen.getByRole('textbox', { name: 'Diagram title' }) as HTMLInputElement;
    expect(input.value).toBe('Diagram g3');
    fireEvent.change(input, { target: { value: 'Follow-up on auth' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('g3', 'Follow-up on auth');
  });

  it('deletes from the row menu, optionally after confirmation', () => {
    const onDelete = vi.fn();
    const { unmount } = render(
      <Outline
        conversation={conversation()}
        currentGraphId="g1"
        onOpen={() => {}}
        onDelete={onDelete}
      />,
    );
    const g3 = screen.getByRole('treeitem', { name: /^Diagram g3/ });
    fireEvent.click(within(g3).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith('g3');
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    render(
      <Outline
        conversation={conversation()}
        currentGraphId="g1"
        onOpen={() => {}}
        onDelete={onDelete}
        confirmDelete
      />,
    );
    const row = screen.getByRole('treeitem', { name: /^Diagram g1/ });
    fireEvent.click(within(row).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('3 diagrams below it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('g1');
  });

  it('shows an empty state without diagrams', () => {
    render(
      <Outline
        conversation={{ ...conversation(), graphs: [] }}
        currentGraphId={null}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('No diagrams yet')).toBeTruthy();
  });
});
