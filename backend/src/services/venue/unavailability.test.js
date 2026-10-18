import test from "node:test";
import assert from "node:assert/strict";

import {
  ConfirmationRequiredError,
  createSaveVenueUnavailability,
  VenueAssignmentError,
  UnavailabilityNotFoundError
} from "./unavailability.js";

class FakeDocRef {
  constructor(store, collection, id) {
    this.store = store;
    this.collection = collection;
    this.id = id;
    this.path = `${collection}/${id}`;
  }
}

class FakeQueryRef {
  constructor(store, collection, filters = []) {
    this.store = store;
    this.collection = collection;
    this.filters = filters;
  }
  where(field, operator, value) {
    return new FakeQueryRef(this.store, this.collection, [...this.filters, [field, operator, value]]);
  }
}

class FakeCollectionRef {
  constructor(store, name) {
    this.store = store;
    this.name = name;
  }
  doc(id = `generated-${Object.keys(this.store).length}`) {
    return new FakeDocRef(this.store, this.name, id);
  }
  where(field, operator, value) {
    return new FakeQueryRef(this.store, this.name).where(field, operator, value);
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
  }
  async get(reference) {
    if (reference instanceof FakeQueryRef) {
      const docs = Object.entries(this.store)
        .filter(([path]) => path.startsWith(`${reference.collection}/`))
        .filter(([, data]) => reference.filters.every(([field, operator, value]) => operator === "==" && data[field] === value))
        .map(([path, data]) => ({
          id: path.split("/")[1],
          ref: { path },
          data: () => data
        }));
      return { docs };
    }
    const data = this.store[reference.path];
    return { exists: data !== undefined, data: () => data };
  }
  set(reference, data) {
    this.store[reference.path] = data;
  }
  update(reference, data) {
    this.store[reference.path] = { ...this.store[reference.path], ...data };
  }
  delete(reference) {
    delete this.store[reference.path];
  }
}

const fakeFirestore = (seed = {}) => {
  const store = { ...seed };
  return {
    store,
    collection: (name) => new FakeCollectionRef(store, name),
    runTransaction: (operation) => operation(new FakeTransaction(store))
  };
};

const periodInput = {
  venueId: "VEN-001",
  userId: "staff-1",
  startDateTime: "2026-10-12T09:00:00.000Z",
  endDateTime: "2026-10-12T12:00:00.000Z",
  reason: "Electrical maintenance"
};

const seedAssignedVenue = (additional = {}) => ({
  "venues/VEN-001": { name: "Hall A" },
  "venue_staff/VEN-001": { venue_id: "VEN-001", user_id: "staff-1" },
  ...additional
});

test("creates a venue unavailability period with its venue, dates, reason and actor", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  const result = await save({
    venueId: periodInput.venueId,
    userId: periodInput.userId,
    keepPeriodIds: [],
    additions: [{ startDateTime: periodInput.startDateTime, endDateTime: periodInput.endDateTime, reason: periodInput.reason }]
  });
  const period = result.periods[0];

  assert.equal(period.venue_id, "VEN-001");
  assert.equal(period.start_datetime.toISOString(), "2026-10-12T09:00:00.000Z");
  assert.equal(period.end_datetime.toISOString(), "2026-10-12T12:00:00.000Z");
  assert.equal(period.reason, "Electrical maintenance");
  assert.equal(period.created_by, "staff-1");
  assert.equal(period.created_at, "STAMP");
  assert.deepEqual(firestore.store[`venue_unavailability/${period.id}`], {
    venue_id: "VEN-001",
    start_datetime: new Date("2026-10-12T09:00:00.000Z"),
    end_datetime: new Date("2026-10-12T12:00:00.000Z"),
    reason: "Electrical maintenance",
    created_by: "staff-1",
    created_at: "STAMP"
  });
});

test("allows assigned staff when the assignment document ID differs from the venue ID", async () => {
  const firestore = fakeFirestore({
    "venues/VEN-001": { name: "Hall A" },
    "venue_staff/auto-generated-assignment": { venue_id: "VEN-001", user_id: "staff-1" }
  });
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.doesNotReject(() => save({
    venueId: "VEN-001",
    userId: "staff-1",
    keepPeriodIds: [],
    additions: []
  }));
});

test("asks for confirmation before a period overlaps an approved booking", async () => {
  const firestore = fakeFirestore(seedAssignedVenue({
    "venue_bookings/book-42": {
      venue_id: "VEN-001",
      status: "APPROVED",
      reference_no: "BK-042",
      event_id: "EVT-001",
      start_datetime: new Date("2026-10-12T11:00:00.000Z"),
      end_datetime: new Date("2026-10-12T13:00:00.000Z")
    },
    "events/EVT-001": { coordinator_id: "coordinator-1", status: "PLANNING" }
  }));
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], additions: [{ startDateTime: periodInput.startDateTime, endDateTime: periodInput.endDateTime, reason: periodInput.reason }] }), (error) => {
    assert.ok(error instanceof ConfirmationRequiredError);
    assert.equal(error.affected[0].label, "BK-042");
    return true;
  });
  assert.equal(Object.keys(firestore.store).some((path) => path.startsWith("venue_unavailability/")), false);
});

test("a confirmed period is saved, the booking is marked for replacement, and the coordinator is notified", async () => {
  const firestore = fakeFirestore(seedAssignedVenue({
    "venue_bookings/book-42": {
      venue_id: "VEN-001",
      status: "APPROVED",
      reference_no: "BK-042",
      event_id: "EVT-001",
      start_datetime: new Date("2026-10-12T11:00:00.000Z"),
      end_datetime: new Date("2026-10-12T13:00:00.000Z")
    },
    "events/EVT-001": { coordinator_id: "coordinator-1", status: "PLANNING" }
  }));
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  const result = await save({
    venueId: "VEN-001",
    userId: "staff-1",
    keepPeriodIds: [],
    confirmOverlaps: true,
    additions: [{ startDateTime: periodInput.startDateTime, endDateTime: periodInput.endDateTime, reason: "Maintenance" }]
  });

  assert.equal(result.periods[0].reason, "Maintenance");
  assert.equal(firestore.store["venue_bookings/book-42"].status, "APPROVED");
  assert.equal(firestore.store["venue_bookings/book-42"].replacement_status, "Venue unavailable - replacement needed");
  assert.equal(firestore.store["events/EVT-001"].status, "PLANNING");
  const notice = Object.entries(firestore.store).find(([path]) => path.startsWith("notifications/"));
  assert.equal(notice[1].user_id, "coordinator-1");
  assert.equal(notice[1].event_id, "EVT-001");
  assert.equal(notice[1].reason, "Maintenance");
});

test("allows touching periods and ignores non-approved bookings", async () => {
  const firestore = fakeFirestore(seedAssignedVenue({
    "venue_bookings/pending": {
      venue_id: "VEN-001",
      status: "PENDING",
      start_datetime: new Date("2026-10-12T10:00:00.000Z"),
      end_datetime: new Date("2026-10-12T11:00:00.000Z")
    },
    "venue_bookings/touching": {
      venue_id: "VEN-001",
      status: "APPROVED",
      start_datetime: new Date("2026-10-12T12:00:00.000Z"),
      end_datetime: new Date("2026-10-12T13:00:00.000Z")
    }
  }));
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.doesNotReject(() => save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], additions: [{ startDateTime: periodInput.startDateTime, endDateTime: periodInput.endDateTime, reason: periodInput.reason }] }));
});

test("refuses an unassigned staff user", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-2", keepPeriodIds: [], additions: [] }), VenueAssignmentError);
});

test("allows multiple blocking periods for the same venue", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await save({
    venueId: "VEN-001",
    userId: "staff-1",
    keepPeriodIds: [],
    additions: [
      { startDateTime: periodInput.startDateTime, endDateTime: periodInput.endDateTime, reason: periodInput.reason },
      { startDateTime: "2026-10-13T09:00:00.000Z", endDateTime: "2026-10-13T12:00:00.000Z", reason: "Floor repairs" }
    ]
  });

  assert.equal(Object.keys(firestore.store).filter((path) => path.startsWith("venue_unavailability/")).length, 2);
});

test("staged releases delete periods only when saved by assigned staff", async () => {
  const firestore = fakeFirestore(seedAssignedVenue({
    "venue_unavailability/block-1": { venue_id: "VEN-001", reason: "Maintenance" }
  }));
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-2", keepPeriodIds: [], additions: [] }), VenueAssignmentError);
  assert.ok(firestore.store["venue_unavailability/block-1"]);

  await save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], additions: [] });
  assert.equal(firestore.store["venue_unavailability/block-1"], undefined);
});

test("rejects stale release IDs instead of deleting an unrelated period", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: ["missing"], additions: [] }), UnavailabilityNotFoundError);
});

test("requires the end of a period to follow its start", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({
    venueId: "VEN-001",
    userId: "staff-1",
    keepPeriodIds: [],
    additions: [{ startDateTime: periodInput.startDateTime, endDateTime: periodInput.startDateTime, reason: periodInput.reason }]
  }), TypeError);
});