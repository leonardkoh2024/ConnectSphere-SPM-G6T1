// A1 / SCRUM-82 — the password input and its live rule list.

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordField, { PasswordChecklist } from './PasswordField';

const CHECKS = [{ id: 'length', label: 'At least 12 characters', met: false }, { id: 'number', label: 'One number', met: true }];
const rule = (name) => screen.getByText(name).closest('li');

describe('PasswordField', () => {
  describe('normal', () => {
    test('TC-0006 the eye button shows and hides the value, and never submits the form', async () => {
      const onSubmit = jest.fn((event) => event.preventDefault());
      render(<form onSubmit={onSubmit}><PasswordField id="pw" label="Password" value="secret" onChange={() => {}} /></form>);
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('type', 'password');
      expect(input).not.toHaveAttribute('aria-describedby');

      await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
      expect(input).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
      expect(input).toHaveAttribute('type', 'password');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test('TC-0007 with checks it lists each rule, met or not, and links the list to the input', () => {
      const onChange = jest.fn();
      render(<PasswordField id="pw" label="Password" value="abc1" onChange={onChange} checks={CHECKS} />);
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', 'pw-checks');
      expect(rule('One number')).toHaveClass('cs-password-check-met');
      expect(rule('One number')).toHaveTextContent('— met');
      expect(rule('At least 12 characters')).toHaveClass('cs-password-check-unmet');
      expect(rule('At least 12 characters')).toHaveTextContent('— not met');
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'abc12' } });
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('boundary', () => {
    test('TC-0008 an empty field is not yet wrong: unmet rules stay neutral until something is typed', () => {
      render(<PasswordField id="pw" label="Password" value="" onChange={() => {}} checks={CHECKS} />);
      expect(rule('At least 12 characters')).toHaveClass('cs-password-check');
      expect(rule('At least 12 characters')).not.toHaveClass('cs-password-check-unmet');
      expect(rule('At least 12 characters')).not.toHaveTextContent('not met');
    });

    test('TC-0009 the checklist on its own treats the field as started', () => {
      render(<PasswordChecklist id="c" checks={CHECKS} />);
      expect(rule('At least 12 characters')).toHaveClass('cs-password-check-unmet');
    });
  });
});
