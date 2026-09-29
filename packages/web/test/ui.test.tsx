import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Dialog, InlineEdit, Tabs, Toaster } from '../src/ui';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Stacked({
  onOuterClose,
  onInnerClose,
}: {
  onOuterClose: () => void;
  onInnerClose: () => void;
}) {
  const [inner, setInner] = useState(false);
  return (
    <Dialog open onClose={onOuterClose} title="Outer">
      <button type="button" onClick={() => setInner(true)}>
        Browse
      </button>
      {inner ? (
        <Dialog
          open
          onClose={() => {
            onInnerClose();
            setInner(false);
          }}
          title="Inner"
        />
      ) : null}
    </Dialog>
  );
}

describe('ui primitives', () => {
  it('closes only the top-most dialog on Esc and names dialogs by their title', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(<Stacked onOuterClose={outer} onInnerClose={inner} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(screen.getByRole('dialog', { name: 'Inner' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(outer).toHaveBeenCalledOnce();
  });

  it('auto-dismisses toasts and runs actions', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const action = vi.fn();
    render(
      <Toaster
        onDismiss={dismiss}
        toasts={[
          { id: 'a', tone: 'success', title: 'Saved', duration: 1000 },
          {
            id: 'b',
            tone: 'error',
            title: 'Failed',
            duration: 0,
            action: { label: 'Open', onClick: action },
          },
        ]}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(dismiss).toHaveBeenCalledWith('a');
    expect(dismiss).not.toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(action).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledWith('b');
    expect(screen.getByRole('alert').textContent).toContain('Failed');
  });

  it('edits inline: Enter saves, Esc cancels', () => {
    const submit = vi.fn();
    render(<InlineEdit value="Old" label="Title" onSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Title: Old' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: 'New' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Title: Old' }));
    const again = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(again, { target: { value: 'New' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith('New');
  });

  it('moves between tabs with the arrow keys', () => {
    const change = vi.fn();
    render(
      <Tabs
        aria-label="Sections"
        value="a"
        onChange={change}
        items={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    const tab = screen.getByRole('tab', { name: 'A' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(change).toHaveBeenCalledWith('b');
  });
});
