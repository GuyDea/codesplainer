import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AskBar, type AskBarProps, type AskScope } from '../../src/panels';
import { providers } from './fixtures';

afterEach(cleanup);

const scopes: AskScope[] = [
  { type: 'new' },
  { type: 'graph', graphId: 'g1', title: 'System overview' },
  { type: 'node', graphId: 'g1', nodeId: 'api', nodeLabel: 'API server' },
];

function setup(overrides: Partial<AskBarProps> = {}) {
  const props: AskBarProps = {
    scope: { type: 'new' },
    scopes,
    onScopeChange: vi.fn(),
    providers,
    provider: 'claude',
    model: '',
    detail: 'balanced',
    onProviderChange: vi.fn(),
    onModelChange: vi.fn(),
    onDetailChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  const utils = render(<AskBar {...props} />);
  const input = screen.getByRole('textbox', { name: 'Question' }) as HTMLTextAreaElement;
  return { ...utils, props, input };
}

describe('AskBar', () => {
  it('submits on Enter, not on Shift+Enter', () => {
    const { props, input } = setup();
    fireEvent.change(input, { target: { value: '  How does auth work?  ' } });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith('How does auth work?');
    expect(input.value).toBe('');
  });

  it('does not submit empty text; the send button is disabled', () => {
    const { props, input } = setup();
    const send = screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Where is the cache?' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(props.onSubmit).toHaveBeenCalledWith('Where is the cache?');
  });

  it('keeps the text when an async submit fails', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('nope')));
    const { input } = setup({ onSubmit });
    fireEvent.change(input, { target: { value: 'Explain the queue' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSubmit).toHaveBeenCalledWith('Explain the queue');
    expect(input.value).toBe('Explain the queue');
  });

  it('switches scope from the scope menu and adapts the placeholder', () => {
    const { props, input, rerender } = setup();
    expect(input.placeholder).toBe('Ask anything about this codebase…');

    fireEvent.click(screen.getByRole('button', { name: /^Scope:/ }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['New question', 'This diagram: System overview', 'Box: API server']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Box: API server' }));
    expect(props.onScopeChange).toHaveBeenCalledWith(scopes[2]);

    rerender(<AskBar {...props} scope={scopes[2] as AskScope} />);
    expect(input.placeholder).toBe('Ask about “API server”…');
    rerender(<AskBar {...props} scope={scopes[1] as AskScope} />);
    expect(input.placeholder).toBe('Ask a follow-up about this diagram…');
    rerender(
      <AskBar
        {...props}
        scope={{ type: 'code', ref: { path: 'src/a.ts', startLine: 1, endLine: 4 } }}
      />,
    );
    expect(input.placeholder).toBe('Ask about these lines…');
  });

  it('lists only enabled providers and disables unavailable ones', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }));
    const items = screen.getAllByRole('menuitem') as HTMLButtonElement[];
    const names = items.map((i) => i.textContent);
    expect(names.some((n) => n?.startsWith('Demo'))).toBe(false);
    const kiro = items.find((i) => i.textContent?.startsWith('Kiro CLI'));
    expect(kiro?.disabled).toBe(true);
    fireEvent.click(items.find((i) => i.textContent === 'Codex') as HTMLElement);
    expect(props.onProviderChange).toHaveBeenCalledWith('codex');
  });

  it('applies drafts when the nonce changes', () => {
    const { props, input, rerender } = setup({ draft: { text: 'Explain “API server”', nonce: 1 } });
    expect(input.value).toBe('Explain “API server”');
    fireEvent.change(input, { target: { value: 'edited' } });
    rerender(<AskBar {...props} draft={{ text: 'Explain “API server”', nonce: 1 }} />);
    expect(input.value).toBe('edited');
    rerender(<AskBar {...props} draft={{ text: 'Second', nonce: 2 }} />);
    expect(input.value).toBe('Second');
  });

  it('focuses the input when focusSignal changes', () => {
    const { props, input, rerender } = setup({ focusSignal: 0 });
    expect(document.activeElement).not.toBe(input);
    rerender(<AskBar {...props} focusSignal={1} />);
    expect(document.activeElement).toBe(input);
  });
});
