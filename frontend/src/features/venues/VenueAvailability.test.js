import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

test("TC-0715 venue details show blocked periods to viewers and hide the editor", () => {
  render(<VenueUnavailabilityManager venue={venue} periods={[{ id: "block-1", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Electrical maintenance" }]} />);

  expect(screen.getByText("Electrical maintenance")).toBeInTheDocument();
  expect(screen.getByText("Blocked")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: /record unavailability/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /stage release/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
});

test("TC-0716 assigned staff can stage multiple periods and save them together", async () => {
  const onSave = jest.fn().mockResolvedValue();
  render(<VenueUnavailabilityManager venue={venue} canEdit onSave={onSave} />);

  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-12T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-12T12:00" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Maintenance" } });
  await userEvent.click(screen.getByRole("button", { name: /add period/i }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText("Pending save")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-13T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-13T12:00" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Renovation" } });
  await userEvent.click(screen.getByRole("button", { name: /add period/i }));
  expect(onSave).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    venueId: "VEN-001",
    keepPeriodIds: [],
    additions: [
      { start_datetime: new Date("2026-10-12T09:00").toISOString(), end_datetime: new Date("2026-10-12T12:00").toISOString(), reason: "Maintenance", note: "" },
      { start_datetime: new Date("2026-10-13T09:00").toISOString(), end_datetime: new Date("2026-10-13T12:00").toISOString(), reason: "Renovation", note: "" }
    ],
    confirmOverlaps: false
  }));
});

test("TC-0717 assigned staff stage a release and persist it only on save", async () => {
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
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ venueId: "VEN-001", keepPeriodIds: [], additions: [], confirmOverlaps: false }));
});

test("TC-0718 an approved venue block appears in the availability calendar", async () => {
  render(<VenueAvailabilityCalendar user={{ uid: "staff-1" }} role="VENUE_STAFF" />);

  expect(await screen.findByRole("heading", { name: "Hall A" })).toBeInTheDocument();
  expect(screen.getByText("Electrical maintenance")).toBeInTheDocument();
  expect(screen.getByText("Blocked")).toBeInTheDocument();
});

// E7 / E11 — states not covered above, grouped by scenario kind.
const fillPeriod = ({ start = "2026-10-12T09:00", end = "2026-10-12T12:00", reason = "Maintenance" } = {}) => {
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: end } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });
};
const approvedBooking = {
  booking_id: "BKG-1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala",
  start_datetime: new Date("2026-10-12T10:00").toISOString(), end_datetime: new Date("2026-10-12T11:00").toISOString()
};

describe("normal", () => {
  test("TC-0868 E11 AC1 — a period over an approved booking asks for confirmation, then saves with confirmOverlaps", async () => {
    const onSave = jest.fn().mockResolvedValue();
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={onSave} bookings={[
      approvedBooking,
      { ...approvedBooking, booking_id: undefined, event_name: undefined, reference_no: "REF-2" },
      { ...approvedBooking, booking_id: "BKG-3", event_name: undefined }
    ]} />);
    fillPeriod();
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(/overlaps approved bookings/i);
    expect(within(warning).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Annual Gala", "REF-2", "BKG-3"]);
    expect(screen.queryByText("Pending save")).not.toBeInTheDocument();

    userEvent.click(screen.getByRole("button", { name: /confirm and add period/i }));
    expect(screen.queryByText(/overlaps approved bookings/i)).not.toBeInTheDocument();
    expect(screen.getByText("Pending save")).toBeInTheDocument();
    userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ confirmOverlaps: true })));
    await waitFor(() => expect(screen.queryByText("Pending save")).not.toBeInTheDocument());
  });

  test("TC-0719 E7 — reason Other with a note is staged with the trimmed note, and existing periods are kept", async () => {
    const onSave = jest.fn().mockResolvedValue();
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={onSave}
      periods={[{ id: "block-1", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Electrical maintenance" }]} />);
    fillPeriod({ start: "2026-10-14T09:00", end: "2026-10-14T12:00", reason: "Other" });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  Film shoot  " } });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      keepPeriodIds: ["block-1"],
      additions: [expect.objectContaining({ reason: "Other", note: "Film shoot" })]
    })));
  });

  test("TC-0720 E7 — a staged draft can be removed and a staged release undone, and Discard clears everything", () => {
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={jest.fn()}
      periods={[{ id: "block-1", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Electrical maintenance" }]} />);
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();

    userEvent.click(screen.getByRole("button", { name: /stage release/i }));
    expect(screen.getByText("Pending release")).toBeInTheDocument();
    userEvent.click(screen.getByRole("button", { name: /undo release/i }));
    expect(screen.queryByText("Pending release")).not.toBeInTheDocument();
    expect(save).toBeDisabled();

    fillPeriod({ start: "2026-10-13T09:00", end: "2026-10-13T12:00" });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    userEvent.click(screen.getByRole("button", { name: /remove draft/i }));
    expect(screen.queryByText("Pending save")).not.toBeInTheDocument();

    fillPeriod({ start: "2026-10-13T09:00", end: "2026-10-13T12:00" });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    userEvent.click(screen.getByRole("button", { name: /stage release/i }));
    userEvent.click(screen.getByRole("button", { name: /discard changes/i }));
    expect(screen.queryByText("Pending save")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending release")).not.toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  test("TC-0653 E4/F9 — the calendar lists approved bookings with setup and turnaround, pending bookings, sorted, and switches venue", async () => {
    loadVenueSearchContext.mockResolvedValue({
      venues: [{ ...venue, setup_minutes: 30, turnaround_minutes: 15 }, { venue_id: "VEN-002", name: "Studio B" }],
      bookings: [
        { booking_id: "B-2", venue_id: "VEN-001", status: "PENDING", reference_no: "REF-9", start_datetime: "2026-10-14T09:00:00.000Z", end_datetime: "2026-10-14T10:00:00.000Z" },
        { booking_id: "B-1", venue_id: "VEN-001", status: "approved", event_name: "Gala", start_datetime: "2026-10-13T09:00:00.000Z", end_datetime: "2026-10-13T10:00:00.000Z",
          suitability_acknowledgement: { acknowledged: true, criteria: ["capacity"], missing: {} } },
        { id: "B-3", venue_id: "VEN-002", start_datetime: "2026-10-15T09:00:00.000Z", end_datetime: "2026-10-15T10:00:00.000Z" },
        { id: "B-4", venue_id: "VEN-002", status: "APPROVED", booking_id: "B-4", start_datetime: "2026-10-16T09:00:00.000Z", end_datetime: "2026-10-16T10:00:00.000Z" },
        { id: "B-5", venue_id: "VEN-002", status: "APPROVED", start_datetime: "2026-10-17T09:00:00.000Z", end_datetime: "2026-10-17T10:00:00.000Z" }
      ],
      unavailability: []
    });
    render(<VenueAvailabilityCalendar user={{ uid: "staff-1" }} role="VENUE_STAFF" />);
    expect(screen.getByText(/loading venue availability/i)).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Hall A" });
    const items = [...document.querySelectorAll(".cs-availability-entry")];
    expect(items.map((item) => item.querySelector("p").textContent)).toEqual(["Setup · Gala", "Gala", "Turnaround · Gala", "REF-9"]);
    expect(screen.getByText("Approved booking")).toBeInTheDocument();
    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByText("Turnaround")).toBeInTheDocument();
    expect(screen.getByText("Pending booking")).toBeInTheDocument();
    // E8 AC3 — the accepted shortfall travels with the approved booking's segments.
    expect(screen.getAllByRole("note").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "VEN-002" } });
    expect(screen.getByRole("heading", { name: "Studio B" })).toBeInTheDocument();
    // A booking with no status is pending; with no name or reference it falls back to its id, then a generic label.
    expect([...document.querySelectorAll(".cs-availability-entry p")].map((item) => item.textContent)).toEqual(["Venue booking", "B-4", "Venue booking"]);
    expect(screen.getAllByText("Approved booking")).toHaveLength(2);
  });
});

describe("boundary", () => {
  test("TC-0721 E7 — an end equal to the start is refused", () => {
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={jest.fn()} />);
    fillPeriod({ start: "2026-10-12T09:00", end: "2026-10-12T09:00" });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/end date and time after the start/i);
    expect(screen.queryByText("Pending save")).not.toBeInTheDocument();
  });

  test("TC-0869 E11 — a period that only touches an approved booking needs no confirmation", () => {
    render(<VenueUnavailabilityManager venue={venue} canEdit bookings={[approvedBooking]} onSave={jest.fn()} />);
    fillPeriod({ start: "2026-10-12T11:00", end: "2026-10-12T12:00" });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Pending save")).toBeInTheDocument();
  });

  test("TC-0722 E7 — no periods shows the empty message; an unreadable date shows Time not set", () => {
    const { rerender } = render(<VenueUnavailabilityManager venue={venue} />);
    expect(screen.getByText(/no unavailability periods recorded/i)).toBeInTheDocument();
    rerender(<VenueUnavailabilityManager venue={venue} periods={[{ id: "p", start_datetime: "garbage", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Renovation" }]} />);
    expect(screen.getByText(/^Time not set to/)).toBeInTheDocument();
  });

  test("TC-0654 E4 — a venue with nothing booked or blocked, and a catalogue with no venues", async () => {
    loadVenueSearchContext.mockResolvedValue({ venues: [venue], bookings: [], unavailability: [] });
    const { unmount } = render(<VenueAvailabilityCalendar role="VENUE_STAFF" />);
    expect(await screen.findByText(/no availability data recorded/i)).toBeInTheDocument();
    unmount();

    // An approved booking with no venue match still renders nothing rather than crashing.
    loadVenueSearchContext.mockResolvedValue({ venues: [], bookings: [{ booking_id: "orphan", venue_id: "", status: "APPROVED", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T10:00:00.000Z" }], unavailability: [] });
    render(<VenueAvailabilityCalendar role="VENUE_STAFF" />);
    expect(await screen.findByText(/no venues are available to display/i)).toBeInTheDocument();
  });
});

describe("conflict", () => {
  test("TC-0870 E11 — bookings elsewhere or not approved never ask for confirmation", () => {
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={jest.fn()} bookings={[
      { ...approvedBooking, booking_id: "other-venue", venue_id: "VEN-002" },
      { ...approvedBooking, booking_id: "pending", status: "PENDING" }
    ]} />);
    fillPeriod();
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Pending save")).toBeInTheDocument();
  });
});

describe("failure", () => {
  test("TC-0723 E7 — missing times, missing reason and Other without a note are each refused", () => {
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={jest.fn()} />);
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/end date and time after the start/i);

    fillPeriod({ reason: "" });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a reason/i);

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Other" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter a note/i);
    expect(screen.queryByText("Pending save")).not.toBeInTheDocument();
  });

  test("TC-0724 E7 — a rejected save keeps the staged change and shows the error (with a fallback message)", async () => {
    const onSave = jest.fn().mockRejectedValueOnce(new Error("Not assigned to this venue.")).mockRejectedValueOnce({});
    render(<VenueUnavailabilityManager venue={venue} canEdit onSave={onSave} />);
    fillPeriod();
    userEvent.click(screen.getByRole("button", { name: /add period/i }));
    userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not assigned to this venue.");
    expect(screen.getByText("Pending save")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled());
    userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i));
  });

  test("TC-0655 E4 — a failed load shows the error, with a fallback message", async () => {
    loadVenueSearchContext.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    const { unmount } = render(<VenueAvailabilityCalendar role="ATTENDEE" />);
    expect(await screen.findByText("Missing or insufficient permissions.")).toBeInTheDocument();
    unmount();

    loadVenueSearchContext.mockRejectedValueOnce({});
    render(<VenueAvailabilityCalendar role="VENUE_STAFF" />);
    expect(await screen.findByText(/availability could not be loaded/i)).toBeInTheDocument();
  });

  test("TC-0656 E4 — a load that settles after unmount does not update the screen", async () => {
    let resolve;
    let reject;
    loadVenueSearchContext.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    render(<VenueAvailabilityCalendar role="VENUE_STAFF" />).unmount();
    resolve({ venues: [venue], bookings: [], unavailability: [] });

    loadVenueSearchContext.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej; }));
    render(<VenueAvailabilityCalendar role="VENUE_STAFF" />).unmount();
    reject(new Error("late"));
    await waitFor(() => expect(loadVenueSearchContext).toHaveBeenCalledTimes(2));
  });
});