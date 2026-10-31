// H6 / SCRUM-144 — "Join the waiting list when an event is full" — and H7 / SCRUM-145 —
// "Be invited to take a freed place". The order of an event's waiting list, and who is
// offered a freed place. The registration service runs these same functions.

import {
  INVITATION_HOURS,
  invitationExpiry,
  invitationState,
  invitationsToIssue,
  reservedPlaces,
  waitlistOrder,
  waitlistPosition
} from "./waitingList";

const waiting = (id, joined, changes = {}) => ({ id, event_id: "e1", status: "WAITLISTED", waitlisted_at: joined, ...changes });

describe("H6 AC2 the waiting list is first come, first served", () => {
  test("TC-1659 the order follows the time each attendee joined, earliest first", () => {
    const records = [
      waiting("c", "2026-11-05T03:00:00.000Z"),
      waiting("a", "2026-11-05T01:00:00.000Z"),
      waiting("b", "2026-11-05T02:00:00.000Z")
    ];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["a", "b", "c"]);
    expect(waitlistPosition(records, "a")).toBe(1);
    expect(waitlistPosition(records, "c")).toBe(3);
  });

  test("TC-1660 only Waitlisted records hold a place in the queue", () => {
    const records = [
      waiting("a", "2026-11-05T01:00:00.000Z", { status: "WITHDRAWN" }),
      waiting("b", "2026-11-05T02:00:00.000Z", { status: "REGISTERED" }),
      waiting("c", "2026-11-05T03:00:00.000Z")
    ];
    expect(waitlistPosition(records, "c")).toBe(1);
    expect(waitlistPosition(records, "a")).toBeNull();
  });

  test("TC-1661 Firestore timestamps and dates are ordered by their instant", () => {
    const stamp = (iso) => ({ toDate: () => new Date(iso) });
    const records = [
      waiting("late", stamp("2026-11-05T09:00:00Z")),
      waiting("early", new Date("2026-11-05T08:00:00Z"))
    ];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["early", "late"]);
  });

  test("TC-1662 a record without a join time falls back to its registration time, then its stored position", () => {
    const records = [
      waiting("stored-2", undefined, { waitlist_position: 2 }),
      waiting("stored-1", undefined, { waitlist_position: 1 }),
      waiting("by-registered-at", undefined, { registered_at: "2026-11-01T00:00:00.000Z" })
    ];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["by-registered-at", "stored-1", "stored-2"]);
  });

  test("TC-1663 joining at the same instant is settled by record id, so the order never changes between reads", () => {
    const same = "2026-11-05T01:00:00.000Z";
    const records = [waiting("zed", same), waiting("amy", same)];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["amy", "zed"]);
    expect(waitlistOrder([...records].reverse()).map((record) => record.id)).toEqual(["amy", "zed"]);
  });

  test("TC-1664 someone ahead leaving moves everyone behind up", () => {
    const records = [waiting("a", "2026-11-05T01:00:00.000Z"), waiting("b", "2026-11-05T02:00:00.000Z")];
    expect(waitlistPosition(records, "b")).toBe(2);
    expect(waitlistPosition([{ ...records[0], status: "WITHDRAWN" }, records[1]], "b")).toBe(1);
  });

  test("TC-1665 an id not on the list has no position", () => {
    expect(waitlistPosition([], "a")).toBeNull();
  });
});

// ---- H7 / SCRUM-145 — Be invited to take a freed place ----------------------------

const NOW = new Date("2026-11-05T12:00:00+08:00");
const IN_49_HOURS = new Date(NOW.getTime() + 49 * 3600000).toISOString();
const AN_HOUR_AGO = new Date(NOW.getTime() - 3600000).toISOString();

const runningEvent = (changes = {}) => ({
  status: "CONFIRMED",
  registration_required: true,
  registration_capacity: 2,
  event_date: "2026-11-12",
  start_time: "09:00",
  ...changes
});

const reg = (id, status, changes = {}) => ({ id, event_id: "e1", status, ...changes });
const queued = (id, hour, changes = {}) => reg(id, "WAITLISTED", { waitlisted_at: `2026-11-04T0${hour}:00:00.000Z`, ...changes });

describe("H7 AC3 how long an invitation lasts", () => {
  test("TC-1725 an invitation lasts 48 hours", () => {
    expect(INVITATION_HOURS).toBe(48);
    expect(invitationExpiry(runningEvent(), NOW).toISOString()).toBe(new Date(NOW.getTime() + 48 * 3600000).toISOString());
  });

  test("TC-1726 an invitation ends when the event starts, if that comes first", () => {
    const soon = runningEvent({ event_date: "2026-11-06", start_time: "09:00" });
    expect(invitationExpiry(soon, NOW).toISOString()).toBe("2026-11-06T01:00:00.000Z");
  });

  test("TC-1727 no invitation can be issued once the event has started", () => {
    expect(invitationExpiry(runningEvent(), new Date("2026-11-12T09:00:00+08:00"))).toBeNull();
  });
});

describe("H7 AC3 AC4 an invitation's state", () => {
  test("TC-1728 a waiting record with no invitation has none", () => {
    expect(invitationState(queued("a", 1), NOW)).toBe("NONE");
  });

  test("TC-1729 an invitation is active until it expires, then lapsed", () => {
    expect(invitationState(queued("a", 1, { invitation_expires_at: IN_49_HOURS }), NOW)).toBe("ACTIVE");
    expect(invitationState(queued("a", 1, { invitation_expires_at: AN_HOUR_AGO }), NOW)).toBe("LAPSED");
    expect(invitationState(queued("a", 1, { invitation_expires_at: NOW.toISOString() }), NOW)).toBe("LAPSED");
  });

  test("TC-1730 a record no longer waiting holds no invitation", () => {
    expect(invitationState(reg("a", "REGISTERED", { invitation_expires_at: IN_49_HOURS }), NOW)).toBe("NONE");
  });

  test("TC-1731 an active invitation holds a place; a lapsed one does not", () => {
    const records = [
      queued("a", 1, { invitation_expires_at: IN_49_HOURS }),
      queued("b", 2, { invitation_expires_at: AN_HOUR_AGO }),
      queued("c", 3)
    ];
    expect(reservedPlaces(records, NOW)).toBe(1);
  });
});

describe("H7 AC1 AC4 who is invited when a place is free", () => {
  test("TC-1732 a free place is offered to the first person in the queue", () => {
    const records = [reg("x1", "REGISTERED"), queued("b", 2), queued("a", 1)];
    expect(invitationsToIssue({ event: runningEvent(), records, now: NOW }).map((invite) => invite.id)).toEqual(["a"]);
  });

  test("TC-1733 the invitation carries its expiry", () => {
    const [invite] = invitationsToIssue({ event: runningEvent(), records: [reg("x1", "REGISTERED"), queued("a", 1)], now: NOW });
    expect(invite.expires_at.toISOString()).toBe(new Date(NOW.getTime() + 48 * 3600000).toISOString());
  });

  test("TC-1734 as many people are invited as there are free places, in queue order", () => {
    const records = [queued("c", 3), queued("a", 1), queued("b", 2)];
    expect(invitationsToIssue({ event: runningEvent(), records, now: NOW }).map((invite) => invite.id)).toEqual(["a", "b"]);
  });

  test("TC-1735 nobody is invited while the event is full, or when everyone free is already invited", () => {
    expect(invitationsToIssue({ event: runningEvent(), records: [reg("x1", "REGISTERED"), reg("x2", "REGISTERED"), queued("a", 1)], now: NOW })).toEqual([]);
    expect(invitationsToIssue({ event: runningEvent(), records: [reg("x1", "REGISTERED"), queued("a", 1, { invitation_expires_at: IN_49_HOURS }), queued("b", 2)], now: NOW })).toEqual([]);
  });

  test("TC-1736 when an invitation lapses, the place passes to the next person, who keeps theirs behind", () => {
    const records = [
      reg("x1", "REGISTERED"),
      queued("a", 1, { invitation_expires_at: AN_HOUR_AGO }),
      queued("b", 2)
    ];
    expect(invitationsToIssue({ event: runningEvent(), records, now: NOW }).map((invite) => invite.id)).toEqual(["b"]);
  });

  test("TC-1737 someone whose invitation lapsed is offered the next place that frees after it", () => {
    const records = [
      reg("x1", "REGISTERED"),
      queued("a", 1, { invitation_expires_at: AN_HOUR_AGO }),
      queued("b", 2, { invitation_expires_at: IN_49_HOURS }),
      reg("x2", "WITHDRAWN", { withdrawn_from: "REGISTERED", withdrawn_at: NOW.toISOString() })
    ];
    expect(invitationsToIssue({ event: runningEvent({ registration_capacity: 3 }), records, now: NOW }).map((invite) => invite.id)).toEqual(["a"]);
  });

  test("TC-1738 a place freed before the lapse does not bring that person back", () => {
    const records = [
      reg("x2", "WITHDRAWN", { withdrawn_from: "REGISTERED", withdrawn_at: "2026-11-03T00:00:00.000Z" }),
      queued("a", 1, { invitation_expires_at: AN_HOUR_AGO })
    ];
    expect(invitationsToIssue({ event: runningEvent(), records, now: NOW })).toEqual([]);
  });

  test.each([
    ["the event has started", runningEvent(), new Date("2026-11-12T09:00:00+08:00")],
    ["the event is cancelled", runningEvent({ status: "CANCELLED" }), NOW],
    ["registration is off", runningEvent({ registration_required: false }), NOW],
    ["there is no capacity", runningEvent({ registration_capacity: null }), NOW]
  ])("TC-1739 nobody is invited when %s", (_label, event, now) => {
    expect(invitationsToIssue({ event, records: [queued("a", 1)], now })).toEqual([]);
  });
});
