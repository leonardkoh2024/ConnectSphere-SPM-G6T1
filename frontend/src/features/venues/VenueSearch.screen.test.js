// E5 / E6 / E7 / F1 / F11 — the coordinator's venue search screen with venuesApi mocked:
// loading, error, every filter chip, the zero-match reasons, conflicts and booking a venue.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueSearch from "./VenueSearch";
import { loadVenueSearchContext } from "./venuesApi";

jest.mock("./venuesApi", () => ({ loadVenueSearchContext: jest.fn() }));

const hall = { venue_id: "VEN-1", name: "Hall A", location: "CENTRAL", max_capacity: 200, facilities: ["WIFI"], accessibility: ["LIFT"], layouts: ["THEATRE"], operating_hours: [] };
const room = { venue_id: "VEN-2", name: "Room B", location: "EAST", max_capacity: 20, facilities: [], accessibility: [], layouts: [], operating_hours: [] };
const context = (overrides = {}) => ({ venues: [hall, room], bookings: [], unavailability: [], ...overrides });
const names = () => [...document.querySelectorAll(".cs-record-title h2")].map((item) => item.textContent);
const chips = () => [...document.querySelectorAll(".cs-chip")].map((item) => item.textContent);
const event = { id: "e1", name: "Summit", event_date: "2026-11-20", start_time: "10:00", end_time: "12:00", expected_attendance: 50 };

beforeEach(() => {
  loadVenueSearchContext.mockResolvedValue(context());
});

describe("normal", () => {
  test("TC-0707 E6 AC1/AC3 — loading first; every filter shows its chip and narrows the list", async () => {
    render(<VenueSearch />);
    expect(screen.getByText(/loading venues/i)).toBeInTheDocument();
    await screen.findByText("Hall A");
    expect(screen.getByText("2 venues")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "50" } });
    expect(chips()).toEqual(["Up to 50 pax"]);
    expect(names()).toEqual(["Room B"]);
    expect(screen.getByText("1 venue")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Minimum capacity"), { target: { value: "10" } });
    expect(chips()).toEqual(["10–50 pax"]);
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Minimum capacity"), { target: { value: "100" } });
    expect(chips()).toEqual(["100+ pax"]);
    fireEvent.change(screen.getByLabelText("Minimum capacity"), { target: { value: "" } });

    userEvent.selectOptions(screen.getByLabelText("Supported layout"), "THEATRE");
    userEvent.click(screen.getByRole("checkbox", { name: "POWER POINTS" }));
    userEvent.click(screen.getByRole("checkbox", { name: "STEP FREE ACCESS" }));
    expect(chips()).toEqual(["POWER POINTS", "STEP FREE ACCESS", "THEATRE"]);
    expect(screen.getByText("0 venues")).toBeInTheDocument();
    expect(screen.getByText(/no venues match the current criteria/i)).toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText("Supported layout"), "");
    expect(chips()).toEqual(["POWER POINTS", "STEP FREE ACCESS"]);
  });

  test("TC-0900 F1 — Book venue from an event hands both choices on", async () => {
    const onBookVenue = jest.fn();
    render(<VenueSearch event={event} onBookVenue={onBookVenue} />);
    await screen.findByText("Hall A");
    userEvent.click(screen.getByRole("button", { name: /book venue/i }));
    expect(onBookVenue).toHaveBeenCalledWith(event, expect.objectContaining({ venue_id: "VEN-1" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("TC-0584 E2 — a selected venue shows its record and its blocked periods; selecting again closes it", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ unavailability: [
      { id: "u1", venue_id: "VEN-1", reason: "Renovation", start_datetime: "2026-12-01T01:00:00.000Z", end_datetime: "2026-12-01T03:00:00.000Z" },
      { id: "u2", venue_id: "VEN-2", reason: "Other room", start_datetime: "2026-12-01T01:00:00.000Z", end_datetime: "2026-12-01T03:00:00.000Z" }
    ] }));
    render(<VenueSearch />);
    await screen.findByText("Hall A");
    const row = screen.getByText("Hall A", { selector: "h2" }).closest(".cs-record");
    userEvent.click(within(row).getByRole("button", { name: /view venue/i }));
    expect(within(row).getByText("Renovation")).toBeInTheDocument();
    expect(screen.queryByText("Other room")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /record unavailability/i })).not.toBeInTheDocument();
    userEvent.click(within(row).getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Renovation")).not.toBeInTheDocument();
  });
});

describe("boundary", () => {
  test("TC-0692 E5 AC4 — zero matches for the event names how many were occupied and how many too small", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ bookings: [
      { booking_id: "B1", venue_id: "VEN-1", status: "APPROVED", start_datetime: "2026-11-20T10:00", end_datetime: "2026-11-20T11:00" },
      { booking_id: "B2", venue_id: "VEN-2", status: "APPROVED", start_datetime: "2026-11-20T11:00", end_datetime: "2026-11-20T13:00" }
    ] }));
    render(<VenueSearch event={{ ...event, expected_attendance: undefined }} />);
    const reasons = await screen.findByRole("status");
    expect(reasons).toHaveTextContent("Zero venues match this event.");
    expect(reasons).toHaveTextContent("Occupied for the requested window: 2 excluded");
    expect(reasons).toHaveTextContent("Capacity below expected attendance: 0 excluded");
  });

  test("TC-0693 E5 AC2 — a booking that ends exactly when the window starts leaves the venue in the list", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ bookings: [
      { booking_id: "B1", venue_id: "VEN-1", status: "APPROVED", start_datetime: "2026-11-20T08:00", end_datetime: "2026-11-20T10:00" }
    ] }));
    render(<VenueSearch event={event} />);
    await screen.findByText("Hall A");
    expect(names()).toEqual(["Hall A"]);
  });

  test("TC-0694 E5 AC3 — capacity exactly equal to the attendance is a fit; one more is not", async () => {
    render(<VenueSearch event={{ ...event, expected_attendance: 20 }} />);
    await screen.findByText("Room B");
    expect(names()).toEqual(["Hall A", "Room B"]);
    fireEvent.change(screen.getByLabelText("Minimum capacity"), { target: { value: "21" } });
    expect(names()).toEqual(["Hall A"]);
  });
});

describe("conflict", () => {
  test("TC-0901 F1 AC4 — a venue the event already has a live request for is refused with a notice", async () => {
    const onBookVenue = jest.fn();
    loadVenueSearchContext.mockResolvedValue(context({ bookings: [{ booking_id: "B1", event_id: "e1", venue_id: "VEN-1", status: "PENDING" }] }));
    render(<VenueSearch event={event} onBookVenue={onBookVenue} />);
    await screen.findByText("Hall A");
    userEvent.click(screen.getByRole("button", { name: /book venue/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Hall A already has a pending request for this event.");
    expect(onBookVenue).not.toHaveBeenCalled();
  });

  test("TC-1050 F11 — a replacement search leaves out the original venue and says so", async () => {
    render(<VenueSearch event={{ ...event, event_id: "e1", id: undefined, expected_attendance: 1, excluded_venue_id: "VEN-1" }} onBookVenue={jest.fn()} />);
    await screen.findByText("Room B");
    expect(screen.getByText(/unavailable original venue is excluded/i)).toBeInTheDocument();
    expect(names()).toEqual(["Room B"]);
  });
});

describe("failure", () => {
  test("TC-0695 E5 — a failed load shows its message, or a fallback; a late load after unmount changes nothing", async () => {
    loadVenueSearchContext.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    const first = render(<VenueSearch />);
    expect(await screen.findByText("Missing or insufficient permissions.")).toBeInTheDocument();
    first.unmount();
    loadVenueSearchContext.mockRejectedValueOnce({});
    const second = render(<VenueSearch />);
    expect(await screen.findByText("The venue catalogue could not be loaded.")).toBeInTheDocument();
    second.unmount();

    let resolve;
    let reject;
    loadVenueSearchContext.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    render(<VenueSearch />).unmount();
    resolve(context());
    loadVenueSearchContext.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej; }));
    render(<VenueSearch />).unmount();
    reject(new Error("late"));
    await waitFor(() => expect(loadVenueSearchContext).toHaveBeenCalledTimes(4));
  });
});

describe("boundary — sparse records", () => {
  test("TC-0696 E5/E6 — nameless venues and venues without stated hours are kept and sorted first; Any location clears the chip", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ venues: [hall, { ...room, name: undefined, operating_hours: undefined }, { ...room, venue_id: "VEN-3", name: undefined }] }));
    const onBookVenue = jest.fn();
    render(<VenueSearch event={{ ...event, id: undefined, event_id: "e7", expected_attendance: 1 }} onBookVenue={onBookVenue} />);
    await screen.findByText("Hall A");
    expect(names()).toEqual(["", "", "Hall A"]);
    userEvent.selectOptions(screen.getByLabelText(/^location$/i), "EAST");
    expect(chips()).toContain("EAST");
    userEvent.selectOptions(screen.getByLabelText(/^location$/i), "");
    expect(chips()).not.toContain("EAST");
    userEvent.click(within(screen.getByText("Hall A", { selector: "h2" }).closest(".cs-record")).getByRole("button", { name: /book venue/i }));
    expect(onBookVenue).toHaveBeenCalledWith(expect.objectContaining({ event_id: "e7" }), expect.objectContaining({ venue_id: "VEN-1" }));
  });
});
