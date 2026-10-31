import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

describe('ChatComposer', () => {
  it('updates uncontrolled text and notifies the observer, including failed-send recovery', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const change = vi.fn();
    render(<ChatComposer onSend={send} onValueChange={change} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(input).toHaveValue('hello');
    expect(change).toHaveBeenLastCalledWith('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('hello'));
    await waitFor(() => expect(input).toHaveValue('hello'));
    expect(change.mock.calls.map(([value]) => value)).toEqual(['hello', '', 'hello']);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue('');
  });
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
