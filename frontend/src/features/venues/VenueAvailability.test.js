import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadVenueSearchContext } from "./venuesApi";
import VenueAvailabilityCalendar, { VenueUnavailabilityManager } from "./VenueAvailability";

jest.mock("./venuesApi", () => ({ loadVenueSearchContext: jest.fn() }));

const venue = { venue_id: "VEN-001", name: "Hall A" };

beforeEach(() => {
  loadVenueSearchContext.mockResolvedValue({
    venues: [venue],
    bookings: [],
    unavailability: [{ id: "block-1", venue_id: "VEN-001", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Electrical maintenance" }]
  });
});

test("venue details show blocked periods to viewers and hide the editor", () => {
  render(<VenueUnavailabilityManager venue={venue} periods={[{ id: "block-1", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Electrical maintenance" }]} />);

  expect(screen.getByText("Electrical maintenance")).toBeInTheDocument();
  expect(screen.getByText("Blocked")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: /record unavailability/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /stage release/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
});

test("assigned staff can stage multiple periods and save them together", async () => {
  const onSave = jest.fn().mockResolvedValue();
  render(<VenueUnavailabilityManager venue={venue} canEdit onSave={onSave} />);

  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-12T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-12T12:00" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Electrical maintenance" } });
  await userEvent.click(screen.getByRole("button", { name: /add period/i }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText("Pending save")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-13T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-13T12:00" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Floor repairs" } });
  await userEvent.click(screen.getByRole("button", { name: /add period/i }));
  expect(onSave).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    venueId: "VEN-001",
    keepPeriodIds: [],
    additions: [
      { start_datetime: new Date("2026-10-12T09:00").toISOString(), end_datetime: new Date("2026-10-12T12:00").toISOString(), reason: "Electrical maintenance" },
      { start_datetime: new Date("2026-10-13T09:00").toISOString(), end_datetime: new Date("2026-10-13T12:00").toISOString(), reason: "Floor repairs" }
    ]
  }));
});

test("assigned staff stage a release and persist it only on save", async () => {
  const onSave = jest.fn().mockResolvedValue();
  render(<VenueUnavailabilityManager
    venue={venue}
    periods={[{ id: "block-1", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Electrical maintenance" }]}
    canEdit
    onSave={onSave}
  />);

  await userEvent.click(screen.getByRole("button", { name: /stage release/i }));
  expect(screen.getByText("Pending release")).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ venueId: "VEN-001", keepPeriodIds: [], additions: [] }));
});

test("an approved venue block appears in the availability calendar", async () => {
  render(<VenueAvailabilityCalendar user={{ uid: "staff-1" }} role="VENUE_STAFF" />);

  expect(await screen.findByRole("heading", { name: "Hall A" })).toBeInTheDocument();
  expect(screen.getByText("Electrical maintenance")).toBeInTheDocument();
  expect(screen.getByText("Blocked")).toBeInTheDocument();
});