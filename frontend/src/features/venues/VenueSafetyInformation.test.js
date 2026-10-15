import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VenueSafetyInformation from './VenueSafetyInformation';
import { loadVenueSafetyCatalogue } from './venuesApi';

jest.mock('./venuesApi', () => ({ loadVenueSafetyCatalogue: jest.fn() }));

beforeEach(() => {
  loadVenueSafetyCatalogue.mockResolvedValue([
    {
      venue_id: 'VEN-001',
      name: 'Harbour Hall',
      building: 'Harbour Centre',
      location: 'SOUTH',
      max_capacity: 650,
      emergency_access_notes: 'Ambulance access is via the west loading bay.',
      known_restrictions: 'No open flames.'
    }
  ]);
});

test('E10 Safety Officers can open complete venue safety information without edit controls', async () => {
  render(<VenueSafetyInformation />);
  const heading = await screen.findByText('Harbour Hall');
  const row = heading.closest('.cs-record');

  await userEvent.click(within(row).getByRole('button', { name: /view safety information/i }));

  expect(within(row).getByText('Ambulance access is via the west loading bay.')).toBeInTheDocument();
  expect(within(row).getByText('No open flames.')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: /update|edit|save/i })).not.toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: /close/i }));
  expect(within(row).queryByText('No open flames.')).not.toBeInTheDocument();
});

test('E10 load errors are displayed accessibly', async () => {
  loadVenueSafetyCatalogue.mockRejectedValue(new Error('Venue safety information could not be loaded.'));
  render(<VenueSafetyInformation />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Venue safety information could not be loaded.');
});
