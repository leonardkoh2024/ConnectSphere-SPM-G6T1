import {
  activeVenueBookings,
  detectVenueBookingConflicts,
  replacementSearchEvent,
  venueBookingClashCount,
  venueReadyForSafety
} from "./venueBookingWorkflows";

const booking = (id, start, end, extra = {}) => ({
  booking_id: id,
  venue_id: "V1",
  event_id: `E-${id}`,
  event_name: `Event ${id}`,
  status: "APPROVED",
  occupied_start: start,
  occupied_end: end,
  ...extra
});

describe("F10 venue booking clashes", () => {
  const now = new Date("2026-11-01T00:00:00Z");

  test("flags overlapping approved future windows and names both events", () => {
    const found = detectVenueBookingConflicts([
      booking("A", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z"),
      booking("B", "2026-11-10T10:30:00Z", "2026-11-10T12:00:00Z")
    ], now);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ event_a_name: "Event A", event_b_name: "Event B" });
  });

  test("does not flag touching boundaries, past, pending, or different venues", () => {
    expect(detectVenueBookingConflicts([
      booking("A", "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z"),
      booking("B", "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"),
      booking("C", "2026-10-10T09:00:00Z", "2026-10-10T11:00:00Z"),
      booking("D", "2026-11-10T09:30:00Z", "2026-11-10T10:30:00Z", { status: "PENDING" }),
      booking("E", "2026-11-10T09:30:00Z", "2026-11-10T10:30:00Z", { venue_id: "V2" })
    ], now)).toEqual([]);
  });

  test("counts each active conflict once even when it appears on both booking rows", () => {
    const active = { conflict_id: "V1--A--B", status: "ACTIVE" };
    expect(venueBookingClashCount([
      { booking_id: "A", clashes: [active, { conflict_id: "resolved", status: "RESOLVED" }] },
      { booking_id: "B", clashes: [active] }
    ])).toBe(1);
  });
});

describe("F11/F13/F14 booking workflow", () => {
  test("prefills a replacement from the affected booking and excludes its venue", () => {
    expect(replacementSearchEvent({ id: "E1", expected_attendance: 200, facilities: ["WIFI"] }, {
      booking_id: "B1", venue_id: "V1", expected_attendance: 40,
      requested_layout_id: "CLASSROOM", required_facilities_snapshot: ["POWER"]
    })).toMatchObject({ event_id: "E1", expected_attendance: 40, required_layout: "CLASSROOM", facilities: ["POWER"], excluded_venue_id: "V1" });
  });

  test("requires every active venue requirement to be approved", () => {
    expect(venueReadyForSafety([{ status: "APPROVED" }, { status: "REJECTED", requires_re_request: true }])).toBe(false);
    expect(venueReadyForSafety([{ status: "APPROVED" }, { status: "RELEASED" }])).toBe(true);
    expect(activeVenueBookings([{ status: "EXPIRED" }, { status: "PENDING" }])).toEqual([{ status: "PENDING" }]);
  });
});
