import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import type { FileContent } from '@codesplainer/shared';
import { CodeViewer, type CodeViewerProps } from '../../src/panels';

afterEach(cleanup);

const file: FileContent = {
  folder: 'app',
  path: 'src/server/api.ts',
  absolutePath: '/home/me/app/src/server/api.ts',
  size: 2048,
  lineCount: 3,
  truncated: true,
  binary: false,
  language: 'typescript',
  content: 'export function createApp() {\n  return 42;\n}\n',
};

function props(overrides: Partial<CodeViewerProps> = {}): CodeViewerProps {
  return {
    file,
    loading: false,
    range: { startLine: 1, endLine: 2 },
    multiFolder: true,
    theme: 'light',
    onAskSelection: vi.fn(),
    onOpenInEditor: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('CodeViewer', () => {
  it('renders the header for a file', () => {
    const p = props();
    render(<CodeViewer {...p} />);
    expect(screen.getByText('api.ts')).toBeTruthy();
    expect(screen.getByText('src/server/')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getByText(/2\.0 KB · 3 lines/)).toBeTruthy();
    expect(screen.getByText('Truncated')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scroll to lines 1–2' }).textContent).toBe('L1–2');
    // The range is highlighted in the editor.
    expect(document.querySelectorAll('.cm-range-line')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Open in editor at line 1' }));
    expect(p.onOpenInEditor).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('asks about the selected lines and survives theme switches', () => {
    const p = props();
    const { rerender } = render(<CodeViewer {...p} />);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement);
    expect(view).toBeTruthy();
    act(() => {
      view?.dispatch({ selection: { anchor: 0, head: view.state.doc.line(2).to } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask about lines 1–2' }));
    expect(p.onAskSelection).toHaveBeenCalledWith({
      startLine: 1,
      endLine: 2,
      text: 'export function createApp() {\n  return 42;',
    });
    rerender(<CodeViewer {...p} theme="dark" />);
    expect(document.querySelector('.cm-editor')).toBe(view?.dom);
  });

  it('shows a skeleton while loading and an error state', () => {
    const { rerender } = render(<CodeViewer {...props({ file: null, loading: true })} />);
    expect(screen.getByRole('status', { name: 'Loading file' })).toBeTruthy();
    rerender(
      <CodeViewer {...props({ file: null, loading: false, error: 'ENOENT: no such file' })} />,
    );
    expect(screen.getByText('Couldn’t open file')).toBeTruthy();
    expect(screen.getByText('ENOENT: no such file')).toBeTruthy();
  });

  it('does not render binary content', () => {
    const p = props({ file: { ...file, binary: true, content: '', truncated: false } });
    render(<CodeViewer {...p} />);
    expect(screen.getByText('Binary file')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Open in editor/ })[1] as HTMLElement);
    expect(p.onOpenInEditor).toHaveBeenCalled();
  });
});
