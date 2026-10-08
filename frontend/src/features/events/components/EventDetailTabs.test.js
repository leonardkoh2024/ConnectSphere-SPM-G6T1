// The event detail page's tab bar. TC-271 – TC-272 in docs/test-cases.md.

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

test('TC-271 clicking or arrowing to a tab shows its panel and keeps the other mounted', async () => {
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

test('TC-272 the Clarifications tab shows its count, and says when a reply is needed', () => {
  const { rerender } = render(<Harness />);
  expect(screen.getByRole('tab', { name: /^Clarifications\s*2$/ })).toBeInTheDocument();

  rerender(<Harness attention />);
  expect(screen.getByRole('tab', { name: /^Clarifications\s*2\s*, reply needed$/ })).toBeInTheDocument();
});
