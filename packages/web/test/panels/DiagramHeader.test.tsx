import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DiagramHeader, type DiagramHeaderProps } from '../../src/panels';
import { entry, providers } from './fixtures';

afterEach(cleanup);

function setup(overrides: Partial<DiagramHeaderProps> = {}) {
  const props: DiagramHeaderProps = {
    graph: entry(
      'g2',
      { type: 'expand', parentGraphId: 'g1', nodeId: 'api', nodeLabel: 'API server' },
      {
        model: 'sonnet',
        usage: { durationMs: 42_000, costUsd: 0.1234, inputTokens: 12_000, outputTokens: 800 },
        warnings: ['Dropped 1 edge(s) pointing to unknown nodes.'],
      },
    ),
    providers,
    onRename: vi.fn(),
    onRetry: vi.fn(),
    onExport: vi.fn(),
    onToggleStar: vi.fn(),
    onDelete: vi.fn(),
    onSaveNote: vi.fn(),
    onShowActivity: vi.fn(),
    descendantCount: 2,
    ...overrides,
  };
  render(<DiagramHeader {...props} />);
  return props;
}

describe('DiagramHeader', () => {
  it('shows title, meta and summary', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Diagram g2/ })).toBeTruthy();
    for (const text of ['Claude Code', 'sonnet', '42 s', '$0.12', '12.8k tokens']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByLabelText('1 warning')).toBeTruthy();
    expect(screen.getByText(/The UI calls the API server/)).toBeTruthy();
  });

  it('renames inline', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /Diagram g2/ }));
    const input = screen.getByRole('textbox', { name: 'Diagram title' });
    fireEvent.change(input, { target: { value: 'API internals' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRename).toHaveBeenCalledWith('API internals');
  });

  it('retries with options from the retry menu', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry with fresh session' }));
    expect(p.onRetry).toHaveBeenLastCalledWith({ fresh: true });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry with Codex' }));
    expect(p.onRetry).toHaveBeenLastCalledWith({ provider: 'codex' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Detailed/ }));
    expect(p.onRetry).toHaveBeenLastCalledWith({ detail: 'detailed' });
  });

  it('exports and confirms deletion', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Mermaid' }));
    expect(p.onExport).toHaveBeenCalledWith('mermaid');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('2 diagrams below it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).toHaveBeenCalled();
  });

  it('edits the note in a dialog', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Check the retry logic' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.onSaveNote).toHaveBeenCalledWith('Check the retry logic');
  });
});
