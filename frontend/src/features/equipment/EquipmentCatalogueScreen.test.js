// G2 / G3 / G5 — Technical Support's Equipment catalogue and Reservations
// screens.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EquipmentCatalogueScreen from "./EquipmentCatalogueScreen";
import EquipmentReservationsScreen from "./EquipmentReservationsScreen";
import { loadEquipmentCatalogue } from "./equipmentApi";

jest.mock("./equipmentApi", () => ({ loadEquipmentCatalogue: jest.fn() }));

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

test("TC-1227 the Equipment catalogue shows each type's stock, what is reserved and free now, and what is coming up", async () => {
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

test("TC-1228 a catalogue that cannot be loaded says why", async () => {
  loadEquipmentCatalogue.mockRejectedValue(new Error("The equipment service is not responding."));
  render(<EquipmentCatalogueScreen now={NOW} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The equipment service is not responding.");
});

test("TC-1229 Reservations lists current ones soonest first and past ones with why they were released, and can show only mine", async () => {
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

test("TC-1318 G5 AC3 a released reservation shows when it was released as well as why, and an active one shows no release time", async () => {
  render(<EquipmentReservationsScreen now={NOW} />);

  const released = await screen.findByRole("article", { name: "Town Hall · AUDIO" });
  const releasedAt = new Date("2026-10-18T02:00:00.000Z").toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
  expect(within(released).getByText("Release reason: Event cancelled")).toBeInTheDocument();
  expect(within(released).getByText(`Release time: ${releasedAt}`)).toBeInTheDocument();

  expect(within(screen.getByRole("article", { name: "Partner Summit · AUDIO" })).queryByText(/Release time/)).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Event event-gone · AUDIO" })).queryByText(/Release time/)).not.toBeInTheDocument();
});

test("TC-1319 G5 AC3 a released reservation with no recorded release time says so", async () => {
  loadEquipmentCatalogue.mockResolvedValue({
    userId: "tech-1", inventory: [], unavailability: [],
    reservations: [reservation({ id: "no-time", status: "RELEASED", release_reason: "Event cancelled", released_at: null })]
  });
  render(<EquipmentReservationsScreen now={NOW} />);

  const card = await screen.findByRole("article", { name: "Partner Summit · AUDIO" });
  expect(within(card).getByText("Release reason: Event cancelled")).toBeInTheDocument();
  expect(within(card).getByText("Release time: Not recorded")).toBeInTheDocument();
});

test("TC-1230 a reservation missing its reference, release reason or dates says so, and type names read as words", async () => {
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

test("TC-1231 with no reservations, each list says so", async () => {
  loadEquipmentCatalogue.mockResolvedValue({ userId: "tech-1", inventory: [], unavailability: [], reservations: [] });
  render(<EquipmentReservationsScreen now={NOW} />);
  expect(await screen.findByText("No current reservations.")).toBeInTheDocument();
  expect(screen.getByText("No past reservations.")).toBeInTheDocument();
});

describe("G2 / G5 catalogue and reservations — edges", () => {
  test("TC-1232 [failure] a catalogue that cannot be loaded shows its reason on both screens", async () => {
    loadEquipmentCatalogue.mockRejectedValue(new Error("The equipment service is not responding."));
    const { unmount } = render(<EquipmentCatalogueScreen now={NOW} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The equipment service is not responding.");
    unmount();
    render(<EquipmentReservationsScreen now={NOW} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The equipment service is not responding.");
  });

  test("TC-1233 [boundary] without a fixed time both screens read the clock, and a reservation with no type still shows", async () => {
    loadEquipmentCatalogue.mockResolvedValue({
      userId: "tech-1", inventory: [], unavailability: [],
      reservations: [reservation({ id: "typeless", equipment_type: undefined, start_datetime: "2999-01-01T00:00:00.000Z", end_datetime: "2999-01-02T00:00:00.000Z" })]
    });
    const { unmount } = render(<EquipmentCatalogueScreen />);
    expect(await screen.findByRole("article", { name: "AUDIO" })).toBeInTheDocument();
    unmount();
    render(<EquipmentReservationsScreen />);
    expect(await screen.findByRole("heading", { name: "Partner Summit" })).toBeInTheDocument();
  });

  test("TC-1234 [boundary] leaving the screen before the catalogue arrives, or fails, changes nothing", async () => {
    let settle;
    loadEquipmentCatalogue.mockImplementation(() => new Promise((resolve, reject) => { settle = { resolve, reject }; }));
    const first = render(<EquipmentCatalogueScreen now={NOW} />);
    first.unmount();
    settle.resolve({ inventory: [], reservations: [], unavailability: [] });
    const second = render(<EquipmentCatalogueScreen now={NOW} />);
    second.unmount();
    settle.reject(new Error("late"));
    await Promise.resolve();
    expect(loadEquipmentCatalogue).toHaveBeenCalledTimes(2);
  });
});
