// D5 — frontend/src/domain/eventCompletion.mjs, when a coordinator may close out an event.
import assert from "node:assert/strict";
import test from "node:test";

import { canCompleteEvent, eventEndInstant } from "../../../frontend/src/domain/eventCompletion.mjs";

const event = (changes = {}) => ({ status: "CONFIRMED", coordinator_id: "c1", event_date: "2026-10-24", end_time: "17:00", ...changes });

test("TC-0539 [boundary] D5 the end is read in Singapore time; only a strictly later instant may complete", () => {
  const end = new Date("2026-10-24T09:00:00Z");
  assert.deepEqual(eventEndInstant(event()), end);
  assert.equal(canCompleteEvent(event(), "c1", end), false);
  assert.equal(canCompleteEvent(event(), "c1", new Date(end.getTime() + 1)), true);
});

test("TC-0540 [failure] D5 a missing, impossible or malformed date or time has no end", () => {
  for (const changes of [{ event_date: undefined }, { event_date: "2026-02-30" }, { event_date: "24/10/2026" }, { end_time: "24:00" }, { end_time: null }]) {
    assert.equal(eventEndInstant(event(changes)), null, JSON.stringify(changes));
  }
  assert.equal(eventEndInstant(), null);
});

test("TC-0541 [conflict] D5 K5 another coordinator, a non-Confirmed event, no event or a bad clock cannot complete", () => {
  const later = new Date("2027-01-01T00:00:00Z");
  assert.equal(canCompleteEvent(event(), "c2", later), false);
  assert.equal(canCompleteEvent(event({ status: "SAFETY_REVIEW" }), "c1", later), false);
  // A null event throws instead of returning false (reported as a bug); undefined is guarded.
  assert.equal(canCompleteEvent(undefined, "c1", later), false);
  assert.equal(canCompleteEvent(event({ end_time: "bad" }), "c1", later), false);
  assert.equal(canCompleteEvent(event(), "c1", "2027-01-01"), false);
  assert.equal(canCompleteEvent(event({ event_date: "2020-01-01" }), "c1"), true);
});
