// H6 / SCRUM-144 — "Join the waiting list when an event is full". The order of an event's
// waiting list. The registration service runs these same functions.

import { waitlistOrder, waitlistPosition } from "./waitingList";

const waiting = (id, joined, changes = {}) => ({ id, event_id: "e1", status: "WAITLISTED", waitlisted_at: joined, ...changes });

describe("H6 AC2 the waiting list is first come, first served", () => {
  test("TC-680 the order follows the time each attendee joined, earliest first", () => {
    const records = [
      waiting("c", "2026-11-05T03:00:00.000Z"),
      waiting("a", "2026-11-05T01:00:00.000Z"),
      waiting("b", "2026-11-05T02:00:00.000Z")
    ];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["a", "b", "c"]);
    expect(waitlistPosition(records, "a")).toBe(1);
    expect(waitlistPosition(records, "c")).toBe(3);
  });

  test("TC-681 only Waitlisted records hold a place in the queue", () => {
    const records = [
      waiting("a", "2026-11-05T01:00:00.000Z", { status: "WITHDRAWN" }),
      waiting("b", "2026-11-05T02:00:00.000Z", { status: "REGISTERED" }),
      waiting("c", "2026-11-05T03:00:00.000Z")
    ];
    expect(waitlistPosition(records, "c")).toBe(1);
    expect(waitlistPosition(records, "a")).toBeNull();
  });

  test("TC-682 Firestore timestamps and dates are ordered by their instant", () => {
    const stamp = (iso) => ({ toDate: () => new Date(iso) });
    const records = [
      waiting("late", stamp("2026-11-05T09:00:00Z")),
      waiting("early", new Date("2026-11-05T08:00:00Z"))
    ];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["early", "late"]);
  });

  test("TC-683 a record without a join time falls back to its registration time, then its stored position", () => {
    const records = [
      waiting("stored-2", undefined, { waitlist_position: 2 }),
      waiting("stored-1", undefined, { waitlist_position: 1 }),
      waiting("by-registered-at", undefined, { registered_at: "2026-11-01T00:00:00.000Z" })
    ];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["by-registered-at", "stored-1", "stored-2"]);
  });

  test("TC-684 joining at the same instant is settled by record id, so the order never changes between reads", () => {
    const same = "2026-11-05T01:00:00.000Z";
    const records = [waiting("zed", same), waiting("amy", same)];
    expect(waitlistOrder(records).map((record) => record.id)).toEqual(["amy", "zed"]);
    expect(waitlistOrder([...records].reverse()).map((record) => record.id)).toEqual(["amy", "zed"]);
  });

  test("TC-685 someone ahead leaving moves everyone behind up", () => {
    const records = [waiting("a", "2026-11-05T01:00:00.000Z"), waiting("b", "2026-11-05T02:00:00.000Z")];
    expect(waitlistPosition(records, "b")).toBe(2);
    expect(waitlistPosition([{ ...records[0], status: "WITHDRAWN" }, records[1]], "b")).toBe(1);
  });

  test("TC-685 an id not on the list has no position", () => {
    expect(waitlistPosition([], "a")).toBeNull();
  });
});
