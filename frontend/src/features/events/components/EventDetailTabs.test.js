// The event detail page's tab bar.

import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventDetailTabs from './EventDetailTabs';

function Harness({ attention = false }) {
  const [active, setActive] = useState('request');
  return <EventDetailTabs active={active} onChange={setActive} tabs={[
    { id: 'request', label: 'Event request', content: <input aria-label="Event name" defaultValue="" /> },
    { id: 'clarifications', label: 'Clarifications', count: 2, attention, content: <p>Clarification history</p> }
  ]} />;
}

test('TC-0389 clicking or arrowing to a tab shows its panel and keeps the other mounted', async () => {
  render(<Harness />);
  const request = screen.getByRole('tab', { name: 'Event request' });
  const clarifications = screen.getByRole('tab', { name: /^Clarifications/ });

  await userEvent.type(screen.getByLabelText('Event name'), 'Partner Summit');
  await userEvent.click(clarifications);

  expect(clarifications).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Clarification history')).toBeVisible();
  expect(screen.getByLabelText('Event name')).not.toBeVisible();

  clarifications.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(request).toHaveAttribute('aria-selected', 'true');
  expect(request).toHaveFocus();
  // The unsaved typing survived the round trip.
  expect(screen.getByLabelText('Event name')).toHaveValue('Partner Summit');

  await userEvent.keyboard('{End}');
  expect(clarifications).toHaveAttribute('aria-selected', 'true');
  expect(request).toHaveAttribute('tabindex', '-1');
});

test('TC-0390 the Clarifications tab shows its count, and says when a reply is needed', () => {
  const { rerender } = render(<Harness />);
  expect(screen.getByRole('tab', { name: /^Clarifications\s*2$/ })).toBeInTheDocument();

  rerender(<Harness attention />);
  expect(screen.getByRole('tab', { name: /^Clarifications\s*2\s*, reply needed$/ })).toBeInTheDocument();
});

describe('the event detail tab bar', () => {
  describe('boundary', () => {
    test('TC-0391 ArrowLeft from the first tab wraps to the last, Home returns to the first, ArrowRight from the last wraps to the first', async () => {
      render(<Harness />);
      const request = screen.getByRole('tab', { name: 'Event request' });
      const clarifications = screen.getByRole('tab', { name: /^Clarifications/ });
      request.focus();
      await userEvent.keyboard('{ArrowLeft}');
      expect(clarifications).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{Home}');
      expect(request).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{End}');
      await userEvent.keyboard('{ArrowRight}');
      expect(request).toHaveAttribute('aria-selected', 'true');
    });

    test('TC-0392 any other key leaves the selection alone, and a tab with no count shows no badge', async () => {
      const onChange = jest.fn();
      const { container } = render(<EventDetailTabs active="a" onChange={onChange} tabs={[
        { id: 'a', label: 'A', content: null }, { id: 'b', label: 'B', count: 0, content: null }
      ]} />);
      screen.getByRole('tab', { name: 'A' }).focus();
      await userEvent.keyboard('x');
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('.cs-detail-tab-count')).toBeNull();
      expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Event sections');
    });
  });
});
