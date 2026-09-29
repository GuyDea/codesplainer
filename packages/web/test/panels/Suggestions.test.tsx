import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Suggestions } from '../../src/panels';

afterEach(cleanup);

describe('Suggestions', () => {
  it('renders one chip per suggestion and picks on click', () => {
    const onPick = vi.fn();
    render(
      <Suggestions suggestions={['Where is auth?', 'How are errors reported?']} onPick={onPick} />,
    );
    expect(screen.getByRole('list', { name: 'Suggested questions' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'How are errors reported?' }));
    expect(onPick).toHaveBeenCalledWith('How are errors reported?');
  });

  it('renders nothing without suggestions', () => {
    const { container } = render(<Suggestions suggestions={[]} onPick={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
