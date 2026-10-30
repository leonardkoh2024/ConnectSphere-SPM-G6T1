// G2 / G3 / G5 — Technical Support's Equipment catalogue and Reservations
// screens. TC-408 and TC-409 in docs/test-cases.md.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EquipmentCatalogueScreen from "./EquipmentCatalogueScreen";
import EquipmentReservationsScreen from "./EquipmentReservationsScreen";
import {
  amendEquipmentReservation,
  keepEquipmentReservation,
  loadEquipmentCatalogue,
  recheckEquipmentReassessment,
  releaseEquipmentReservation
} from "./equipmentApi";

jest.mock("./equipmentApi", () => ({
  loadEquipmentCatalogue: jest.fn(),
  recheckEquipmentReassessment: jest.fn(),
  keepEquipmentReservation: jest.fn(),
  amendEquipmentReservation: jest.fn(),
  releaseEquipmentReservation: jest.fn()
}));

const NOW = new Date("2026-11-04T03:00:00.000Z");
const reservation = (overrides) => ({
  id: "r", event_id: "event-1", equipment_type: "AUDIO", quantity: 2, status: "RESERVED",
  start_datetime: "2026-11-04T01:00:00.000Z", end_datetime: "2026-11-04T09:00:00.000Z",
  reserved_by: "tech-1", event_name: "Partner Summit", reference_no: "EVT-001", event_date: "2026-11-04",
  released_at: null, release_reason: null,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  loadEquipmentCatalogue.mockResolvedValue({
    userId: "tech-1",
    inventory: [{ equipment_type: "AUDIO", total_quantity: 10 }, { equipment_type: "VISUAL", total_quantity: 2 }],
    unavailability: [{ equipment_type: "AUDIO", quantity: 1, status: "UNAVAILABLE", start_datetime: "2026-11-04T00:00:00.000Z", end_datetime: "2026-11-05T00:00:00.000Z" }],
    reservations: [
      reservation({ id: "now" }),
      reservation({ id: "visual", equipment_type: "VISUAL", quantity: 2 }),
      reservation({
        id: "later", event_id: "event-2", event_name: "Gala Dinner", reference_no: "EVT-002", event_date: "2026-11-10",
        reserved_by: "tech-2", quantity: 5,
        start_datetime: "2026-11-10T10:00:00.000Z", end_datetime: "2026-11-10T15:00:00.000Z"
      }),
      reservation({
        id: "released", event_id: "event-3", event_name: "Town Hall", reference_no: "EVT-003", event_date: "2026-10-20",
        status: "RELEASED", release_reason: "Event cancelled", released_at: "2026-10-18T02:00:00.000Z",
        start_datetime: "2026-10-20T01:00:00.000Z", end_datetime: "2026-10-20T05:00:00.000Z"
      }),
      reservation({
        id: "orphan", event_id: "event-gone", event_name: null, reference_no: null, event_date: null, reserved_by: "tech-2",
        start_datetime: "2026-10-01T01:00:00.000Z", end_datetime: "2026-10-01T05:00:00.000Z"
      })
    ]
  });
});

test("TC-408 the Equipment catalogue shows each type's stock, what is reserved and free now, and what is coming up", async () => {
  render(<EquipmentCatalogueScreen now={NOW} />);

  const audio = await screen.findByRole("article", { name: "AUDIO" });
  expect(within(audio).getByText("Held: 10")).toBeInTheDocument();
  expect(within(audio).getByText("7 free now")).toBeInTheDocument();
  expect(within(audio).getByText("Reserved now: 2 · Unavailable now: 1 · Upcoming reservations: 1")).toBeInTheDocument();

  // Nothing free is flagged, and a type with no stock recorded says so.
  const visual = screen.getByRole("article", { name: "VISUAL" });
  expect(within(visual).getByText("None free now")).toHaveClass("cs-pill-warning");
  const staging = screen.getByRole("article", { name: "STAGING" });
  expect(within(staging).getByText("Held: Not recorded")).toBeInTheDocument();
  expect(within(staging).getByText("Stock not recorded")).toBeInTheDocument();
  expect(loadEquipmentCatalogue).toHaveBeenCalledTimes(1);
});

test("TC-408 a catalogue that cannot be loaded says why", async () => {
  loadEquipmentCatalogue.mockRejectedValue(new Error("The equipment service is not responding."));
  render(<EquipmentCatalogueScreen now={NOW} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The equipment service is not responding.");
});

test("TC-409 Reservations lists current ones soonest first and past ones with why they were released, and can show only mine", async () => {
  render(<EquipmentReservationsScreen now={NOW} />);

  const current = await screen.findByRole("region", { name: "Current reservations" });
  const currentCards = within(current).getAllByRole("article");
  expect(currentCards.map((card) => card.getAttribute("aria-label"))).toEqual([
    "Partner Summit · AUDIO", "Partner Summit · VISUAL", "Gala Dinner · AUDIO"
  ]);
  expect(within(currentCards[0]).getByText("In use")).toBeInTheDocument();
  expect(within(currentCards[0]).getByText("EVT-001")).toBeInTheDocument();
  expect(within(currentCards[0]).getByText("Reserved by you")).toBeInTheDocument();
  expect(within(currentCards[2]).getByText("Upcoming")).toBeInTheDocument();
  expect(within(currentCards[2]).getByText("Reserved by another Technical Support staff member")).toBeInTheDocument();
  expect(within(currentCards[2]).getByText(/AUDIO · 5/)).toBeInTheDocument();

  const past = screen.getByRole("region", { name: "Past reservations" });
  const pastCards = within(past).getAllByRole("article");
  expect(pastCards.map((card) => card.getAttribute("aria-label"))).toEqual([
    "Town Hall · AUDIO", "Event event-gone · AUDIO"
  ]);
  expect(within(pastCards[0]).getByText("Released")).toBeInTheDocument();
  expect(within(pastCards[0]).getByText("Release reason: Event cancelled")).toBeInTheDocument();
  expect(within(pastCards[1]).getByText("Completed")).toBeInTheDocument();

  userEvent.click(screen.getByRole("checkbox", { name: "Only reservations I made" }));
  expect(within(screen.getByRole("region", { name: "Current reservations" })).getAllByRole("article")).toHaveLength(2);
  expect(within(screen.getByRole("region", { name: "Past reservations" })).getAllByRole("article")).toHaveLength(1);
});

test("G5-TC6 AC3 a released reservation shows when it was released as well as why, and an active one shows no release time", async () => {
  render(<EquipmentReservationsScreen now={NOW} />);

  const released = await screen.findByRole("article", { name: "Town Hall · AUDIO" });
  const releasedAt = new Date("2026-10-18T02:00:00.000Z").toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
  expect(within(released).getByText("Release reason: Event cancelled")).toBeInTheDocument();
  expect(within(released).getByText(`Release time: ${releasedAt}`)).toBeInTheDocument();

  expect(within(screen.getByRole("article", { name: "Partner Summit · AUDIO" })).queryByText(/Release time/)).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Event event-gone · AUDIO" })).queryByText(/Release time/)).not.toBeInTheDocument();
});

test("G5-TC7 AC3 a released reservation with no recorded release time says so", async () => {
  loadEquipmentCatalogue.mockResolvedValue({
    userId: "tech-1", inventory: [], unavailability: [],
    reservations: [reservation({ id: "no-time", status: "RELEASED", release_reason: "Event cancelled", released_at: null })]
  });
  render(<EquipmentReservationsScreen now={NOW} />);

  const card = await screen.findByRole("article", { name: "Partner Summit · AUDIO" });
  expect(within(card).getByText("Release reason: Event cancelled")).toBeInTheDocument();
  expect(within(card).getByText("Release time: Not recorded")).toBeInTheDocument();
});

test("TC-409 a reservation missing its reference, release reason or dates says so, and type names read as words", async () => {
  loadEquipmentCatalogue.mockResolvedValue({
    userId: "tech-1", inventory: [], unavailability: [],
    reservations: [reservation({
      id: "bare", equipment_type: "SOUND_DESK", reference_no: null, status: "RELEASED", release_reason: null,
      start_datetime: "not a date", end_datetime: null
    })]
  });
  render(<EquipmentReservationsScreen now={NOW} />);

  const card = await screen.findByRole("article", { name: "Partner Summit · SOUND_DESK" });
  expect(within(card).getByText("No reference")).toBeInTheDocument();
  expect(within(card).getByText("Release reason: Not recorded")).toBeInTheDocument();
  expect(within(card).getByText("Not recorded – Not recorded")).toBeInTheDocument();
  expect(within(card).getByText("SOUND DESK · 2")).toBeInTheDocument();
});

test("TC-409 with no reservations, each list says so", async () => {
  loadEquipmentCatalogue.mockResolvedValue({ userId: "tech-1", inventory: [], unavailability: [], reservations: [] });
  render(<EquipmentReservationsScreen now={NOW} />);
  expect(await screen.findByText("No current reservations.")).toBeInTheDocument();
  expect(screen.getByText("No past reservations.")).toBeInTheDocument();
});

// G6 / SCRUM-138 — a reservation I3 flagged is shown to Technical Support on its own, with the
// reason, and they can re-check it against the new window and keep, amend or release it.
describe("G6 reservations that wait for reassessment", () => {
  const flagged = (overrides) => reservation({
    id: "flag-1", rerequest_required: true, rerequest_reason: "Event date changed", ...overrides
  });
  const catalogue = (reservations) => ({
    userId: "tech-1",
    inventory: [{ equipment_type: "AUDIO", total_quantity: 8 }],
    unavailability: [],
    reservations
  });
  const recheckResult = (line) => ({
    windowStart: "2026-11-12T00:30:00.000Z",
    windowEnd: "2026-11-12T10:00:00.000Z",
    lines: [{ reservationId: "flag-1", lineIndex: 0, equipmentType: "AUDIO", quantity: 2, freeQuantity: 5, shortfall: 0, available: true, ...line }]
  });
  const card = () => screen.findByRole("article", { name: "Partner Summit · AUDIO" });

  beforeEach(() => {
    loadEquipmentCatalogue.mockResolvedValue(catalogue([flagged(), reservation({ id: "plain", event_id: "event-2", event_name: "Gala Dinner" })]));
  });

  test("G6-TC25 AC1 AC2 a flagged reservation is listed first under Needs reassessment with why, and is still reserved", async () => {
    render(<EquipmentReservationsScreen now={NOW} />);

    const group = await screen.findByRole("region", { name: "Needs reassessment" });
    const cards = within(group).getAllByRole("article");
    expect(cards.map((item) => item.getAttribute("aria-label"))).toEqual(["Partner Summit · AUDIO"]);
    expect(within(cards[0]).getByText("Reason for reassessment: Event date changed")).toBeInTheDocument();
    // Not released: it keeps its state and offers no release time.
    expect(within(cards[0]).getByText("In use")).toBeInTheDocument();
    expect(within(cards[0]).queryByText(/Release time/)).not.toBeInTheDocument();

    // It comes before Current, and is not listed again there.
    const headings = screen.getAllByRole("heading", { level: 2, name: /reassessment|Current reservations|Past reservations/ });
    expect(headings.map((item) => item.textContent)).toEqual(["Needs reassessment", "Current reservations", "Past reservations"]);
    const current = screen.getByRole("region", { name: "Current reservations" });
    expect(within(current).getAllByRole("article").map((item) => item.getAttribute("aria-label"))).toEqual(["Gala Dinner · AUDIO"]);
  });

  test("G6-TC26 AC3 with nothing to reassess there is no such group, and an ordinary reservation offers no keep or amend", async () => {
    loadEquipmentCatalogue.mockResolvedValue(catalogue([reservation({ id: "plain" })]));
    render(<EquipmentReservationsScreen now={NOW} />);

    expect(await screen.findByRole("region", { name: "Current reservations" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Needs reassessment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep reservation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Amend reservation" })).not.toBeInTheDocument();
  });

  test("G6-TC27 AC3 re-checking shows the new window and the free quantity, and states a shortfall as a number", async () => {
    recheckEquipmentReassessment.mockResolvedValue(recheckResult({}));
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.click(within(await card()).getByRole("button", { name: "Re-check availability" }));

    expect(await within(await card()).findByText("5 free in the new window; no shortfall.")).toBeInTheDocument();
    expect(recheckEquipmentReassessment).toHaveBeenCalledWith({ eventId: "event-1" });
    const from = new Date("2026-11-12T00:30:00.000Z").toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
    const to = new Date("2026-11-12T10:00:00.000Z").toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
    expect(within(await card()).getByText(`New window: ${from} – ${to}`)).toBeInTheDocument();

    recheckEquipmentReassessment.mockResolvedValue(recheckResult({ freeQuantity: 1, shortfall: 1, available: false }));
    userEvent.click(within(await card()).getByRole("button", { name: "Refresh availability" }));
    expect(await within(await card()).findByText("1 free in the new window; shortfall 1.")).toBeInTheDocument();
  });

  test("G6-TC28 AC3 a re-check that cannot be made says why on that reservation", async () => {
    recheckEquipmentReassessment.mockRejectedValue(new Error("This event has no complete date and time to re-check against."));
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.click(within(await card()).getByRole("button", { name: "Re-check availability" }));

    expect(await within(await card()).findByRole("alert")).toHaveTextContent("This event has no complete date and time to re-check against.");
  });

  test("G6-TC29 AC3 keeping asks the service, then the list is read again so the reservation leaves Needs reassessment", async () => {
    keepEquipmentReservation.mockResolvedValue({ reservationId: "flag-1", status: "RESERVED" });
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.type(within(await card()).getByLabelText("Note (optional)"), "Still fits the new date");
    loadEquipmentCatalogue.mockResolvedValue(catalogue([
      flagged({ rerequest_required: false, rerequest_reason: null, start_datetime: "2026-11-12T00:30:00.000Z", end_datetime: "2026-11-12T10:00:00.000Z" })
    ]));
    userEvent.click(within(await card()).getByRole("button", { name: "Keep reservation" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Needs reassessment" })).not.toBeInTheDocument());
    expect(keepEquipmentReservation).toHaveBeenCalledWith({ reservationId: "flag-1", note: "Still fits the new date" });
    expect(loadEquipmentCatalogue).toHaveBeenCalledTimes(2);
  });

  test("G6-TC30 AC3 when the service refuses to keep it, the reason shows on the reservation and it stays under Needs reassessment", async () => {
    keepEquipmentReservation.mockRejectedValue(new Error("Requested quantity unavailable for the required time period: 1 free, 1 more needed."));
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.click(within(await card()).getByRole("button", { name: "Keep reservation" }));

    expect(await within(await card()).findByRole("alert")).toHaveTextContent("1 free, 1 more needed");
    expect(within(screen.getByRole("region", { name: "Needs reassessment" })).getByRole("article")).toBeInTheDocument();
    expect(loadEquipmentCatalogue).toHaveBeenCalledTimes(1);
  });

  test("G6-TC31 AC3 amending needs a note and a whole quantity above zero before anything is sent", async () => {
    render(<EquipmentReservationsScreen now={NOW} />);
    const item = await card();

    userEvent.click(within(item).getByRole("button", { name: "Amend reservation" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent("A note explaining the amendment is required.");

    userEvent.type(within(item).getByLabelText("Amendment note"), "Larger crowd");
    userEvent.clear(within(item).getByLabelText("New quantity"));
    userEvent.type(within(item).getByLabelText("New quantity"), "0");
    userEvent.click(within(item).getByRole("button", { name: "Amend reservation" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent("Quantity must be a whole number greater than zero.");
    expect(amendEquipmentReservation).not.toHaveBeenCalled();
  });

  test("G6-TC32 AC3 amending sends the new quantity and note for that reservation, then the list is read again", async () => {
    amendEquipmentReservation.mockResolvedValue({ reservation: { id: "new-1", quantity: 4, status: "RESERVED" } });
    render(<EquipmentReservationsScreen now={NOW} />);
    const item = await card();
    expect(within(item).getByLabelText("New quantity")).toHaveValue(2);

    userEvent.clear(within(item).getByLabelText("New quantity"));
    userEvent.type(within(item).getByLabelText("New quantity"), "4");
    userEvent.type(within(item).getByLabelText("Amendment note"), "Larger crowd");
    userEvent.click(within(item).getByRole("button", { name: "Amend reservation" }));

    await waitFor(() => expect(amendEquipmentReservation).toHaveBeenCalledWith({ reservationId: "flag-1", quantity: 4, note: "Larger crowd" }));
    await waitFor(() => expect(loadEquipmentCatalogue).toHaveBeenCalledTimes(2));
  });

  test("G6-TC33 AC3 releasing sends the reason given for that reservation, then the list is read again", async () => {
    releaseEquipmentReservation.mockResolvedValue({ reservationId: "flag-1", status: "RELEASED" });
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.type(within(await card()).getByLabelText("Release reason"), "Not needed on the new date");
    userEvent.click(within(await card()).getByRole("button", { name: "Release reservation" }));

    await waitFor(() => expect(releaseEquipmentReservation).toHaveBeenCalledWith({ reservationId: "flag-1", reason: "Not needed on the new date" }));
    await waitFor(() => expect(loadEquipmentCatalogue).toHaveBeenCalledTimes(2));
  });

  test("G6-TC34 AC3 releasing with no reason typed records a default that says the event changed", async () => {
    releaseEquipmentReservation.mockResolvedValue({ reservationId: "flag-1", status: "RELEASED" });
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.click(within(await card()).getByRole("button", { name: "Release reservation" }));

    await waitFor(() => expect(releaseEquipmentReservation).toHaveBeenCalledWith({
      reservationId: "flag-1", reason: "Released after the event changed"
    }));
  });

  test("G6-TC35 AC2 nothing is changed until a button is pressed: opening the screen and re-checking write nothing", async () => {
    recheckEquipmentReassessment.mockResolvedValue(recheckResult({}));
    render(<EquipmentReservationsScreen now={NOW} />);
    userEvent.click(within(await card()).getByRole("button", { name: "Re-check availability" }));
    await within(await card()).findByText("5 free in the new window; no shortfall.");

    [keepEquipmentReservation, amendEquipmentReservation, releaseEquipmentReservation].forEach((action) =>
      expect(action).not.toHaveBeenCalled());
  });
});
