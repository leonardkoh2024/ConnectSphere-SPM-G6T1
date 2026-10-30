// Edge cases and defaults of the registration building blocks (H1, H3, H4, H6, H8), called
// directly over the shared in-memory Firestore.
import assert from "node:assert/strict";
import test from "node:test";

import { fakeFirestore } from "../../../testing/fakeFirestore.js";
import { createRegistrationList } from "./attendeeList.js";
import { createMyRegistrations } from "./myRegistrations.js";
import { createAttendeeRegistration } from "./register.js";
import { createRegistrationSettings } from "./settings.js";

const futureEvent = (changes = {}) => ({
  organiser_id: "organiser-1",
  name: "Future Forum",
  event_date: "2099-11-12",
  start_time: "09:00",
  end_time: "17:00",
  status: "CONFIRMED",
  registration_required: true,
  registration_capacity: 2,
  registration_open_date: "2020-01-01",
  registration_open_time: "09:00",
  registration_close_date: "2099-11-10",
  registration_close_time: "17:00",
  ...changes
});

test("TC-1772 [boundary] H8 attendees are named by attendee_id or user_id and sorted by registration time, undated last", async () => {
  const firestore = fakeFirestore({
    events: { e1: { organiser_id: "organiser-1" } },
    users: { a1: { name: "Ann" }, u2: { name: "Uma", email: "u@x" } },
    registrations: {
      r1: { event_id: "e1", attendee_id: "a1", status: "REGISTERED", registered_at: new Date("2026-11-02T00:00:00Z") },
      r2: { event_id: "e1", user_id: "u2", status: "REGISTERED", registered_at: { toDate: () => new Date("2026-11-01T00:00:00Z") } },
      r3: { event_id: "e1", status: "REGISTERED" },
      r4: { event_id: "e1", attendee_id: "a4", status: "REGISTERED", registered_at: "2026-11-02T00:00:00.000Z" },
      r5: { event_id: "e1", attendee_id: "a5", status: "REGISTERED", registered_at: null },
      r6: { event_id: "e1", attendee_id: "a6", status: "CANCELLED" }
    }
  });
  const list = await createRegistrationList({ firestore }).load({ eventId: "e1", userId: "organiser-1" });
  assert.deepEqual(list.counts, { registered: 5, waitlisted: 0, withdrawn: 0 });
  assert.deepEqual(list.attendees.map((entry) => entry.registration_id), ["r2", "r1", "r4", "r3", "r5"]);
  assert.equal(list.attendees[3].attendee_id, null);
  assert.equal(list.attendees[0].email, "u@x");
  assert.equal(list.attendees[1].email, null);
});

test("TC-1531 [normal] H4 my registrations work with the default clock and no waiting-list lookup", async () => {
  const firestore = fakeFirestore({
    events: { e1: futureEvent() },
    registrations: { r1: { event_id: "e1", attendee_id: "a1", status: "WAITLISTED", waitlisted_at: "2026-11-01T00:00:00.000Z" } }
  });
  const mine = await createMyRegistrations({ firestore, venueNamesFor: async () => ["Hall"] }).load({ attendeeId: "a1" });
  assert.equal(mine.registrations.length, 1);
  assert.equal(mine.registrations[0].status, "WAITLISTED");
  assert.equal(mine.registrations[0].waitlist_position, null);
});

test("TC-1493 [normal] H3 registering uses the real clock when none is injected", async () => {
  const firestore = fakeFirestore({ events: { e1: futureEvent() }, registrations: {}, notifications: {} });
  const result = await createAttendeeRegistration({ firestore, serverTimestamp: () => "STAMP" }).register({ eventId: "e1", attendeeId: "a1" });
  assert.equal(result.registration.status, "REGISTERED");
});

test("TC-1320 [normal] H1 settings load with the real clock when none is injected", async () => {
  const firestore = fakeFirestore({ events: { e1: futureEvent() }, registrations: {} });
  const settings = createRegistrationSettings({ firestore, serverTimestamp: () => "STAMP", getApprovedEventBookings: async () => [] });
  const loaded = await settings.load({ eventId: "e1", userId: "organiser-1" });
  assert.equal(loaded.settings.registration_capacity, 2);
  assert.equal(loaded.venue_capacity, null);
});
