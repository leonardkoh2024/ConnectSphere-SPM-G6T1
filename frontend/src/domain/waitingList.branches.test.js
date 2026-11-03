// H6 / H7 — the offer message and the missing-field and omitted-argument cases of the waiting list.

import {
  invitationExpiry,
  invitationState,
  invitationsToIssue,
  placeOfferedMessage,
  reservedPlaces,
  waitlistOrder,
  waitlistPosition
} from "./waitingList.mjs";

const NOW = new Date("2026-11-01T00:00:00Z");
const event = (overrides = {}) => ({
  status: "APPROVED",
  registration_required: true,
  registration_capacity: 2,
  event_date: "2026-12-01",
  start_time: "10:00",
  ...overrides
});

describe("H7 place offered message", () => {
  test("TC-2729 gives the event name and the Singapore-time deadline", () => {
    expect(placeOfferedMessage({ eventName: "Gala", expiresAt: "2026-10-30T10:30:00Z" })).toBe(
      "A place has opened at Gala. Accept it in My registrations by 30 Oct 2026, 18:30, or it will be offered to the next person on the waiting list."
    );
  });

  test("TC-2730 names no event as 'your event' and pads a single-digit hour", () => {
    expect(placeOfferedMessage({ expiresAt: new Date("2026-01-05T00:05:00Z") })).toContain(
      "A place has opened at your event. Accept it in My registrations by 5 Jan 2026, 08:05,"
    );
  });
});

describe("H6 waiting list order fallbacks", () => {
  test("TC-2731 no records give an empty order", () => {
    expect(waitlistOrder()).toEqual([]);
    expect(waitlistOrder([null, {}])).toEqual([]);
  });

  test("TC-2732 an unparseable time is treated as no time and sorts last", () => {
    const order = waitlistOrder([
      { id: "late", status: "WAITLISTED", waitlisted_at: "garbage" },
      { id: "early", status: "WAITLISTED", waitlisted_at: "2026-10-01T00:00:00Z" }
    ]);
    expect(order.map((record) => record.id)).toEqual(["early", "late"]);
    const reversed = waitlistOrder([
      { id: "early", status: "WAITLISTED", waitlisted_at: "2026-10-01T00:00:00Z" },
      { id: "late", status: "WAITLISTED", waitlisted_at: "garbage" }
    ]);
    expect(reversed.map((record) => record.id)).toEqual(["early", "late"]);
  });

  test("TC-2733 records are identified by registration_id, or by nothing", () => {
    const records = [
      { registration_id: "b", status: "WAITLISTED", waitlisted_at: "2026-10-01T00:00:00Z" },
      { registration_id: "a", status: "WAITLISTED", waitlisted_at: "2026-10-01T00:00:00Z" },
      { status: "WAITLISTED", waitlisted_at: "2026-10-01T00:00:00Z" }
    ];
    expect(waitlistOrder(records).map((record) => record.registration_id)).toEqual([undefined, "a", "b"]);
    expect(waitlistPosition(records, "a")).toBe(2);
  });
});

describe("H7 invitation fallbacks", () => {
  test("TC-2734 an event with no date or start time gives no expiry", () => {
    expect(invitationExpiry({ event_date: "2026-12-01" }, NOW)).toBeNull();
    expect(invitationExpiry(undefined, NOW)).toBeNull();
  });

  test("TC-2735 expiry, state and held places use the current time when none is given", () => {
    expect(invitationExpiry(event({ event_date: "2999-01-01" }))).toBeInstanceOf(Date);
    expect(invitationState({ status: "WAITLISTED", invitation_expires_at: "2999-01-01T00:00:00Z" })).toBe("ACTIVE");
    expect(reservedPlaces()).toBe(0);
  });

  test("TC-2736 a record with no status holds no offer", () => {
    expect(invitationState({ invitation_expires_at: "2999-01-01T00:00:00Z" }, NOW)).toBe("NONE");
  });

  test("TC-2737 an event with no status issues no invitations", () => {
    expect(invitationsToIssue({ event: event({ status: undefined }), now: NOW })).toEqual([]);
  });

  test("TC-2738 invitations default to no records and the current time", () => {
    expect(invitationsToIssue({ event: event({ event_date: "2999-01-01" }) })).toEqual([]);
  });
});
