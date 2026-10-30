import { render, screen, waitFor, within } from '@testing-library/react';
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

test('TC-0835 E10 Safety Officers can open complete venue safety information without edit controls', async () => {
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

test('TC-0836 E10 load errors are displayed accessibly', async () => {
  loadVenueSafetyCatalogue.mockRejectedValue(new Error('Venue safety information could not be loaded.'));
  render(<VenueSafetyInformation />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Venue safety information could not be loaded.');
});

describe("boundary", () => {
  test("TC-0837 E10 AC3 — loading first, then a sparse venue shows Not recorded / None recorded rather than blanks", async () => {
    loadVenueSafetyCatalogue.mockResolvedValue([{ venue_id: "VEN-002", name: "Annex" }]);
    render(<VenueSafetyInformation />);
    expect(screen.getByText(/loading venue safety information/i)).toBeInTheDocument();
    const row = (await screen.findByText("Annex")).closest(".cs-record");
    expect(row).toHaveTextContent("Building not recorded");
    expect(row).toHaveTextContent("Location not recorded");
    userEvent.click(within(row).getByRole("button", { name: /view safety information/i }));
    expect(within(row).getByText("Maximum capacity").nextSibling).toHaveTextContent("Not recorded");
    expect(within(row).getAllByText("None recorded")).toHaveLength(2);
  });

  test("TC-0838 E10 AC3 — no venues at all says so", async () => {
    loadVenueSafetyCatalogue.mockResolvedValue([]);
    render(<VenueSafetyInformation />);
    expect(await screen.findByText(/no venue safety information is available/i)).toBeInTheDocument();
  });
});

describe("failure", () => {
  test("TC-0839 E10 — a refusal without a message falls back; a load settling after unmount changes nothing", async () => {
    loadVenueSafetyCatalogue.mockRejectedValueOnce({});
    const { unmount } = render(<VenueSafetyInformation />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Venue safety information could not be loaded.");
    unmount();

    let resolve;
    let reject;
    loadVenueSafetyCatalogue.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    render(<VenueSafetyInformation />).unmount();
    resolve([]);
    loadVenueSafetyCatalogue.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej; }));
    render(<VenueSafetyInformation />).unmount();
    reject(new Error("late"));
    await waitFor(() => expect(loadVenueSafetyCatalogue).toHaveBeenCalledTimes(3));
  });
});
