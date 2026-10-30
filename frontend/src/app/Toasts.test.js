// Confirmations as toasts, and the icon set they draw from.

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toasts, { DISMISS_AFTER_MS } from './Toasts';
import Icon from './Icon';

afterEach(() => jest.useRealTimers());

describe('Toasts', () => {
  test('TC-2512 [normal] a toast is a success unless it says otherwise; an error toast reads as one', () => {
    const { container } = render(<Toasts toasts={[{ id: 'a', message: 'Saved.' }, { id: 'b', message: 'Failed.', tone: 'error' }]} onDismiss={jest.fn()} />);
    expect(screen.getByText('Saved.').closest('.cs-toast')).toHaveClass('cs-toast-success');
    expect(screen.getByText('Failed.').closest('.cs-toast')).toHaveClass('cs-toast-error');
    expect(container.querySelectorAll('.cs-toast')).toHaveLength(2);
  });

  test('TC-2513 [boundary] a toast stays until exactly its time is up, then asks to be dismissed', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toasts toasts={[{ id: 'a', message: 'Saved.' }]} onDismiss={onDismiss} />);
    act(() => { jest.advanceTimersByTime(DISMISS_AFTER_MS - 1); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledWith('a');
  });

  test('TC-2514 [normal] the close button dismisses that toast, and an empty list is still a live region', async () => {
    const onDismiss = jest.fn();
    const { rerender } = render(<Toasts toasts={[{ id: 'a', message: 'Saved.' }]} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledWith('a');
    rerender(<Toasts toasts={[]} onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('Icon', () => {
  test('TC-2515 [failure] an icon name nobody has mapped still draws a glyph rather than nothing', () => {
    const { container } = render(<><Icon name="no-such-icon" /><Icon name="bell" className="custom" /></>);
    const [fallback, bell] = container.querySelectorAll('svg');
    expect(fallback).toHaveClass('cs-icon');
    expect(fallback).toHaveAttribute('aria-hidden', 'true');
    expect(bell).toHaveClass('custom');
  });
});
