import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

describe('ChatComposer', () => {
  it('accepts restored text and disables both keyboard and button sends', () => {
    const send = vi.fn();
    const change = vi.fn();
    const { rerender } = render(<ChatComposer onSend={send} value="restored turn" onValueChange={change} disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('restored turn');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).not.toHaveBeenCalled();
    rerender(<ChatComposer onSend={send} value="restored turn" onValueChange={change} />);
    fireEvent.change(input, { target: { value: 'edited turn' } });
    expect(change).toHaveBeenCalledWith('edited turn');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(send).toHaveBeenCalledWith('restored turn');
  });
  it('retains the uncontrolled chat behavior', () => {
    const send = vi.fn();
    render(<ChatComposer onSend={send} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('hello');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
