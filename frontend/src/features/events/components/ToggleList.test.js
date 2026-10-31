// B2 / B3 — the multi-select checkbox groups for facilities and accessibility needs.
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToggleList from './ToggleList';

function Harness({ initial = [], ...props }) {
  const [values, setValues] = useState(initial);
  return <>
    <ToggleList label="Facilities" options={['WIFI', 'WHEELCHAIR_ACCESS']} values={values} onChange={setValues} {...props} />
    <output>{values.join('|')}</output>
  </>;
}

describe('B2 SCRUM-93 / B3 SCRUM-94 a checkbox group', () => {
  describe('normal', () => {
    test('TC-0191 B2 ticking adds an option and unticking removes only that one', async () => {
      render(<Harness />);
      await userEvent.click(screen.getByLabelText('WIFI'));
      await userEvent.click(screen.getByLabelText('WHEELCHAIR ACCESS'));
      expect(screen.getByRole('status')).toHaveTextContent('WIFI|WHEELCHAIR_ACCESS');

      await userEvent.click(screen.getByLabelText('WIFI'));
      expect(screen.getByRole('status')).toHaveTextContent(/^WHEELCHAIR_ACCESS$/);
    });

    test('TC-0194 B3 a required group carries the required marker', () => {
      const { container } = render(<Harness required />);
      expect(container.querySelector('.cs-required')).toHaveTextContent('*');
    });
  });

  describe('boundary', () => {
    test('TC-0192 B2 a disabled group cannot be changed and has no required marker by default', async () => {
      const { container } = render(<Harness disabled initial={['WIFI']} />);
      expect(screen.getByLabelText('WIFI')).toBeChecked();
      expect(screen.getByLabelText('WIFI')).toBeDisabled();
      await userEvent.click(screen.getByLabelText('WHEELCHAIR ACCESS'));
      expect(screen.getByRole('status')).toHaveTextContent(/^WIFI$/);
      expect(container.querySelector('.cs-required')).toBeNull();
    });
  });
});
