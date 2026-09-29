import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ProgressView, activityCategory } from '../../src/panels';
import { activity, entry } from './fixtures';

afterEach(cleanup);

describe('ProgressView', () => {
  it('shows the latest activity, files touched and cancels', () => {
    const onCancel = vi.fn();
    const graph = entry(
      'g9',
      { type: 'question' },
      {
        status: 'running',
        spec: undefined,
        startedAt: new Date(Date.now() - 65_000).toISOString(),
        model: 'sonnet',
      },
    );
    render(
      <ProgressView
        graph={graph}
        activity={activity(9)}
        providerName="Claude Code"
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Exploring the code…');
    const list = screen.getByRole('list', { name: 'Recent activity' });
    const items = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    // Only the latest six, oldest first.
    expect(items).toEqual([3, 4, 5, 6, 7, 8].map((i) => `Read src/file${i}.ts`));
    expect(screen.getByText('4 files touched')).toBeTruthy();
    expect(screen.getByText('Claude Code · sonnet')).toBeTruthy();
    expect(screen.getByLabelText('Elapsed time').textContent).toMatch(/^1:0[5-9]$/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the queue position while queued', () => {
    const graph = entry('g9', { type: 'question' }, { status: 'queued', spec: undefined });
    render(
      <ProgressView
        graph={graph}
        activity={[]}
        providerName="Codex"
        queuePosition={2}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Queued · #2');
    expect(screen.queryByRole('list', { name: 'Recent activity' })).toBeNull();
  });

  it('classifies tool activity by its text', () => {
    expect(activityCategory('tool', 'Grep "auth" in src')).toBe('search');
    expect(activityCategory('tool', 'Read src/app.ts')).toBe('read');
    expect(activityCategory('tool', 'fs_read src/app.ts')).toBe('read');
    expect(activityCategory('tool', 'execute_bash: npm test')).toBe('run');
    expect(activityCategory('tool', 'List directory src')).toBe('list');
    expect(activityCategory('thinking', 'Hmm')).toBe('thinking');
  });
});
