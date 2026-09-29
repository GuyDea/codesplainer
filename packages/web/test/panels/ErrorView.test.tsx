import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GraphEntry } from '@codesplainer/shared';
import { ErrorView } from '../../src/panels';
import { entry, providers } from './fixtures';

afterEach(cleanup);

const failed = (
  error: string,
  origin: GraphEntry['origin'] = { type: 'ask-graph', parentGraphId: 'g1' },
) => entry('g7', origin, { status: 'error', spec: undefined, error, question: 'Where is auth?' });

describe('ErrorView', () => {
  it('offers retry, fresh retry and retry with another provider', () => {
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    render(
      <ErrorView
        graph={failed('Agent exited with code 1')}
        providers={providers}
        onRetry={onRetry}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Failed' })).toBeTruthy();
    expect(screen.getByText('Agent exited with code 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole('button', { name: 'Retry fresh' }));
    expect(onRetry).toHaveBeenLastCalledWith({ fresh: true });

    fireEvent.click(screen.getByRole('button', { name: 'Retry with…' }));
    // Only other enabled + available providers.
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Codex']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }));
    expect(onRetry).toHaveBeenLastCalledWith({ provider: 'codex' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
    // No settings hint for generic errors, no raw output without a handler.
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show raw output' })).toBeNull();
  });

  it('suggests settings for setup errors and shows raw output', () => {
    const onOpenSettings = vi.fn();
    const onShowRaw = vi.fn();
    render(
      <ErrorView
        graph={failed('Not logged in. Run `claude login`.', { type: 'question' })}
        providers={providers}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpenSettings={onOpenSettings}
        onShowRaw={onShowRaw}
      />,
    );
    // Root questions have no parent session to fork, so no "fresh" retry.
    expect(screen.queryByRole('button', { name: 'Retry fresh' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show raw output' }));
    expect(onShowRaw).toHaveBeenCalled();
  });

  it('shows cancelled diagrams', () => {
    render(
      <ErrorView
        graph={entry('g8', { type: 'question' }, { status: 'cancelled', spec: undefined })}
        providers={providers}
        onRetry={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Cancelled' })).toBeTruthy();
  });
});
