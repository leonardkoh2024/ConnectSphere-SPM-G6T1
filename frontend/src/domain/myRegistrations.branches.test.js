// H4 / SCRUM-142 — the missing-field and omitted-argument cases of "my registrations".

import {
  listMyRegistrations,
  myRegistrationEntry,
  withdrawalRefusal
} from "./myRegistrations.mjs";

const NOW = new Date("2026-11-01T00:00:00Z");
const event = (overrides = {}) => ({
  name: "Alpha",
  description: "A talk",
  status: "CONFIRMED",
  event_date: "2026-12-01",
  start_time: "10:00",
  end_time: "12:00",
  ...overrides
});
const registration = (overrides = {}) => ({
  id: "r1",
  event_id: "e1",
  status: "REGISTERED",
  ...overrides
});

describe("H4 my registrations fallbacks", () => {
  test("TC-2723 an event with no date or an impossible date cannot be withdrawn from", () => {
    expect(withdrawalRefusal(registration(), event({ event_date: undefined }), NOW).reason).toBe("event_started");
    expect(withdrawalRefusal(registration(), event({ event_date: "2026-13-45" }), NOW).reason).toBe("event_started");
  });

  test("TC-2724 withdrawal is judged against the current time when none is given", () => {
    expect(withdrawalRefusal(registration(), event({ event_date: "2000-01-01" })).reason).toBe("event_started");
    expect(withdrawalRefusal(registration(), event({ event_date: "2999-01-01" }))).toBeNull();
  });

  test("TC-2725 an entry for a bare event has empty text and no times", () => {
    const entry = myRegistrationEntry({ registration_id: "r9", event_id: "e1", status: "REGISTERED" }, { status: "CONFIRMED" });
    expect(entry).toMatchObject({
      registration_id: "r9",
      name: "",
      description: "",
      event_date: null,
      start_time: null,
      end_time: null,
      venue_names: [],
      active: false,
      waitlist_position: null
    });
  });

  test("TC-2726 an offered place on an upcoming event can be accepted", () => {
    const entry = myRegistrationEntry(
      registration({ status: "WAITLISTED", invitation_expires_at: "2026-11-02T00:00:00Z" }),
      event(),
      { now: NOW }
    );
    expect(entry).toMatchObject({
      invitation_active: true,
      can_accept: true,
      invitation_lapsed: false,
      invitation_expires_at: "2026-11-02T00:00:00Z"
    });
  });

  test("TC-2727 an offered place on an event that has started cannot be accepted", () => {
    const entry = myRegistrationEntry(
      registration({ status: "WAITLISTED", invitation_expires_at: "2026-11-02T00:00:00Z" }),
      event({ event_date: "2026-10-01" }),
      { now: NOW }
    );
    expect(entry).toMatchObject({ invitation_active: false, can_accept: false });
  });

  test("TC-2728 registrations on events with no date still sort, by name", () => {
    const entries = listMyRegistrations([
      { registration: registration({ id: "r2", event_id: "e2" }), event: event({ name: "Beta", event_date: undefined, start_time: undefined }) },
      { registration: registration({ id: "r1", event_id: "e1" }), event: event({ name: "Alpha", event_date: undefined, start_time: undefined }) }
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["Alpha", "Beta"]);
  });
});
