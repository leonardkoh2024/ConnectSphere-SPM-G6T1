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

test("TC-0842 creates a venue unavailability period with its venue, dates, reason and actor", async () => {
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

test("TC-0843 allows assigned staff when the assignment document ID differs from the venue ID", async () => {
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

test("TC-0844 asks for confirmation before a period overlaps an approved booking", async () => {
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

test("TC-0845 a confirmed period is saved, the booking is marked for replacement, and the coordinator is notified", async () => {
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
  // Same unread shape as every other notice, so it counts as unread in the inbox.
  assert.equal(notice[1].is_read, false);
  assert.equal(notice[1].read_at, null);
});

test("TC-0846 allows touching periods and ignores non-approved bookings", async () => {
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

test("TC-0847 refuses an unassigned staff user", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-2", keepPeriodIds: [], additions: [] }), VenueAssignmentError);
});

test("TC-0848 allows multiple blocking periods for the same venue", async () => {
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

test("TC-0849 staged releases delete periods only when saved by assigned staff", async () => {
  const firestore = fakeFirestore(seedAssignedVenue({
    "venue_unavailability/block-1": { venue_id: "VEN-001", reason: "Maintenance" }
  }));
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-2", keepPeriodIds: [], additions: [] }), VenueAssignmentError);
  assert.ok(firestore.store["venue_unavailability/block-1"]);

  await save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], additions: [] });
  assert.equal(firestore.store["venue_unavailability/block-1"], undefined);
});

test("TC-0850 rejects stale release IDs instead of deleting an unrelated period", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: ["missing"], additions: [] }), UnavailabilityNotFoundError);
});

test("TC-0851 requires the end of a period to follow its start", async () => {
  const firestore = fakeFirestore(seedAssignedVenue());
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });

  await assert.rejects(save({
    venueId: "VEN-001",
    userId: "staff-1",
    keepPeriodIds: [],
    additions: [{ startDateTime: periodInput.startDateTime, endDateTime: periodInput.startDateTime, reason: periodInput.reason }]
  }), TypeError);
});

const addition = (changes = {}) => ({
  startDateTime: periodInput.startDateTime, endDateTime: periodInput.endDateTime, reason: periodInput.reason, ...changes
});
const saveWith = (seed) => {
  const firestore = fakeFirestore(seed);
  return { firestore, save: createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" }) };
};
const savedNotices = (store) => Object.entries(store).filter(([path]) => path.startsWith("notifications/")).map(([, data]) => data);
const savedHistory = (store) => Object.entries(store).filter(([path]) => path.startsWith("event_history/")).map(([, data]) => data);

test("TC-0594 [failure] E3 rejects malformed lists, a missing reason and unreadable dates before touching Firestore", async () => {
  const { firestore, save } = saveWith(seedAssignedVenue());
  const base = { venueId: "VEN-001", userId: "staff-1" };
  await assert.rejects(save({ ...base, keepPeriodIds: "p1", additions: [] }), { name: "TypeError", message: "Period IDs to keep must be a list of strings." });
  await assert.rejects(save({ ...base, keepPeriodIds: [42], additions: [] }), { name: "TypeError", message: "Period IDs to keep must be a list of strings." });
  await assert.rejects(save({ ...base, keepPeriodIds: [], additions: null }), { name: "TypeError", message: "New periods must be a list." });
  await assert.rejects(save({ ...base, keepPeriodIds: [], additions: [addition({ reason: "   " })] }), { message: "A reason is required." });
  await assert.rejects(save({ ...base, keepPeriodIds: [], additions: [addition({ reason: undefined })] }), { message: "A reason is required." });
  for (const startDateTime of [null, "", "not a date"]) {
    await assert.rejects(save({ ...base, keepPeriodIds: [], additions: [addition({ startDateTime })] }), TypeError);
  }
  await assert.rejects(save({ ...base, keepPeriodIds: [], additions: [addition({ endDateTime: undefined })] }), TypeError);
  assert.deepEqual(Object.keys(firestore.store).sort(), Object.keys(seedAssignedVenue()).sort());
});

test("TC-0595 [failure] E3 an unknown venue is refused", async () => {
  const { save } = saveWith({ "venue_staff/VEN-404": { venue_id: "VEN-404", user_id: "staff-1" } });
  await assert.rejects(save({ venueId: "VEN-404", userId: "staff-1", keepPeriodIds: [], additions: [] }), {
    name: "VenueNotFoundError", message: "Venue VEN-404 was not found."
  });
});

test("TC-0596 [normal] E3 kept periods survive, a note is stored trimmed, and Timestamp-like dates are read", async () => {
  const { firestore, save } = saveWith(seedAssignedVenue({
    "venue_unavailability/keep": { venue_id: "VEN-001", reason: "Renovation" },
    "venue_unavailability/drop": { venue_id: "VEN-001", reason: "Old" }
  }));
  const result = await save({
    venueId: "VEN-001", userId: "staff-1", keepPeriodIds: ["keep"],
    additions: [addition({ startDateTime: { toDate: () => new Date("2026-10-14T01:00:00Z") }, endDateTime: new Date("2026-10-14T02:00:00Z"), reason: "  Deep clean ", note: "  Bring keys " })]
  });
  assert.deepEqual(result.periods.map((period) => period.reason), ["Renovation", "Deep clean"]);
  assert.equal(result.periods[1].note, "Bring keys");
  assert.ok(firestore.store["venue_unavailability/keep"]);
  assert.equal(firestore.store["venue_unavailability/drop"], undefined);
});

test("TC-0852 [normal] E11/F11 a Confirmed event loses its approved booking, returns to Planning and needs a new safety check", async () => {
  const { firestore, save } = saveWith(seedAssignedVenue({
    "venue_bookings/book-1": {
      venue_id: "VEN-001", status: "approved", event_id: "EVT-1", event_name: "Gala",
      occupied_start: new Date("2026-10-12T08:00:00Z"), occupied_end: new Date("2026-10-12T10:00:00Z")
    },
    "events/EVT-1": { coordinator_id: "coord-now", status: "Confirmed", approved_venue_booking_id: "book-1", last_safety_review_id: "SR-1" }
  }));
  await save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], confirmOverlaps: true, additions: [addition()] });

  const event = firestore.store["events/EVT-1"];
  assert.equal(event.status, "PLANNING");
  assert.equal(event.approved_venue_booking_id, null);
  assert.equal(event.last_safety_review_id, null);
  assert.equal(event.safety_review_required, true);
  assert.equal(firestore.store["venue_bookings/book-1"].status, "approved", "the booking is flagged, never cancelled");
  assert.equal(firestore.store["venue_bookings/book-1"].replacement_needed, true);
  assert.match(savedHistory(firestore.store)[0].description, /^Gala needs a replacement: Electrical maintenance$/);
  assert.equal(savedNotices(firestore.store)[0].user_id, "coord-now");
  assert.match(savedNotices(firestore.store)[0].message, /^Hall A is unavailable/);
});

test("TC-0853 [boundary] E11 a booking with no event notifies its requester and writes no event history", async () => {
  const { firestore, save } = saveWith({
    "venues/VEN-001": {},
    "venue_staff/VEN-001": { venue_id: "VEN-001", user_id: "staff-1" },
    "venue_bookings/orphan": {
      venue_id: "VEN-001", status: "APPROVED", requested_by: "requester-1",
      start_datetime: "2026-10-12T10:00:00.000Z", end_datetime: "2026-10-12T11:00:00.000Z"
    }
  });
  await assert.rejects(save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], additions: [addition()] }), (error) => {
    assert.deepEqual(error.affected, [{ booking_id: "orphan", label: "orphan", event_id: null }]);
    return true;
  });
  await save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], confirmOverlaps: true, additions: [addition()] });
  assert.deepEqual(savedHistory(firestore.store), []);
  const [notice] = savedNotices(firestore.store);
  assert.equal(notice.user_id, "requester-1");
  assert.equal(notice.event_id, null);
  assert.match(notice.message, /^VEN-001 is unavailable/, "a venue with no name is named by its id");
});

test("TC-0854 [boundary] E11 an event with no coordinator gets history but no notice; bookings without times or status are ignored", async () => {
  const { firestore, save } = saveWith(seedAssignedVenue({
    "venue_bookings/flagged": {
      venue_id: "VEN-001", status: "APPROVED", event_id: "EVT-2", booking_id: "BK-2",
      start_datetime: new Date("2026-10-12T09:30:00Z"), end_datetime: new Date("2026-10-12T10:30:00Z")
    },
    "venue_bookings/untimed": { venue_id: "VEN-001", status: "APPROVED", event_id: "EVT-3" },
    "venue_bookings/nostatus": { venue_id: "VEN-001", start_datetime: new Date("2026-10-12T09:30:00Z"), end_datetime: new Date("2026-10-12T10:30:00Z") },
    "events/EVT-2": { name: "Event with no status or coordinator" }
  }));
  await save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], confirmOverlaps: true, additions: [addition()] });
  assert.equal(savedHistory(firestore.store).length, 1);
  assert.match(savedHistory(firestore.store)[0].description, /^BK-2 needs/);
  assert.deepEqual(savedNotices(firestore.store), []);
  assert.equal(firestore.store["events/EVT-2"].status, undefined, "only a Confirmed event is moved back to Planning");
  assert.equal(firestore.store["venue_bookings/untimed"].replacement_needed, undefined);
});

test("TC-0855 [conflict] E11 one booking overlapping two new periods is flagged once, against the period it overlaps", async () => {
  const { firestore, save } = saveWith(seedAssignedVenue({
    "venue_bookings/book-1": {
      venue_id: "VEN-001", status: "APPROVED", event_id: "EVT-1",
      start_datetime: new Date("2026-10-12T13:00:00Z"), end_datetime: new Date("2026-10-12T15:00:00Z")
    },
    "events/EVT-1": { coordinator_id: "coord-1", status: "PLANNING" }
  }));
  await save({
    venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], confirmOverlaps: true,
    additions: [
      addition({ startDateTime: "2026-10-12T08:00:00Z", endDateTime: "2026-10-12T09:00:00Z", reason: "Elsewhere" }),
      addition({ startDateTime: "2026-10-12T12:00:00Z", endDateTime: "2026-10-12T14:00:00Z", reason: "Leak" }),
      addition({ startDateTime: "2026-10-12T14:00:00Z", endDateTime: "2026-10-12T16:00:00Z", reason: "Repair" })
    ]
  });
  assert.equal(firestore.store["venue_bookings/book-1"].replacement_reason, "Leak");
  assert.equal(savedNotices(firestore.store).length, 1);
});

test("TC-0856 [boundary] E11 refs on real Firestore snapshots are used when present", async () => {
  const firestore = fakeFirestore(seedAssignedVenue({
    "venue_unavailability/drop": { venue_id: "VEN-001", reason: "Old" },
    "venue_bookings/book-1": {
      venue_id: "VEN-001", status: "APPROVED", event_id: "EVT-1",
      start_datetime: new Date("2026-10-12T10:00:00Z"), end_datetime: new Date("2026-10-12T11:00:00Z")
    },
    "events/EVT-1": { coordinator_id: "coord-1", status: "CONFIRMED" }
  }));
  const deleted = [];
  firestore.runTransaction = (operation) => {
    const transaction = new FakeTransaction(firestore.store);
    const get = transaction.get.bind(transaction);
    transaction.get = async (reference) => {
      const snapshot = await get(reference);
      if (snapshot.docs) {
        // A snapshot without a ref falls back to a reference built from its id.
        if (reference.collection === "venue_unavailability") snapshot.docs.forEach((item) => { delete item.ref; });
        return snapshot;
      }
      return { ...snapshot, ref: { path: reference.path } };
    };
    const remove = transaction.delete.bind(transaction);
    transaction.delete = (reference) => { deleted.push(reference.path); remove(reference); };
    return operation(transaction);
  };
  const save = createSaveVenueUnavailability({ firestore, serverTimestamp: () => "STAMP" });
  await save({ venueId: "VEN-001", userId: "staff-1", keepPeriodIds: [], confirmOverlaps: true, additions: [addition()] });
  assert.deepEqual(deleted, ["venue_unavailability/drop"]);
  assert.equal(firestore.store["events/EVT-1"].status, "PLANNING");
});