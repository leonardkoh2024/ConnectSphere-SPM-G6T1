// E2 / E3 / E7 / E9 / E10 — the venue catalogue screen driven as the user would,
// with venuesApi mocked so each loading, empty, error and save outcome is controlled.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ROLES } from "../../domain/roles";
import VenueCatalogue from "./VenueCatalogue";
import { loadVenueSearchContext, saveVenueCatalogue, saveVenuePlanningDetails, saveVenueUnavailability } from "./venuesApi";

jest.mock("./venuesApi", () => ({
  loadVenueSearchContext: jest.fn(),
  saveVenueCatalogue: jest.fn(),
  saveVenuePlanningDetails: jest.fn(),
  saveVenueUnavailability: jest.fn()
}));

const hallA = {
  venue_id: "VEN-001", name: "Hall A", building: "Central Tower", location: "CENTRAL", max_capacity: 500,
  layouts: ["THEATRE"], facilities: ["WIFI"], accessibility: ["WHEELCHAIR_ACCESS"],
  operating_hours: [{ weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" }],
  setup_minutes: 30, turnaround_minutes: 15, special_space_availability: "",
  emergency_access_notes: "Exit via Door B", known_restrictions: "No open flames",
  is_assigned_to_user: true
};
const annex = {
  venue_id: "VEN-004", name: "Annex", building: "", location: "NORTH", max_capacity: 20,
  layouts: ["BOARDROOM"], facilities: [], accessibility: [], operating_hours: [], is_assigned_to_user: false
};
const staff = { uid: "staff-1" };

const context = (overrides = {}) => ({ venues: [hallA, annex], bookings: [], unavailability: [], ...overrides });
const row = (name) => [...document.querySelectorAll(".cs-record")].find((item) => item.querySelector("h2").textContent === name);
const openEditor = async () => {
  render(<VenueCatalogue user={staff} role={ROLES.VENUE_STAFF} />);
  await screen.findByText("Hall A");
  userEvent.click(within(row("Hall A")).getByRole("button", { name: /update venue/i }));
  return screen.getByRole("form", { name: /edit venue/i });
};
const save = () => userEvent.click(screen.getByRole("button", { name: /save venue/i }));

beforeEach(() => {
  loadVenueSearchContext.mockResolvedValue(context());
  saveVenueCatalogue.mockResolvedValue();
  saveVenuePlanningDetails.mockResolvedValue();
  saveVenueUnavailability.mockResolvedValue({ periods: [] });
});

describe("normal", () => {
  test("TC-0573 E2 — loading message first, then the list loaded for this user and role", async () => {
    render(<VenueCatalogue user={staff} role={ROLES.VENUE_STAFF} />);
    expect(screen.getByText(/loading venue catalogue/i)).toBeInTheDocument();
    expect(await screen.findByText("Hall A")).toBeInTheDocument();
    expect(loadVenueSearchContext).toHaveBeenCalledWith({ userId: "staff-1", role: ROLES.VENUE_STAFF });
  });

  test("TC-0598 E3/E9/E10 — the assigned staff member edits every field and the saved record shows the new values", async () => {
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText("Venue name"), { target: { value: "Hall A Renamed" } });
    fireEvent.change(within(form).getByLabelText("Building"), { target: { value: "North Wing" } });
    fireEvent.change(within(form).getByLabelText("Location"), { target: { value: "EAST" } });
    fireEvent.change(within(form).getByLabelText("Maximum capacity"), { target: { value: "550" } });
    fireEvent.change(within(form).getByLabelText(/setup time/i), { target: { value: "45" } });
    fireEvent.change(within(form).getByLabelText(/turnaround time/i), { target: { value: "20" } });
    userEvent.click(within(form).getByRole("checkbox", { name: "CLASSROOM" }));
    userEvent.click(within(form).getByRole("checkbox", { name: "STAGE" }));
    userEvent.click(within(form).getByRole("checkbox", { name: "LIFT" }));
    userEvent.click(within(form).getByRole("checkbox", { name: "TUESDAY" }));
    fireEvent.change(within(form).getByLabelText("TUESDAY opens"), { target: { value: "08:00" } });
    fireEvent.change(within(form).getByLabelText("MONDAY closes"), { target: { value: "20:00" } });
    userEvent.click(within(form).getByRole("checkbox", { name: "TUESDAY" }));
    userEvent.click(within(form).getByRole("checkbox", { name: "WEDNESDAY" }));
    fireEvent.change(within(form).getByLabelText(/space availability/i), { target: { value: "Quiet room" } });
    fireEvent.change(within(form).getByLabelText(/emergency access notes/i), { target: { value: "  Exit via loading bay  " } });
    fireEvent.change(within(form).getByLabelText(/known restrictions/i), { target: { value: " Max stage height 1.5m " } });
    save();

    await waitFor(() => expect(saveVenuePlanningDetails).toHaveBeenCalledWith({
      user: staff,
      venueId: "VEN-001",
      changes: { setup_minutes: 45, turnaround_minutes: 20, emergency_access_notes: "Exit via loading bay", known_restrictions: "Max stage height 1.5m" }
    }));
    expect(saveVenueCatalogue).toHaveBeenCalledWith(expect.objectContaining({
      name: "Hall A Renamed", building: "North Wing", location: "EAST", max_capacity: 550,
      layouts: ["THEATRE", "CLASSROOM"], facilities: ["WIFI", "STAGE"], accessibility: ["WHEELCHAIR_ACCESS", "LIFT"],
      operating_hours: [{ weekday: "MONDAY", opens_at: "09:00", closes_at: "20:00" }, { weekday: "WEDNESDAY", opens_at: "09:00", closes_at: "17:00" }],
      special_space_availability: "Quiet room"
    }));
    // E9 AC4 / E10 AC3 — the saved record replaces the editor and shows the values in use.
    const record = await screen.findByRole("region", { name: /venue record/i });
    expect(within(record).getByText("Setup time").closest("div")).toHaveTextContent("45 minutes");
    expect(within(record).getByText("Turnaround time").closest("div")).toHaveTextContent("20 minutes");
    expect(within(record).getByText("Exit via loading bay")).toBeInTheDocument();
    expect(within(record).getByText("Max stage height 1.5m")).toBeInTheDocument();
    expect(row("Hall A Renamed")).toBeTruthy();
    // Every field of a large form, queried by accessible name: over 5 s when the whole suite runs in parallel.
  }, 20000);

  test("TC-0834 E10 AC3 — a coordinator sees the safety information read-only", async () => {
    render(<VenueCatalogue user={{ uid: "coord-1" }} role={ROLES.COORDINATOR} />);
    await screen.findByText("Hall A");
    expect(screen.queryByRole("button", { name: /update venue/i })).not.toBeInTheDocument();
    userEvent.click(within(row("Hall A")).getByRole("button", { name: /view venue/i }));
    const record = screen.getByRole("region", { name: /venue record/i });
    expect(within(record).getByText("Exit via Door B")).toBeInTheDocument();
    expect(within(record).getByText("No open flames")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /edit venue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /record unavailability/i })).not.toBeInTheDocument();
  });

  test("TC-0731 E7 — saving unavailability replaces that venue's periods with what the service returns", async () => {
    loadVenueSearchContext.mockResolvedValue(context({
      bookings: [{ booking_id: "B-1", venue_id: "VEN-004", status: "APPROVED", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T10:00:00.000Z" }],
      unavailability: [
        { id: "old", venue_id: "VEN-001", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Old block" },
        { id: "other", venue_id: "VEN-004", start_datetime: "2026-10-12T09:00:00.000Z", end_datetime: "2026-10-12T12:00:00.000Z", reason: "Annex block" }
      ]
    }));
    saveVenueUnavailability.mockResolvedValue({ periods: [{ id: "new", venue_id: "VEN-001", start_datetime: "2026-10-13T09:00:00.000Z", end_datetime: "2026-10-13T12:00:00.000Z", reason: "Renovation" }] });
    render(<VenueCatalogue user={staff} role={ROLES.VENUE_STAFF} />);
    await screen.findByText("Hall A");
    userEvent.click(within(row("Hall A")).getByRole("button", { name: /update venue/i }));
    userEvent.click(screen.getByRole("button", { name: /stage release/i }));
    userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.queryByText("Old block")).not.toBeInTheDocument());
    expect(screen.getByText("Renovation", { selector: "p" })).toBeInTheDocument();
    expect(saveVenueUnavailability).toHaveBeenCalledWith({ user: staff, venueId: "VEN-001", keepPeriodIds: [], additions: [], confirmOverlaps: false });
    userEvent.click(within(row("Annex")).getByRole("button", { name: /view venue/i }));
    expect(screen.getByText("Annex block")).toBeInTheDocument();
  });

  test("TC-0574 E2 — View toggles closed, Update toggles closed, Cancel returns to the record", async () => {
    await openEditor();
    userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("form", { name: /edit venue/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /venue record/i })).toBeInTheDocument();

    userEvent.click(within(row("Annex")).getByRole("button", { name: /view venue/i }));
    expect(within(row("Annex")).getByRole("region", { name: /venue record/i })).toBeInTheDocument();
    userEvent.click(within(row("Annex")).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("region", { name: /venue record/i })).not.toBeInTheDocument();

    userEvent.click(within(row("Hall A")).getByRole("button", { name: /update venue/i }));
    expect(screen.getByRole("form", { name: /edit venue/i })).toBeInTheDocument();
    userEvent.click(within(row("Hall A")).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("form", { name: /edit venue/i })).not.toBeInTheDocument();
  });
});

describe("boundary", () => {
  test("TC-0825 E9 AC2 — setup and turnaround of 0 and a capacity of 1 are accepted", async () => {
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText("Maximum capacity"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText(/setup time/i), { target: { value: "0" } });
    fireEvent.change(within(form).getByLabelText(/turnaround time/i), { target: { value: "0" } });
    save();
    await waitFor(() => expect(saveVenuePlanningDetails).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({ setup_minutes: 0, turnaround_minutes: 0 })
    })));
    expect(saveVenueCatalogue).toHaveBeenCalledWith(expect.objectContaining({ max_capacity: 1 }));
  });

  test("TC-0826 E9 AC2 — a negative setup, a fractional turnaround and a blank capacity are refused before saving", async () => {
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText("Maximum capacity"), { target: { value: "" } });
    save();
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number greater than zero/i);

    fireEvent.change(within(form).getByLabelText("Maximum capacity"), { target: { value: "10" } });
    fireEvent.change(within(form).getByLabelText(/setup time/i), { target: { value: "-1" } });
    save();
    expect(screen.getByRole("alert")).toHaveTextContent(/setup time must be a whole number/i);

    fireEvent.change(within(form).getByLabelText(/setup time/i), { target: { value: "0" } });
    fireEvent.change(within(form).getByLabelText(/turnaround time/i), { target: { value: "1.5" } });
    save();
    expect(screen.getByRole("alert")).toHaveTextContent(/turnaround time must be a whole number/i);
    expect(saveVenueCatalogue).not.toHaveBeenCalled();
    expect(saveVenuePlanningDetails).not.toHaveBeenCalled();
  });

  test("TC-0575 E2 — an empty catalogue says nothing matches; one venue reads as singular; nameless venues sort first", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ venues: [] }));
    const { unmount } = render(<VenueCatalogue role={ROLES.COORDINATOR} />);
    expect(await screen.findByText("0 venues")).toBeInTheDocument();
    expect(screen.getByText(/no venues match/i)).toBeInTheDocument();
    unmount();

    loadVenueSearchContext.mockResolvedValue(context({ venues: [hallA, { ...annex, venue_id: "X", name: undefined }, annex] }));
    render(<VenueCatalogue role={ROLES.COORDINATOR} />);
    expect(await screen.findByText("3 venues")).toBeInTheDocument();
    expect([...document.querySelectorAll(".cs-record h2")].map((item) => item.textContent)).toEqual(["", "Annex", "Hall A"]);
  });

  test("TC-0599 E3 — an editor opened on a record with blank text fields starts empty and saves empty strings", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ venues: [{ ...hallA, name: undefined, building: undefined, location: undefined, emergency_access_notes: undefined, known_restrictions: undefined, setup_minutes: undefined, turnaround_minutes: undefined, max_capacity: undefined }] }));
    render(<VenueCatalogue user={staff} role={ROLES.VENUE_STAFF} />);
    userEvent.click(await screen.findByRole("button", { name: /update venue/i }));
    const form = screen.getByRole("form", { name: /edit venue/i });
    expect(within(form).getByLabelText(/setup time/i)).toHaveValue(0);
    expect(within(form).getByLabelText(/turnaround time/i)).toHaveValue(0);
    fireEvent.change(within(form).getByLabelText(/setup time/i), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText(/turnaround time/i), { target: { value: "2" } });
    expect(within(form).getByLabelText("Venue name")).toHaveValue("");
    expect(within(form).getByLabelText("Building")).toHaveValue("");
    expect(within(form).getByLabelText("Maximum capacity")).toHaveValue(null);
    fireEvent.change(within(form).getByLabelText("Maximum capacity"), { target: { value: "5" } });
    save();
    await waitFor(() => expect(saveVenuePlanningDetails).toHaveBeenCalledWith(expect.objectContaining({
      changes: { setup_minutes: 1, turnaround_minutes: 2, emergency_access_notes: "", known_restrictions: "" }
    })));
  });
});

describe("conflict", () => {
  test("TC-0600 E3 AC3 — Venue Staff not assigned to a venue can only view it", async () => {
    loadVenueSearchContext.mockResolvedValue(context({ venues: [{ ...hallA, is_assigned_to_user: false }, annex] }));
    render(<VenueCatalogue user={staff} role={ROLES.VENUE_STAFF} />);
    await screen.findByText("Hall A");
    expect(screen.queryByRole("button", { name: /update venue/i })).not.toBeInTheDocument();
    userEvent.click(within(row("Hall A")).getByRole("button", { name: /view venue/i }));
    expect(screen.queryByRole("form", { name: /edit venue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /record unavailability/i })).not.toBeInTheDocument();
  });

  test("TC-0601 E3 — a coordinator flagged as assigned still cannot edit (the role decides)", async () => {
    render(<VenueCatalogue user={{ uid: "coord-1" }} role={ROLES.COORDINATOR} />);
    await screen.findByText("Hall A");
    expect(screen.getAllByRole("button", { name: /view venue/i })).toHaveLength(2);
  });

  test("TC-0602 E3 — switching My venues closes an open editor and clears its error", async () => {
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText("Maximum capacity"), { target: { value: "0" } });
    save();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    userEvent.click(screen.getByRole("button", { name: /my venues/i }));
    expect(screen.queryByRole("form", { name: /edit venue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("1 venue")).toBeInTheDocument();
  });
});

describe("failure", () => {
  test("TC-0576 E2 — a load failure shows its message, or a fallback", async () => {
    loadVenueSearchContext.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    const { unmount } = render(<VenueCatalogue role={ROLES.ATTENDEE} />);
    expect(await screen.findByText("Missing or insufficient permissions.")).toBeInTheDocument();
    unmount();

    loadVenueSearchContext.mockRejectedValueOnce({});
    render(<VenueCatalogue role={ROLES.COORDINATOR} />);
    expect(await screen.findByText(/venue catalogue could not be loaded/i)).toBeInTheDocument();
  });

  test("TC-0603 E3 — a rejected save keeps the editor open with the error, or a fallback", async () => {
    saveVenueCatalogue.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    const form = await openEditor();
    save();
    expect(await within(form).findByRole("alert")).toHaveTextContent("Missing or insufficient permissions.");
    expect(saveVenuePlanningDetails).not.toHaveBeenCalled();

    saveVenuePlanningDetails.mockRejectedValueOnce({});
    await waitFor(() => expect(screen.getByRole("button", { name: /save venue/i })).toBeEnabled());
    save();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
    await waitFor(() => expect(within(form).getByRole("alert")).toHaveTextContent(/venue record could not be saved/i));
    expect(screen.getByRole("form", { name: /edit venue/i })).toBeInTheDocument();
  });

  test("TC-0577 E2 — a load that settles after unmount does not update the screen", async () => {
    let resolve;
    let reject;
    loadVenueSearchContext.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    render(<VenueCatalogue role={ROLES.COORDINATOR} />).unmount();
    resolve(context());
    loadVenueSearchContext.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej; }));
    render(<VenueCatalogue role={ROLES.COORDINATOR} />).unmount();
    reject(new Error("late"));
    await waitFor(() => expect(loadVenueSearchContext).toHaveBeenCalledTimes(2));
  });
});
