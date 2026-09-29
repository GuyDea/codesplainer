import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DirListing, Workspace } from '@codesplainer/shared';
import { ActivityLog, FileExplorer } from '../../src/panels';
import { activity } from './fixtures';

afterEach(cleanup);

const workspace: Workspace = {
  id: 'w1',
  name: 'Demo',
  folders: [{ alias: 'app', path: '/home/me/app' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const listings: Record<string, DirListing> = {
  '': {
    folder: 'app',
    path: '',
    truncated: false,
    entries: [
      { name: 'README.md', path: 'README.md', type: 'file', size: 10 },
      { name: 'src', path: 'src', type: 'dir' },
      { name: 'node_modules', path: 'node_modules', type: 'dir', ignored: true },
    ],
  },
  src: {
    folder: 'app',
    path: 'src',
    truncated: false,
    entries: [{ name: 'main.ts', path: 'src/main.ts', type: 'file', size: 20 }],
  },
};

describe('FileExplorer', () => {
  it('loads directories lazily and opens files', async () => {
    const loadDir = vi.fn(async (_folder: string, path: string) => listings[path] as DirListing);
    const onOpenFile = vi.fn();
    const onAskAbout = vi.fn();
    render(
      <FileExplorer
        workspace={workspace}
        loadDir={loadDir}
        onOpenFile={onOpenFile}
        onAskAbout={onAskAbout}
      />,
    );
    await screen.findByText('README.md');
    expect(loadDir).toHaveBeenCalledWith('app', '');
    expect(loadDir).toHaveBeenCalledTimes(1);

    // Dirs sort first; ignored entries are dimmed (few of them, so not folded).
    const tree = screen.getByRole('tree');
    const names = within(tree)
      .getAllByRole('treeitem')
      .map((r) => r.textContent);
    expect(names).toEqual(['app', 'node_modules', 'src', 'README.md']);

    fireEvent.click(screen.getByText('src'));
    await screen.findByText('main.ts');
    expect(loadDir).toHaveBeenCalledWith('app', 'src');

    fireEvent.click(screen.getByText('main.ts'));
    expect(onOpenFile).toHaveBeenCalledWith({ folder: 'app', path: 'src/main.ts' });

    const readme = screen.getByText('README.md').closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(within(readme).getByRole('button', { name: 'Ask about this' }));
    expect(onAskAbout).toHaveBeenCalledWith({ folder: 'app', path: 'README.md' });
    expect(onOpenFile).toHaveBeenCalledTimes(1);

    // Filter over loaded entries (flat results).
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter loaded files' }), {
      target: { value: 'main' },
    });
    await waitFor(() =>
      expect(within(screen.getByRole('tree')).getAllByRole('treeitem')).toHaveLength(1),
    );
  });
});

describe('ActivityLog', () => {
  it('renders rows with time, text and path chips; empty state otherwise', () => {
    const items = activity(2).map((a, i) => (i === 0 ? { ...a, text: 'Searching' } : a));
    const { rerender } = render(<ActivityLog items={items} live />);
    const log = screen.getByRole('log');
    expect(within(log).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Searching')).toBeTruthy();
    expect(screen.getByText('src/file0.ts')).toBeTruthy();
    rerender(<ActivityLog items={[]} />);
    expect(screen.getByText('No activity yet')).toBeTruthy();
  });
});
