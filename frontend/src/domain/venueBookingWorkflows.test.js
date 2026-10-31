import {
  activeVenueBookings,
  bookingWindow,
  detectVenueBookingConflicts,
  replacementSearchEvent,
  venueBookingClashCount,
  venueBookingNeedsAction,
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

  test("TC-0999 flags overlapping approved future windows and names both events", () => {
    const found = detectVenueBookingConflicts([
      booking("A", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z"),
      booking("B", "2026-11-10T10:30:00Z", "2026-11-10T12:00:00Z")
    ], now);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ event_a_name: "Event A", event_b_name: "Event B" });
    expect(found[0]).toMatchObject({
      overlap_start: "2026-11-10T10:30:00.000Z",
      overlap_end: "2026-11-10T11:00:00.000Z"
    });
  });

  test("TC-1000 does not flag touching boundaries, past, pending, or different venues", () => {
    expect(detectVenueBookingConflicts([
      booking("A", "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z"),
      booking("B", "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"),
      booking("C", "2026-10-10T09:00:00Z", "2026-10-10T11:00:00Z"),
      booking("D", "2026-11-10T09:30:00Z", "2026-11-10T10:30:00Z", { status: "PENDING" }),
      booking("E", "2026-11-10T09:30:00Z", "2026-11-10T10:30:00Z", { venue_id: "V2" })
    ], now)).toEqual([]);
  });

  test("TC-1001 counts each active conflict once even when it appears on both booking rows", () => {
    const active = { conflict_id: "V1--A--B", status: "ACTIVE" };
    expect(venueBookingClashCount([
      { booking_id: "A", clashes: [active, { conflict_id: "resolved", status: "RESOLVED" }] },
      { booking_id: "B", clashes: [active] }
    ])).toBe(1);
  });
});

describe("F11/F13/F14 booking workflow", () => {
  test("TC-1038 prefills a replacement from the affected booking and excludes its venue", () => {
    expect(replacementSearchEvent({ id: "E1", expected_attendance: 200, facilities: ["WIFI"] }, {
      booking_id: "B1", venue_id: "V1", expected_attendance: 40,
      requested_layout_id: "CLASSROOM", required_facilities_snapshot: ["POWER"]
    })).toMatchObject({ event_id: "E1", expected_attendance: 40, required_layout: "CLASSROOM", facilities: ["POWER"], excluded_venue_id: "V1" });
  });

  test("TC-1039 requires every active venue requirement to be approved", () => {
    expect(venueReadyForSafety([{ status: "APPROVED" }, { status: "REJECTED", requires_re_request: true }])).toBe(false);
    expect(venueReadyForSafety([{ status: "APPROVED" }, { status: "APPROVED", replacement_needed: true }])).toBe(false);
    expect(venueReadyForSafety([{ status: "APPROVED" }, { status: "RELEASED" }])).toBe(true);
    expect(venueReadyForSafety([{ status: "RELEASED" }])).toBe(false);
    expect(activeVenueBookings([{ status: "EXPIRED" }, { status: "PENDING" }])).toEqual([{ status: "PENDING" }]);
  });
});

describe("F10 / F13 unit — edge inputs to the clash and readiness rules", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  const stamp = (value) => ({ toDate: () => new Date(value) });

  test("TC-1002 [boundary] Firestore timestamps and event times are used when no occupied window is stored", () => {
    const found = detectVenueBookingConflicts([
      { id: "A", venue_id: "V1", event_id: "E-A", booking_label: "Main", status: "approved", start_datetime: stamp("2026-11-10T09:00:00Z"), end_datetime: stamp("2026-11-10T11:00:00Z") },
      { id: "B", venue_id: "V1", event_id: "E-B", status: "APPROVED", start_datetime: "2026-11-10T10:00:00Z", end_datetime: "2026-11-10T12:00:00Z" }
    ], now);
    // Ids fall back to the document id; names fall back to the label, then the event id.
    expect(found).toEqual([expect.objectContaining({
      booking_a_id: "A", booking_b_id: "B", event_a_name: "Main", event_b_name: "E-B",
      overlap_start: "2026-11-10T10:00:00.000Z", overlap_end: "2026-11-10T11:00:00.000Z"
    })]);
    const [bare] = detectVenueBookingConflicts([
      { id: "C", venue_id: "V1", event_id: "E-C", status: "APPROVED", start_datetime: "2026-11-10T09:00:00Z", end_datetime: "2026-11-10T11:00:00Z" },
      { id: "D", venue_id: "V1", event_id: "E-D", booking_label: "Breakout", status: "APPROVED", start_datetime: "2026-11-10T10:00:00Z", end_datetime: "2026-11-10T12:00:00Z" }
    ], now);
    expect([bare.event_a_name, bare.event_b_name]).toEqual(["E-C", "Breakout"]);
  });

  test("TC-1003 [failure] bookings with no window, an unreadable window or no status are never compared", () => {
    expect(detectVenueBookingConflicts([
      booking("A", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z"),
      booking("NONE", undefined, undefined),
      booking("BAD", "not a date", "2026-11-10T11:00:00Z"),
      booking("NO-STATUS", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z", { status: undefined })
    ], now)).toEqual([]);
    expect(detectVenueBookingConflicts()).toEqual([]);
    expect(bookingWindow()).toEqual({ start: null, end: null });
    expect(detectVenueBookingConflicts([booking("A", "2999-01-01T09:00:00Z", "2999-01-01T11:00:00Z")])).toEqual([]);
  });

  test("TC-1004 [conflict] a conflict id is the same whichever booking is listed first, and safe in a document path", () => {
    const [first] = detectVenueBookingConflicts([booking("A/1", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z"), booking("B", "2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z")], now);
    const [second] = detectVenueBookingConflicts([booking("B", "2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z"), booking("A/1", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z")], now);
    expect(first.conflict_id).toBe("V1--A%2F1--B");
    expect(second.conflict_id).toBe(first.conflict_id);
  });

  test("TC-1005 [boundary] the clash count is zero with no rows, and ignores rows without clashes or clashes without an id", () => {
    expect(venueBookingClashCount()).toBe(0);
    expect(venueBookingClashCount([{ booking_id: "A" }, { booking_id: "B", clashes: [{ status: "ACTIVE" }] }])).toBe(0);
  });

  test("TC-1006 [normal] a rejected request stays active only while it awaits a re-request or replacement; no status counts as active", () => {
    expect(activeVenueBookings()).toEqual([]);
    expect(activeVenueBookings([
      { id: 1, status: "REJECTED" }, { id: 2, status: "REJECTED", replacement_needed: true },
      { id: 3 }, { id: 4, status: "WITHDRAWN" }, { id: 5, status: "HELD" }
    ]).map((item) => item.id)).toEqual([2, 3, 5]);
  });

  test("TC-1085 [conflict] an active hold or an empty list is not venue-ready for the safety check (F13 AC4, F15 AC5)", () => {
    expect(venueReadyForSafety()).toBe(false);
    expect(venueReadyForSafety([{ status: "APPROVED" }, { status: "HELD" }])).toBe(false);
    expect(venueBookingNeedsAction()).toBe(true);
    expect(venueBookingNeedsAction({ status: "approved" })).toBe(false);
  });

  test("TC-1007 [boundary] a replacement search falls back to the booking's layout snapshot, then the event's own needs", () => {
    expect(replacementSearchEvent({ event_id: "E1", required_layout: "THEATRE" }, { id: "B1", venue_id: "V1", event_id: "E9", layout_snapshot: "BANQUET" }))
      .toMatchObject({ event_id: "E1", required_layout: "BANQUET", facilities: [], replacement_for_booking_id: "B1" });
    expect(replacementSearchEvent({ required_layout: "THEATRE", facilities: ["WIFI"], expected_attendance: 80 }, { booking_id: "B2", event_id: "E9", venue_id: "V1" }))
      .toMatchObject({ event_id: "E9", required_layout: "THEATRE", facilities: ["WIFI"], expected_attendance: 80, excluded_venue_id: "V1" });
  });
});
