// The tile at the head of a record row.

import { render } from '@testing-library/react';
import RecordLead from './RecordLead';

describe('RecordLead', () => {
  describe('normal', () => {
    test('TC-0222 an event date shows as a calendar leaf, month and day', () => {
      const { container } = render(<RecordLead date="2026-11-04" />);
      expect(container.querySelector('.cs-record-lead-month')).toHaveTextContent('Nov');
      expect(container.querySelector('.cs-record-lead-day')).toHaveTextContent('4');
    });
  });

  describe('boundary', () => {
    test.each([['2026-01-31', 'Jan', '31'], ['2026-12-01', 'Dec', '1']])('TC-0223 the first and last months read correctly (%s)', (date, month, day) => {
      const { container } = render(<RecordLead date={date} />);
      expect(container.querySelector('.cs-record-lead-month')).toHaveTextContent(month);
      expect(container.querySelector('.cs-record-lead-day')).toHaveTextContent(day);
    });
  });

  describe('failure', () => {
    test.each([[undefined], [null], [''], ['04/11/2026'], ['2026-13-01'], ['2026-00-10']])('TC-0224 no usable date (%p) falls back to the icon', (date) => {
      const { container } = render(<RecordLead date={date} icon="bell" />);
      expect(container.querySelector('.cs-record-lead-date')).toBeNull();
      expect(container.querySelector('.cs-record-lead svg')).not.toBeNull();
    });
  });
});
