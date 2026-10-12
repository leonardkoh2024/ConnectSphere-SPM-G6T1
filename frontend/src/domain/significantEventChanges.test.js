import {
  editableEventStatuses,
  significantEventChanges,
  significantEventValues,
  validateSignificantEventValues
} from "./significantEventChanges";

describe("D2 significant event changes", () => {
  const original = {
    expected_attendance: 100,
    event_date: "2026-11-04",
    start_time: "09:00",
    end_time: "17:00",
    preferred_location: "CENTRAL",
    required_layout: "THEATRE",
    facilities_required: true,
    facilities: ["WIFI", "STAGE"],
    accessibility_needed: true,
    accessibility: ["STEP_FREE_ACCESS"],
    accessibility_notes: "Near the entrance"
  };

  test("covers the status window and normalizes requirements for comparison", () => {
    expect(editableEventStatuses).toEqual(["APPROVED", "PLANNING", "CONFIRMED"]);
    expect(significantEventValues({ ...original, facilities: ["STAGE", "WIFI"] }))
      .toEqual(significantEventValues(original));
  });

  test.each([
    ["attendance", { expected_attendance: 120 }],
    ["date", { event_date: "2026-11-05" }],
    ["start time", { start_time: "10:00" }],
    ["end time", { end_time: "18:00" }],
    ["venue requirements", { required_layout: "CLASSROOM" }],
    ["facility requirements", { facilities: ["WIFI"] }],
    ["accessibility requirements", { accessibility: ["LIFT"] }]
  ])("records old and new values for a %s change", (_name, update) => {
    const changes = significantEventChanges(original, { ...original, ...update });
    const field = Object.keys(update)[0];
    const normalize = (value) => Array.isArray(value) ? [...value].sort() : value;
    expect(changes[field]).toEqual({
      old_value: normalize(original[field]),
      new_value: normalize(update[field])
    });
  });

  test("rejects invalid attendance and non-positive event windows", () => {
    expect(validateSignificantEventValues({ ...original, expected_attendance: "2.5" }))
      .toMatch(/whole number/i);
    expect(validateSignificantEventValues({ ...original, end_time: "09:00" }))
      .toMatch(/later than/i);
    expect(validateSignificantEventValues({ ...original, event_date: "" }))
      .toMatch(/required/i);
    expect(validateSignificantEventValues({ ...original, event_date: "2026-02-30" }))
      .toMatch(/valid event date/i);
    expect(validateSignificantEventValues({ ...original, start_time: "25:00" }))
      .toMatch(/valid start and end times/i);
    expect(validateSignificantEventValues(original)).toBe("");
  });
});
