import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GraphEntry } from '@codesplainer/shared';
import { Breadcrumbs } from '../../src/panels';
import { entry } from './fixtures';

afterEach(cleanup);

function chain(n: number): GraphEntry[] {
  return Array.from({ length: n }, (_, i) =>
    i === 0
      ? entry('p0', { type: 'question' })
      : entry(`p${i}`, {
          type: 'expand',
          parentGraphId: `p${i - 1}`,
          nodeId: 'api',
          nodeLabel: 'API server',
        }),
  );
}

describe('Breadcrumbs', () => {
  it('renders every crumb for short paths; the current one is not clickable', () => {
    const onOpen = vi.fn();
    render(<Breadcrumbs path={chain(3)} onOpen={onOpen} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const current = screen.getByText('Diagram p2').closest('[aria-current]');
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: /Diagram p2/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Diagram p0/ }));
    expect(onOpen).toHaveBeenCalledWith('p0');
  });

  it('collapses the middle of long paths into a menu', () => {
    const onOpen = vi.fn();
    render(<Breadcrumbs path={chain(7)} onOpen={onOpen} />);
    // root, "…", last two
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Diagram p0')).toBeTruthy();
    expect(screen.queryByText('Diagram p3')).toBeNull();
    expect(screen.getByText('Diagram p5')).toBeTruthy();
    expect(screen.getByText('Diagram p6')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '4 more' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Diagram p1',
      'Diagram p2',
      'Diagram p3',
      'Diagram p4',
    ]);
    fireEvent.click(items[2] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith('p3');
  });

  it('honors maxItems', () => {
    render(<Breadcrumbs path={chain(5)} onOpen={() => {}} maxItems={5} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });
});
