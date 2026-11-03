// D5 event completion — missing and defaulted arguments the main suite leaves out.

import { canCompleteEvent, eventEndInstant } from "./eventCompletion.mjs";

describe("D5 event completion defaults", () => {
  test("TC-2712 an event with no date, or no end time, has no end instant", () => {
    expect(eventEndInstant()).toBeNull();
    expect(eventEndInstant({})).toBeNull();
    expect(eventEndInstant({ event_date: "2026-10-24" })).toBeNull();
  });

  test("TC-2713 completion is judged against the current time when none is given", () => {
    const past = { status: "CONFIRMED", coordinator_id: "c1", event_date: "2000-01-01", end_time: "17:00" };
    expect(canCompleteEvent(past, "c1")).toBe(true);
    expect(canCompleteEvent({ ...past, event_date: "2999-01-01" }, "c1")).toBe(false);
  });
});
