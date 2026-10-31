// F1 / F7 / F8 / F10 / F11 / F12 / F14 — the coordinator's venue booking list: loading, empty,
// error, every status and detail fallback, withdraw and release outcomes.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueBookings from "./VenueBookings";
import { loadVenueBookings, loadVenueCatalogue, prepareClashReplacement, releaseVenueBooking, withdrawVenueBooking } from "./venuesApi";
import { reviewApi } from "../events/reviewApi";

jest.mock("./venuesApi", () => ({
  loadVenueBookings: jest.fn(),
  loadVenueCatalogue: jest.fn(),
  prepareClashReplacement: jest.fn(),
  releaseVenueBooking: jest.fn(),
  withdrawVenueBooking: jest.fn()
}));
jest.mock("../events/reviewApi", () => ({ reviewApi: { list: jest.fn(), detail: jest.fn() } }));
jest.mock("./VenueBookingRequest", () => {
  const actual = jest.requireActual("./VenueBookingRequest");
  return {
    __esModule: true,
    ...actual,
    default: ({ venue, event, existingBooking, onSubmitted }) => (
      <section aria-label="Booking request stub">
        <p>Requesting {venue.name} for {event.name}</p>
        <p>{existingBooking ? `Existing ${existingBooking.booking_id}` : "No existing booking"}</p>
        <button type="button" onClick={onSubmitted}>Stub submit</button>
      </section>
    )
  };
});

const user = { uid: "coord-1" };
const booking = (id, changes = {}) => ({
  booking_id: id, event_id: "e1", venue_id: "VEN-1", event_name: "Q4 Partner Summit",
  status: "APPROVED", event_status: "PLANNING", event_date: "2026-11-20", start_time: "10:00", end_time: "12:00",
  expected_attendance: 80, ...changes
});
const rowOf = (text) => screen.getAllByRole("heading", { level: 2 }).find((item) => item.textContent === text).closest(".cs-record");
const open = (row) => userEvent.click(within(row).getByRole("button", { name: /view details/i }));
const detail = (row, term) => within(row).getByText(term, { selector: "dt" }).nextSibling;

beforeEach(() => {
  reviewApi.list.mockResolvedValue({ events: [{ id: "e2", name: "Fallback name", status: "PLANNING" }] });
  reviewApi.detail.mockResolvedValue({ event: { name: "Q4 Partner Summit", event_date: "2026-11-20" } });
  loadVenueCatalogue.mockResolvedValue([{ venue_id: "VEN-1", name: "Harbour Hall", max_capacity: 120 }]);
  loadVenueBookings.mockResolvedValue([booking("VB-1")]);
  withdrawVenueBooking.mockResolvedValue({});
  releaseVenueBooking.mockResolvedValue({});
});

describe("normal", () => {
  test("TC-0959 F7 — loading first, then each booking with its status and decision details", async () => {
    loadVenueBookings.mockResolvedValue([booking("VB-1", {
      status: "REJECTED", decided_at: "2026-10-03T09:30:00.000Z", requested_at: "2026-10-01T09:30:00.000Z",
      decision_reason: "Layout not supported", hold_expires_at: "2026-10-06T01:00:00.000Z",
      release_reason: "Moved online", replaced_by_booking_id: "VB-9", venue_staff_name: "Vera"
    })]);
    render(<VenueBookings user={user} />);
    expect(screen.getByText(/loading venue bookings/i)).toBeInTheDocument();
    const row = rowOf(await screen.findByText("Q4 Partner Summit").then((item) => item.textContent));
    expect(within(row).getByText("REJECTED")).toHaveClass("cs-pill-neutral");
    open(row);
    expect(detail(row, "Requested")).toHaveTextContent(new Date("2026-10-01T09:30:00.000Z").toLocaleString());
    expect(detail(row, "Decision time")).toHaveTextContent(new Date("2026-10-03T09:30:00.000Z").toLocaleString());
    expect(detail(row, "Decision reason")).toHaveTextContent("Layout not supported");
    expect(detail(row, "Hold expires")).toBeInTheDocument();
    expect(detail(row, "Release reason")).toHaveTextContent("Moved online");
    expect(detail(row, "Replacement booking")).toHaveTextContent("VB-9");
    expect(detail(row, "Venue capacity")).toHaveTextContent("120");
    expect(within(row).queryByRole("button", { name: /withdraw|release/i })).not.toBeInTheDocument();
    userEvent.click(within(row).getByRole("button", { name: /hide details/i }));
    expect(within(row).queryByText("Decision reason")).not.toBeInTheDocument();
  });

  test("TC-1076 F12 AC5 — every booking of an event is listed, each labelled with its venue", async () => {
    loadVenueBookings.mockResolvedValue([
      booking("VB-4", { venue_id: "VEN-2", booking_label: "Old room", status: "REPLACED" }),
      booking("VB-1", { booking_label: "Main hall" }),
      booking("VB-2", { venue_id: "VEN-2", booking_label: "Breakout", status: "PENDING" }),
      booking("VB-3", { venue_id: "VEN-GONE", status: undefined })
    ]);
    loadVenueCatalogue.mockResolvedValue([{ venue_id: "VEN-1", name: "Harbour Hall", max_capacity: 120 }, { venue_id: "VEN-2", name: "Studio", max_capacity: 30 }]);
    render(<VenueBookings user={user} />);
    await screen.findByText("Main hall · Harbour Hall");
    expect(screen.getByText("Breakout · Studio")).toBeInTheDocument();
    expect(screen.getByText("Venue not in the catalogue")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toHaveClass("cs-pill-info");
    const group = screen.getByRole("region", { name: "Q4 Partner Summit venue bookings" });
    expect(group).toHaveClass("cs-booking-event-group-multi");
    expect(group).toHaveTextContent("Multi-venue event");
    expect(within(group).getAllByRole("article").map((row) => row.id)).toEqual([
      "venue-booking-VB-1", "venue-booking-VB-2", "venue-booking-VB-3", "venue-booking-VB-4"
    ]);
  });

  test("TC-0881 F1 K5 — a pending request is withdrawn after confirming, and the list reloads", async () => {
    loadVenueBookings.mockResolvedValueOnce([booking("VB-2", { status: "PENDING" })]).mockResolvedValueOnce([booking("VB-2", { status: "WITHDRAWN" })]);
    render(<VenueBookings user={user} />);
    const row = rowOf((await screen.findByText("Q4 Partner Summit")).textContent);
    open(row);
    userEvent.click(within(row).getByRole("button", { name: /withdraw request/i }));
    const dialog = screen.getByRole("dialog", { name: /withdraw this request/i });
    expect(dialog).toHaveTextContent("Harbour Hall");
    userEvent.click(within(dialog).getByRole("button", { name: /yes, withdraw/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(withdrawVenueBooking).toHaveBeenCalledWith({ user, bookingId: "VB-2" });
    expect(screen.getByText("WITHDRAWN", { selector: ".cs-pill" })).toBeInTheDocument();
  });

  test("TC-0969 F8/F14 — an approved venue is released with a reason; the others are untouched", async () => {
    loadVenueBookings.mockResolvedValueOnce([booking("VB-1"), booking("VB-2", { venue_id: "VEN-2" })])
      .mockResolvedValueOnce([booking("VB-1", { status: "RELEASED" }), booking("VB-2", { venue_id: "VEN-2" })]);
    render(<VenueBookings user={user} />);
    await screen.findAllByText("Q4 Partner Summit");
    const row = document.getElementById("venue-booking-VB-1");
    open(row);
    userEvent.click(within(row).getByRole("button", { name: /release this venue/i }));
    const dialog = screen.getByRole("dialog", { name: /release this venue/i });
    expect(dialog).toHaveTextContent(/other venue bookings for this event will stay unchanged/i);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Moved online" } });
    userEvent.click(within(dialog).getByRole("button", { name: /release venue/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(releaseVenueBooking).toHaveBeenCalledWith({ user, bookingId: "VB-1", reason: "Moved online" });
    expect(screen.getByText("RELEASED", { selector: ".cs-pill" })).toBeInTheDocument();
    expect(screen.getAllByText("APPROVED", { selector: ".cs-pill" })).toHaveLength(1);
  });

  test("TC-1093 F14 a released record offers a prefilled independent venue search", async () => {
    const onFindReplacement = jest.fn();
    loadVenueBookings.mockResolvedValue([booking("VB-1", {
      status: "RELEASED", booking_label: "Breakout A", expected_attendance: 35,
      requested_layout_id: "CLASSROOM", required_facilities_snapshot: ["WIFI"]
    })]);
    reviewApi.detail.mockResolvedValue({ event: { id: "e1", name: "Q4 Partner Summit", status: "PLANNING", expected_attendance: 80 } });
    render(<VenueBookings user={user} onFindReplacement={onFindReplacement} />);

    await screen.findByText(/Breakout A/);
    const row = document.getElementById("venue-booking-VB-1");
    open(row);
    userEvent.click(within(row).getByRole("button", { name: /request another venue/i }));

    await waitFor(() => expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({
      event_id: "e1", expected_attendance: 35, required_layout: "CLASSROOM",
      facilities: ["WIFI"], excluded_venue_id: "VEN-1"
    })));
    expect(onFindReplacement.mock.calls[0][0]).not.toHaveProperty("replacement_for_booking_id");
  });

  test("TC-1094 F13 a rejected required room offers a linked replacement search", async () => {
    const onFindReplacement = jest.fn();
    let finishDetail;
    loadVenueBookings.mockResolvedValue([booking("VB-1", {
      status: "REJECTED", requires_re_request: true, booking_label: "Workshop",
      expected_attendance: 20, layout_snapshot: "U_SHAPE"
    })]);
    reviewApi.detail.mockReturnValue(new Promise((resolve) => { finishDetail = resolve; }));
    render(<VenueBookings user={user} onFindReplacement={onFindReplacement} />);

    await screen.findByText(/Workshop/);
    const row = document.getElementById("venue-booking-VB-1");
    open(row);
    userEvent.click(within(row).getByRole("button", { name: /request replacement venue/i }));
    expect(await within(row).findByRole("button", { name: /preparing replacement/i })).toBeDisabled();
    finishDetail({ event: { id: "e1", name: "Q4 Partner Summit", status: "PLANNING", expected_attendance: 80 } });

    await waitFor(() => expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({
      event_id: "e1", replacement_for_booking_id: "VB-1", excluded_venue_id: "VEN-1",
      expected_attendance: 20, required_layout: "U_SHAPE"
    })));
  });

  test("a rejected historical record without a re-request flag offers no replacement action", async () => {
    loadVenueBookings.mockResolvedValue([booking("VB-1", { status: "REJECTED", requires_re_request: false })]);
    render(<VenueBookings user={user} onFindReplacement={jest.fn()} />);

    await screen.findByText("REJECTED", { selector: ".cs-pill" });
    const row = document.getElementById("venue-booking-VB-1");
    open(row);
    expect(within(row).queryByRole("button", { name: /replacement venue/i })).not.toBeInTheDocument();
  });

  test("an older replacement-needed record without a status still offers its replacement action", async () => {
    loadVenueBookings.mockResolvedValue([booking("VB-1", { status: undefined, replacement_needed: true })]);
    render(<VenueBookings user={user} onFindReplacement={jest.fn()} />);

    await screen.findByText("Q4 Partner Summit");
    const row = document.getElementById("venue-booking-VB-1");
    open(row);
    expect(within(row).getByRole("button", { name: /find replacement venue/i })).toBeInTheDocument();
  });

  test.each([
    [new Error("That event could not be loaded."), "That event could not be loaded."],
    [{}, "Venue search details could not be loaded."]
  ])("a released record keeps the coordinator on the list when venue search preparation fails", async (failure, message) => {
    loadVenueBookings.mockResolvedValue([booking("VB-1", { status: "RELEASED" })]);
    reviewApi.detail.mockRejectedValue(failure);
    render(<VenueBookings user={user} onFindReplacement={jest.fn()} />);

    await screen.findByText("RELEASED", { selector: ".cs-pill" });
    const row = document.getElementById("venue-booking-VB-1");
    open(row);
    userEvent.click(within(row).getByRole("button", { name: /request another venue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(within(row).getByRole("button", { name: /request another venue/i })).toBeEnabled();
  });
});

describe("normal — raising a request", () => {
  const events = [
    { id: "e1", name: "Q4 Partner Summit", status: "APPROVED" },
    { id: "e2", reference_no: "EVT-2", status: "planning" },
    { id: "e3", status: "PLANNING" },
    { id: "e4", name: "Still draft", status: "DRAFT" }
  ];
  const venues = [
    { venue_id: "VEN-1", name: "Harbour Hall", max_capacity: 120, location: "CENTRAL", facilities: ["WIFI"], layouts: ["THEATRE"], accessibility: [] },
    { venue_id: "VEN-2", name: "Tiny Room", max_capacity: 10, location: "MARS" },
    { venue_id: "VEN-3", name: "No Wifi Room", max_capacity: 200 }
  ];
  beforeEach(() => {
    reviewApi.list.mockResolvedValue({ events });
    loadVenueCatalogue.mockResolvedValue(venues);
    reviewApi.detail.mockResolvedValue({ event: {
      name: "Q4 Partner Summit", event_date: "2026-11-20", start_time: "10:00", end_time: "12:00",
      expected_attendance: 80, preferred_location: "CENTRAL", required_layout: "THEATRE", facilities: ["WIFI"], accessibility: ["LIFT", "HEARING_LOOP"]
    } });
  });

  test("TC-0882 F1 — only Approved or Planning events are offered, and each venue is judged against the chosen event", async () => {
    loadVenueBookings.mockResolvedValueOnce([booking("VB-1", { status: "PENDING" })]).mockResolvedValue([booking("VB-1", { status: "PENDING" }), booking("VB-5")]);
    render(<VenueBookings user={user} />);
    userEvent.click(await screen.findByRole("button", { name: /new booking request/i }));
    expect(screen.getByText(/choose an event first/i)).toBeInTheDocument();
    const select = screen.getByLabelText("Event");
    expect([...select.options].map((option) => option.textContent)).toEqual(["Choose an event", "Q4 Partner Summit", "EVT-2", "e3"]);

    fireEvent.change(select, { target: { value: "e1" } });
    expect(screen.getByText(/loading the event's requirements/i)).toBeInTheDocument();
    const details = within(screen.getByRole("region", { name: "Event details" }));
    await waitFor(() => expect(details.getByText("Accessibility needs").nextSibling).toHaveTextContent("LIFT, HEARING LOOP"));
    expect(details.getByText("Time").nextSibling).toHaveTextContent("10:00–12:00");
    expect(details.getByText("Preferred location").nextSibling).toHaveTextContent(/^Central/);
    expect(reviewApi.detail).toHaveBeenCalledWith("e1");

    const card = (name) => document.querySelector(`label[aria-label="${name}"]`);
    const verdict = (name) => card(name).querySelector(".cs-venue-verdict").textContent;
    expect(verdict("Harbour Hall")).toBe("2 requirements not met");
    expect(verdict("Tiny Room")).toBe("5 requirements not met");
    expect(card("Tiny Room")).toHaveClass("cs-venue-card-blocked");
    expect(card("Harbour Hall")).toHaveClass("cs-venue-card-short");
    expect(card("Tiny Room")).toHaveTextContent("Holds 10 · MARS");
    expect(card("No Wifi Room")).toHaveTextContent("None listed");

    userEvent.click(document.getElementById("venue-VEN-1"));
    expect(card("Harbour Hall")).toHaveClass("cs-venue-card-chosen");
    expect(screen.getByText("Requesting Harbour Hall for Q4 Partner Summit")).toBeInTheDocument();
    expect(screen.getByText("Existing VB-1")).toBeInTheDocument();
    userEvent.click(screen.getByRole("button", { name: /stub submit/i }));
    await waitFor(() => expect(loadVenueBookings).toHaveBeenCalledTimes(2));

    userEvent.click(screen.getByRole("button", { name: /back to bookings/i }));
    expect(await screen.findByRole("button", { name: /new booking request/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2));
  });

  test("TC-0883 F1 — a venue that meets every requirement says so; clearing the event clears the verdicts", async () => {
    reviewApi.detail.mockResolvedValue({ event: { name: "Small", expected_attendance: 5 } });
    render(<VenueBookings user={user} />);
    userEvent.click(await screen.findByRole("button", { name: /new booking request/i }));
    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "e3" } });
    await waitFor(() => expect(screen.getAllByText("Meets all requirements")).toHaveLength(3));
    const details = screen.getByRole("region", { name: "Event details" });
    expect(within(details).getByText("Date").nextSibling).toHaveTextContent("Not set");
    expect(within(details).getByText("Time").nextSibling).toHaveTextContent("Not set");
    expect(within(details).getByText("Expected attendance").nextSibling).toHaveTextContent("5");
    expect(within(details).getByText("Preferred location").nextSibling).toHaveTextContent("No preference");
    expect(within(details).getByText("Required layout").nextSibling).toHaveTextContent("None stated");
    expect(within(details).getByText("Required facilities").nextSibling).toHaveTextContent("None stated");

    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "" } });
    expect(screen.getByText(/choose an event first/i)).toBeInTheDocument();
    expect(screen.queryByText("Meets all requirements")).not.toBeInTheDocument();
  });

  test("TC-1042 F11 — opened for a replacement, the screen starts in the form with the replacement context and hands Back to the header", async () => {
    const onBackChange = jest.fn();
    reviewApi.detail.mockResolvedValue({ event: { name: "Q4 Partner Summit", expected_attendance: 1 } });
    const { unmount } = render(<VenueBookings user={user} event={{ event_id: "e1", replacement_for_booking_id: "VB-OLD" }} venue={{ venue_id: "VEN-1" }} onBackChange={onBackChange} />);
    expect(await screen.findByText("Requesting Harbour Hall for Q4 Partner Summit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back to bookings/i })).not.toBeInTheDocument();
    const back = onBackChange.mock.calls.map(([fn]) => fn).find(Boolean);
    expect(typeof back).toBe("function");
    unmount();
    expect(onBackChange).toHaveBeenLastCalledWith(null);
  });

  test("TC-0884 F1 — hosted by the workspace, the header owns the New booking request action", async () => {
    const onCreatingChange = jest.fn();
    const { rerender } = render(<VenueBookings user={user} creating={false} onCreatingChange={onCreatingChange} />);
    await screen.findByText("Q4 Partner Summit");
    expect(screen.queryByRole("button", { name: /new booking request/i })).not.toBeInTheDocument();
    rerender(<VenueBookings user={user} creating onCreatingChange={onCreatingChange} />);
    userEvent.click(screen.getByRole("button", { name: /back to bookings/i }));
    await waitFor(() => expect(onCreatingChange).toHaveBeenCalledWith(false));
  });
});

describe("boundary", () => {
  test("TC-0960 F7 — with no booking yet the list says how to start one", async () => {
    loadVenueBookings.mockResolvedValue([]);
    render(<VenueBookings user={user} />);
    expect(await screen.findByText(/no booking requests raised yet/i)).toBeInTheDocument();
  });

  test("TC-0961 F7 — a booking with only datetimes, or nothing, falls back to readable defaults", async () => {
    loadVenueBookings.mockResolvedValue([
      booking("VB-1", { event_date: "", start_time: null, end_time: null, start_datetime: "2026-11-20T02:00:00.000Z", end_datetime: "2026-11-20T04:00:00.000Z", event_name: "", event_id: "e2" }),
      booking("VB-2", { event_date: "", start_time: null, end_time: null, event_name: "", event_id: "nope", expected_attendance: null, venue_id: "VEN-X" })
    ]);
    render(<VenueBookings user={user} />);
    const first = rowOf((await screen.findByText("Fallback name")).textContent);
    expect(first).toHaveTextContent(new Date("2026-11-20T02:00:00.000Z").toLocaleDateString());
    expect(within(first).getByText(/ · \d/)).toBeInTheDocument();
    const second = rowOf("Untitled event");
    expect(second).toHaveTextContent("Date not set · Not set");
    open(second);
    expect(detail(second, "Expected attendance")).toHaveTextContent("Not set");
    expect(detail(second, "Venue capacity")).toHaveTextContent("Unknown");
    expect(detail(second, "Requested")).toHaveTextContent("Not recorded");
    expect(detail(second, "Decision time")).toHaveTextContent("Not decided");
  });
});

describe("conflict", () => {
  test("TC-1016 F10 — a clash names the other event whichever side this booking is on; missing overlap times say so", async () => {
    loadVenueBookings.mockResolvedValue([booking("VB-1", { clashes: [
      { conflict_id: "C1", booking_a_id: "VB-OTHER", event_a_name: "Partner Briefing", booking_b_id: "VB-1", event_b_name: "Q4 Partner Summit" },
      { conflict_id: "C2", booking_a_id: "VB-1", event_a_name: "Q4 Partner Summit", booking_b_id: "VB-3", event_b_name: "Gala",
        overlap_start: "2026-11-20T03:00:00.000Z", overlap_end: "2026-11-20T04:00:00.000Z" }
    ] })]);
    render(<VenueBookings user={user} />);
    const row = rowOf((await screen.findByText("Q4 Partner Summit")).textContent);
    expect(row).toHaveClass("cs-venue-booking-record");
    const flag = within(row).getByRole("status");
    expect(flag).toHaveTextContent("Overlaps Partner Briefing: Time not recorded to Time not recorded");
    expect(flag).toHaveTextContent("Overlaps Gala");
    // Without a replacement handler there is nothing to act on.
    open(row);
    expect(screen.queryByRole("button", { name: /find alternative venue/i })).not.toBeInTheDocument();
  });

  test("TC-1043 F11 — a booking flagged for replacement offers Find replacement venue without re-preparing the clash", async () => {
    const onFindReplacement = jest.fn();
    const onViewEvent = jest.fn();
    loadVenueBookings.mockResolvedValue([booking("VB-1", {
      replacement_needed: true,
      replacement_reason: "Auditorium electrical maintenance",
      clashes: [{ conflict_id: "C1", booking_a_id: "VB-1", event_b_name: "Gala" }]
    })]);
    render(<VenueBookings user={user} onFindReplacement={onFindReplacement} onViewEvent={onViewEvent} />);
    const row = rowOf((await screen.findByText("Q4 Partner Summit")).textContent);
    expect(row).toHaveClass("cs-venue-booking-record-replacement");
    expect(within(row).getByLabelText("Replacement needed")).toHaveTextContent("Auditorium electrical maintenance");
    open(row);
    expect(screen.queryByRole("button", { name: /find alternative venue/i })).not.toBeInTheDocument();
    userEvent.click(screen.getByRole("button", { name: /view event request/i }));
    expect(onViewEvent).toHaveBeenCalledWith("e1");
    userEvent.click(screen.getByRole("button", { name: /find replacement venue/i }));
    await waitFor(() => expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({ event_id: "e1" })));
    expect(prepareClashReplacement).not.toHaveBeenCalled();
  });

  test("TC-0970 F8 — release is offered only while the event is Approved, Planning, Safety Review or Confirmed", async () => {
    loadVenueBookings.mockResolvedValue([
      booking("VB-1", { event_status: "SAFETY_REVIEW", event_name: "In safety review" }),
      booking("VB-2", { event_status: "COMPLETED", event_name: "Completed one" }),
      booking("VB-3", { event_status: undefined, event_name: "No status" })
    ]);
    render(<VenueBookings user={user} />);
    await screen.findByText("In safety review");
    const offered = (name) => {
      open(rowOf(name));
      return Boolean(within(rowOf(name)).queryByRole("button", { name: /release this venue/i }));
    };
    expect(offered("In safety review")).toBe(true);
    expect(offered("Completed one")).toBe(false);
    expect(offered("No status")).toBe(false);
  });

  test("TC-0885 F1/F8 — Keep request, Keep venue and a click on the backdrop all close the dialogs without acting", async () => {
    loadVenueBookings.mockResolvedValue([booking("VB-1"), booking("VB-2", { status: "PENDING", event_name: "Pending one" })]);
    render(<VenueBookings user={user} />);
    await screen.findByText("Pending one");
    open(rowOf("Pending one"));
    for (const close of ["Keep request", "backdrop"]) {
      userEvent.click(screen.getByRole("button", { name: /withdraw request/i }));
      if (close === "backdrop") {
        fireEvent.mouseDown(screen.getByRole("dialog"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.mouseDown(document.querySelector(".cs-modal-backdrop"));
      } else userEvent.click(screen.getByRole("button", { name: close }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    open(rowOf("Q4 Partner Summit"));
    for (const close of ["Keep venue", "backdrop"]) {
      userEvent.click(screen.getByRole("button", { name: /release this venue/i }));
      if (close === "backdrop") {
        fireEvent.mouseDown(screen.getByRole("dialog"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.mouseDown(document.querySelector(".cs-modal-backdrop"));
      } else userEvent.click(screen.getByRole("button", { name: close }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(withdrawVenueBooking).not.toHaveBeenCalled();
    expect(releaseVenueBooking).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  test("TC-0962 F7 — a failed load shows its message, or a fallback", async () => {
    loadVenueBookings.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    const { unmount } = render(<VenueBookings user={user} />);
    expect(await screen.findByText("Missing or insufficient permissions.")).toBeInTheDocument();
    unmount();
    reviewApi.list.mockRejectedValueOnce({});
    render(<VenueBookings user={user} />);
    expect(await screen.findByText("Venue bookings could not be loaded.")).toBeInTheDocument();
  });

  test("TC-0886 F1 — an event whose details cannot be read shows the error, or a fallback", async () => {
    reviewApi.list.mockResolvedValue({ events: [{ id: "e1", name: "Q4", status: "APPROVED" }] });
    reviewApi.detail.mockRejectedValueOnce(new Error("You are not assigned to this event."));
    const { unmount } = render(<VenueBookings user={user} event={{ id: "e1" }} />);
    expect(await screen.findByText("You are not assigned to this event.")).toBeInTheDocument();
    unmount();
    reviewApi.detail.mockRejectedValueOnce({});
    render(<VenueBookings user={user} event={{ id: "e1" }} />);
    expect(await screen.findByText("That event could not be loaded.")).toBeInTheDocument();
  });

  test("TC-0887 F1 — a refused withdrawal without a message falls back to a generic one", async () => {
    withdrawVenueBooking.mockRejectedValueOnce({});
    loadVenueBookings.mockResolvedValue([booking("VB-2", { status: "PENDING" })]);
    render(<VenueBookings user={user} />);
    open(rowOf((await screen.findByText("Q4 Partner Summit")).textContent));
    userEvent.click(screen.getByRole("button", { name: /withdraw request/i }));
    userEvent.click(screen.getByRole("button", { name: /yes, withdraw/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That request could not be withdrawn.");
  });

  test("TC-0971 F8 — a release needs a reason, and a refused release shows the error or a fallback", async () => {
    releaseVenueBooking.mockRejectedValueOnce(new Error("Only the assigned coordinator may release this venue.")).mockRejectedValueOnce({});
    render(<VenueBookings user={user} />);
    open(rowOf((await screen.findByText("Q4 Partner Summit")).textContent));
    userEvent.click(screen.getByRole("button", { name: /release this venue/i }));
    const dialog = screen.getByRole("dialog");
    userEvent.click(within(dialog).getByRole("button", { name: /release venue/i }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A release reason is required.");
    expect(releaseVenueBooking).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Moved online" } });
    userEvent.click(within(dialog).getByRole("button", { name: /release venue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the assigned coordinator may release this venue.");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /release venue/i })).toBeEnabled());
    userEvent.click(within(dialog).getByRole("button", { name: /release venue/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That venue could not be released."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("TC-1017 F10 — preparing an alternative that fails shows the error, or a fallback", async () => {
    const clash = { conflict_id: "C1", booking_a_id: "VB-1", event_b_name: "Gala" };
    loadVenueBookings.mockResolvedValue([booking("VB-1", { clashes: [clash] })]);
    prepareClashReplacement.mockRejectedValueOnce(new Error("The clash has already been resolved.")).mockResolvedValueOnce(null);
    reviewApi.detail.mockRejectedValueOnce({});
    render(<VenueBookings user={user} onFindReplacement={jest.fn()} />);
    open(rowOf((await screen.findByText("Q4 Partner Summit")).textContent));
    userEvent.click(screen.getByRole("button", { name: /find alternative venue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The clash has already been resolved.");
    await waitFor(() => expect(screen.getByRole("button", { name: /find alternative venue/i })).toBeEnabled());
    userEvent.click(screen.getByRole("button", { name: /find alternative venue/i }));
    expect(screen.getByRole("button", { name: /preparing replacement/i })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Replacement details could not be loaded."));
  });

  test("TC-0963 F7 — loads that settle after unmount change nothing", async () => {
    let resolveList;
    let rejectDetail;
    reviewApi.list.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));
    render(<VenueBookings user={user} />).unmount();
    resolveList({ events: [] });
    reviewApi.detail.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDetail = reject; }));
    render(<VenueBookings user={user} event={{ id: "e1" }} />).unmount();
    rejectDetail(new Error("late"));
    let resolveDetail;
    reviewApi.detail.mockReturnValueOnce(new Promise((resolve) => { resolveDetail = resolve; }));
    loadVenueBookings.mockReturnValueOnce(Promise.reject(new Error("late too")));
    render(<VenueBookings user={user} event={{ id: "e1" }} />).unmount();
    resolveDetail({ event: {} });
    await waitFor(() => expect(reviewApi.detail).toHaveBeenCalledTimes(2));
  });
});

describe("boundary — sparse data", () => {
  test("TC-0964 F7 — no event list, a booking with no status, and the header told there is no Back on the list", async () => {
    const onBackChange = jest.fn();
    reviewApi.list.mockResolvedValue({});
    loadVenueBookings.mockResolvedValue([booking("VB-1", { status: undefined, event_name: "", clashes: [{ conflict_id: "C1", booking_a_id: "VB-1", event_b_name: "Gala" }] })]);
    render(<VenueBookings user={user} onBackChange={onBackChange} onFindReplacement={jest.fn()} />);
    const row = rowOf((await screen.findByText("Untitled event")).textContent);
    open(row);
    expect(within(row).queryByRole("button", { name: /withdraw|release|find/i })).not.toBeInTheDocument();
    expect(onBackChange).toHaveBeenCalledWith(null);
  });

  test("TC-0888 F1 — exactly one unmet requirement reads singular; an event with no status or attendance is handled", async () => {
    reviewApi.list.mockResolvedValue({ events: [{ id: "e1", name: "Q4", status: "APPROVED" }, { id: "e9", name: "No status" }] });
    reviewApi.detail.mockResolvedValue({ event: { name: "Q4", required_layout: "BANQUET" } });
    render(<VenueBookings user={user} />);
    userEvent.click(await screen.findByRole("button", { name: /new booking request/i }));
    expect(screen.queryByRole("option", { name: "No status" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "e1" } });
    expect(await screen.findByText("1 requirement not met")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Event details" })).getByText("Expected attendance").nextSibling).toHaveTextContent("Not set");
  });
});
