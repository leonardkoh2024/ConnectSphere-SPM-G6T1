import { canCompleteEvent, eventEndInstant } from "./eventCompletion.mjs";

const event = {
  status: "CONFIRMED",
  coordinator_id: "c1",
  event_date: "2026-10-24",
  end_time: "17:00"
};

describe("D5 event completion", () => {
  test("AC1 interprets the saved end date and time as Singapore time", () => {
    expect(eventEndInstant(event).toISOString()).toBe("2026-10-24T09:00:00.000Z");
    expect(canCompleteEvent(event, "c1", new Date("2026-10-24T08:59:59Z"))).toBe(false);
    expect(canCompleteEvent(event, "c1", new Date("2026-10-24T09:00:00Z"))).toBe(false);
    expect(canCompleteEvent(event, "c1", new Date("2026-10-24T09:00:01Z"))).toBe(true);
  });

  test("completion requires a confirmed event assigned to the caller", () => {
    expect(canCompleteEvent({ ...event, status: "PLANNING" }, "c1", new Date("2026-10-25T00:00:00Z"))).toBe(false);
    expect(canCompleteEvent(event, "c2", new Date("2026-10-25T00:00:00Z"))).toBe(false);
  });

  test("invalid dates and times cannot be completed", () => {
    expect(eventEndInstant({ ...event, event_date: "2026-02-30" })).toBeNull();
    expect(eventEndInstant({ ...event, end_time: "24:00" })).toBeNull();
  });
});
