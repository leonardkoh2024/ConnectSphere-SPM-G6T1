// H1 / SCRUM-139 — Open registration for my event. The registration service's
// transaction: load and save an event's registration capacity and window.
//
// Why a service and not the browser: AC3 needs the venue capacity of the event's approved
// bookings, which an organiser may not read (A4) — the booking and venue records stay
// closed to them — so the service (Admin SDK, which firestore.rules do not bind) reads them
// inside the same transaction as the write. Same shape as J5's Technical Support notices.
// AC5: the save also counts the event's REGISTERED attendees (inside the same transaction) and
// refuses a capacity below that count. Only status REGISTERED counts.
// Runs under node's test runner: `npm run test:backend`.

import assert from "node:assert/strict";
import test from "node:test";

import { createRegistrationSettings } from "./settings.js";

const NOW = "2026-11-01T02:00:00Z"; // Sun 1 Nov 2026, 10:00 Singapore

const baseEvent = (overrides = {}) => ({
  organiser_id: "org-1",
  status: "APPROVED",
  registration_required: true,
  expected_attendance: 100,
  event_date: "2026-12-05",
  start_time: "09:00",
  end_time: "17:00",
  registration_capacity: 80,
  registration_open_date: "2026-11-10",
  registration_open_time: "09:00",
  registration_close_date: "2026-12-01",
  registration_close_time: "17:00",
  ...overrides
});

const newSettings = {
  registration_capacity: 120,
  registration_open_date: "2026-11-12",
  registration_open_time: "10:00",
  registration_close_date: "2026-12-02",
  registration_close_time: "18:00"
};

const fixture = ({
  event = {},
  venues = { v1: { max_capacity: 100 }, v2: { max_capacity: 40 } },
  bookings = [
    { booking_id: "b1", venue_id: "v1", status: "APPROVED" },
    { booking_id: "b2", venue_id: "v2", status: "APPROVED" }
  ],
  registrations = [],
  now = NOW
} = {}) => {
  const stored = { e1: baseEvent(event) };
  let bookingsRead = null;
  const transaction = {
    updates: [],
    reads: [],
    async get(reference) {
      this.reads.push(reference.collectionName || reference.path);
      if (reference.collectionName === "registrations") {
        const docs = registrations
          .filter((item) => reference.filters.every(([field, value]) => item[field] === value))
          .map((item) => ({ data: () => item }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
      const event = reference.path.match(/^events\/(.+)$/);
      if (event) return { exists: Boolean(stored[event[1]]), data: () => stored[event[1]] };
      const venue = reference.path.match(/^venues\/(.+)$/);
      if (venue) return { exists: Boolean(venues[venue[1]]), data: () => venues[venue[1]] };
      throw new Error(`Unexpected transaction read ${reference.path}`);
    },
    update(reference, data) {
      this.updates.push({ reference, data });
      Object.assign(stored.e1, data);
    }
  };
  const firestore = {
    collection(name) {
      return {
        doc: (id) => ({ id, path: `${name}/${id}`, collectionName: name }),
        where(field, _operator, value) {
          const query = {
            collectionName: name,
            filters: [[field, value]],
            where(nextField, _nextOperator, nextValue) { query.filters.push([nextField, nextValue]); return query; }
          };
          return query;
        }
      };
    },
    runTransaction: async (callback) => callback(transaction)
  };
  const settings = createRegistrationSettings({
    firestore,
    serverTimestamp: () => ({ serverTimestamp: true }),
    getApprovedEventBookings: async ({ transaction: given, eventId }) => {
      assert.equal(eventId, "e1");
      bookingsRead = given;
      return bookings;
    },
    now: () => new Date(now)
  });
  return { settings, transaction, stored, bookingsReadIn: () => bookingsRead };
};

const refused = async (promise, statusCode, pattern) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
};

test("H1-TC27 AC2 saving stores the capacity and window, and the instants the rules compare against", async () => {
  const { settings, transaction, stored } = fixture();
  const result = await settings.save({ eventId: "e1", userId: "org-1", settings: newSettings });

  assert.equal(transaction.updates.length, 1);
  assert.equal(transaction.updates[0].reference.path, "events/e1");
  assert.deepEqual(Object.keys(transaction.updates[0].data).sort(), [
    "registration_capacity", "registration_close_date", "registration_close_time", "registration_closes_at",
    "registration_open_date", "registration_open_time", "registration_opens_at", "updated_at"
  ]);
  assert.equal(stored.e1.registration_capacity, 120);
  assert.deepEqual(stored.e1.registration_opens_at, new Date("2026-11-12T02:00:00Z"));
  assert.deepEqual(stored.e1.registration_closes_at, new Date("2026-12-02T10:00:00Z"));
  assert.deepEqual(stored.e1.updated_at, { serverTimestamp: true });
  assert.equal(result.phase, "SCHEDULED");
});

test("H1-TC28 AC2 saving touches nothing but the registration fields: status, organiser and coordinator stay as they were", async () => {
  const { settings, transaction } = fixture({ event: { coordinator_id: "coord-1" } });
  await settings.save({ eventId: "e1", userId: "org-1", settings: newSettings });
  const written = Object.keys(transaction.updates[0].data);
  ["status", "organiser_id", "coordinator_id", "expected_attendance", "event_date", "start_time"]
    .forEach((field) => assert.ok(!written.includes(field), `${field} must not be written`));
});

for (const status of ["APPROVED", "PLANNING", "SAFETY_REVIEW", "CONFIRMED"]) {
  test(`H1-TC29 AC1 an event in ${status} can have registration set up`, async () => {
    const { settings, transaction } = fixture({ event: { status } });
    await settings.save({ eventId: "e1", userId: "org-1", settings: newSettings });
    assert.equal(transaction.updates.length, 1);
  });
}

for (const status of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "COMPLETED", "CANCELLED", "REJECTED"]) {
  test(`H1-TC30 AC1 an event in ${status} is refused and nothing is written`, async () => {
    const { settings, transaction } = fixture({ event: { status } });
    await refused(settings.save({ eventId: "e1", userId: "org-1", settings: newSettings }), 409, /approved|completed, cancelled or rejected/i);
    assert.equal(transaction.updates.length, 0);
  });
}

test("H1-TC31 AC1 an event without the registration flag is refused and nothing is written", async () => {
  const { settings, transaction } = fixture({ event: { registration_required: false } });
  await refused(settings.save({ eventId: "e1", userId: "org-1", settings: newSettings }), 409, /does not use attendee registration/i);
  assert.equal(transaction.updates.length, 0);
});

test("H1-TC32 AC1 only the organiser who owns the event may load or save its registration", async () => {
  const { settings, transaction } = fixture();
  await refused(settings.save({ eventId: "e1", userId: "org-2", settings: newSettings }), 403, /your own events/i);
  await refused(settings.load({ eventId: "e1", userId: "org-2" }), 403, /your own events/i);
  assert.equal(transaction.updates.length, 0);
});

test("H1-TC33 AC1 an event that does not exist is a 404", async () => {
  const { settings } = fixture();
  await refused(settings.save({ eventId: "nope", userId: "org-1", settings: newSettings }), 404);
});

test("H1-TC34 AC2 a window that has not yet closed can be edited, even after it has opened", async () => {
  const { settings, stored } = fixture({ now: "2026-11-20T02:00:00Z" });
  await settings.save({
    eventId: "e1",
    userId: "org-1",
    settings: { ...newSettings, registration_open_date: "2026-11-10", registration_open_time: "09:00", registration_close_date: "2026-12-03" }
  });
  assert.equal(stored.e1.registration_close_date, "2026-12-03");
});

test("H1-TC35 AC2 once the window has closed nothing can be changed, and nothing is written", async () => {
  const { settings, transaction } = fixture({ now: "2026-12-01T09:00:00Z" });
  await refused(settings.save({ eventId: "e1", userId: "org-1", settings: newSettings }), 409, /has closed/i);
  assert.equal(transaction.updates.length, 0);
});

test("H1-TC36 AC3 a capacity above the combined venue capacity is refused with the limit, and nothing is written", async () => {
  const { settings, transaction } = fixture(); // 100 + 40 = 140
  await assert.rejects(
    settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 141 } }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.fields.registrationCapacity, "Registration capacity cannot exceed the venue capacity of 140.");
      return true;
    }
  );
  assert.equal(transaction.updates.length, 0);
});

test("H1-TC37 AC3 a capacity equal to the combined venue capacity is accepted", async () => {
  const { settings, stored } = fixture();
  await settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 140 } });
  assert.equal(stored.e1.registration_capacity, 140);
});

test("H1-TC38 AC3 the bookings are read inside the same transaction as the write, so the limit cannot go stale between check and save", async () => {
  const { settings, transaction, bookingsReadIn } = fixture();
  await settings.save({ eventId: "e1", userId: "org-1", settings: newSettings });
  assert.equal(bookingsReadIn(), transaction);
});

test("H1-TC39 AC3 only approved bookings set the limit: a pending booking for another venue adds nothing", async () => {
  const { settings } = fixture({
    bookings: [{ booking_id: "b1", venue_id: "v1", status: "APPROVED" }, { booking_id: "b2", venue_id: "v2", status: "PENDING" }]
  });
  await assert.rejects(
    settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 101 } }),
    (error) => error.statusCode === 422 && /venue capacity of 100/.test(error.fields.registrationCapacity)
  );
});

test("H1-TC40 AC3 with no approved venue booking the capacity cannot change, but the window can", async () => {
  const { settings, stored } = fixture({ bookings: [] });
  await assert.rejects(
    settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 90 } }),
    (error) => error.statusCode === 422 && error.fields.registrationCapacity === "Capacity can be set once a venue booking has been approved."
  );
  await settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 80 } });
  assert.equal(stored.e1.registration_capacity, 80);
  assert.equal(stored.e1.registration_open_date, "2026-11-12");
});

test("H1-TC41 AC2 an invalid window is refused with every problem named, and nothing is written", async () => {
  const { settings, transaction } = fixture();
  await assert.rejects(
    settings.save({
      eventId: "e1",
      userId: "org-1",
      settings: { ...newSettings, registration_capacity: 0, registration_close_date: "2026-11-01", registration_close_time: "09:00" }
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.deepEqual(Object.keys(error.fields).sort(), ["registrationCapacity", "registrationCloseDate"]);
      return true;
    }
  );
  assert.equal(transaction.updates.length, 0);
});

test("H1-TC42 AC2 AC3 load gives the screen the saved values, the venue limit, the phase and whether it can be edited", async () => {
  const { settings } = fixture();
  assert.deepEqual(await settings.load({ eventId: "e1", userId: "org-1" }), {
    settings: {
      registration_capacity: 80,
      registration_open_date: "2026-11-10",
      registration_open_time: "09:00",
      registration_close_date: "2026-12-01",
      registration_close_time: "17:00"
    },
    venue_capacity: 140,
    registered_count: 0,
    phase: "SCHEDULED",
    editable: true,
    refusal: null
  });
});

test("H1-TC43 AC1 AC2 load of an event that cannot be edited says why: not approved yet, flag off, or closed", async () => {
  const cases = [
    [{ status: "SUBMITTED" }, NOW, "status"],
    [{ registration_required: false }, NOW, "flag_off"],
    [{}, "2026-12-02T00:00:00Z", "closed"]
  ];
  for (const [event, now, reason] of cases) {
    const { settings } = fixture({ event, now });
    const loaded = await settings.load({ eventId: "e1", userId: "org-1" });
    assert.equal(loaded.editable, false);
    assert.equal(loaded.refusal.reason, reason);
    assert.equal(typeof loaded.refusal.message, "string");
  }
});

test("H1-TC44 AC3 load reports no venue limit while no booking is approved", async () => {
  const { settings } = fixture({ bookings: [] });
  const loaded = await settings.load({ eventId: "e1", userId: "org-1" });
  assert.equal(loaded.venue_capacity, null);
  assert.equal(loaded.editable, true);
});

const registered = (count, eventId = "e1", status = "REGISTERED") =>
  Array.from({ length: count }, (_, index) => ({ event_id: eventId, status, attendee_id: `a-${status}-${eventId}-${index}` }));

test("H1-TC58 AC5 a capacity below the number registered is refused with the count, and nothing is written", async () => {
  const { settings, transaction } = fixture({ registrations: registered(90) });
  await assert.rejects(
    settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 89 } }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.fields.registrationCapacity, "Registration capacity cannot be less than the 90 people already registered.");
      return true;
    }
  );
  assert.equal(transaction.updates.length, 0);
});

test("H1-TC59 AC5 a capacity equal to the number registered is accepted", async () => {
  const { settings, stored } = fixture({ registrations: registered(90) });
  await settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 90 } });
  assert.equal(stored.e1.registration_capacity, 90);
});

test("H1-TC60 AC5 only REGISTERED attendees of this event count: waitlisted, withdrawn, cancelled and other events' registrations do not", async () => {
  const { settings, stored } = fixture({
    registrations: [
      ...registered(5),
      ...registered(20, "e1", "WAITLISTED"),
      ...registered(10, "e1", "WITHDRAWN"),
      ...registered(3, "e1", "CANCELLED"),
      ...registered(50, "e2")
    ]
  });
  await assert.rejects(
    settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 4 } }),
    (error) => error.statusCode === 422 && error.fields.registrationCapacity === "Registration capacity cannot be less than the 5 people already registered."
  );
  await settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 5 } });
  assert.equal(stored.e1.registration_capacity, 5);
});

test("H1-TC61 AC5 the registrations are counted inside the same transaction as the write, so a registration landing mid-save cannot slip past", async () => {
  const { settings, transaction } = fixture({ registrations: registered(3) });
  await settings.save({ eventId: "e1", userId: "org-1", settings: newSettings });
  assert.ok(transaction.reads.includes("registrations"), "registrations must be read through the transaction");
});

test("H1-TC62 AC5 a refused save for being under the registered count names every other problem too", async () => {
  const { settings } = fixture({ registrations: registered(90) });
  await assert.rejects(
    settings.save({ eventId: "e1", userId: "org-1", settings: { ...newSettings, registration_capacity: 10, registration_close_date: "2026-11-01", registration_close_time: "09:00" } }),
    (error) => error.statusCode === 422 && Object.keys(error.fields).sort().join() === "registrationCapacity,registrationCloseDate"
  );
});

test("H1-TC63 AC5 load tells the screen how many are registered, counting only REGISTERED", async () => {
  const { settings } = fixture({ registrations: [...registered(12), ...registered(4, "e1", "WAITLISTED")] });
  const loaded = await settings.load({ eventId: "e1", userId: "org-1" });
  assert.equal(loaded.registered_count, 12);
});
