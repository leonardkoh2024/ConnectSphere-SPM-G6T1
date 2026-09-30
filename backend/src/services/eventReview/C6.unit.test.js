// C6 — Approve a submitted request. Unit tests (TDD "Red").
//
// Runs against a small in-memory fake of the Firestore calls the service makes
// (collection().doc(), runTransaction with get/update/set) — no emulator, no
// credentials. Same pattern as C1's assignCoordinator.test.js.
//
// Written from C6's acceptance criteria BEFORE the implementation, so they FAIL
// until backend/src/services/eventReview/approveRequest.js exists and is built
// to satisfy them (Red -> Green -> Refactor).
//
//   node --test backend/src/services/eventReview/C6.unit.test.js
//
// C6 ACs:
//   AC1 approve offered only from Under Review
//   AC2 on approval, status -> Approved and decision + deciding coordinator + timestamp (SGT) recorded
//   AC3 only the coordinator assigned to the event may approve
//   AC4 approve unavailable while a clarification request is open (see C4)
//   AC5 the approval is recorded in the event's history
//   (D3 owns the venue/technical "confirm" gate — deliberately NOT tested here.)

import test from "node:test";
import assert from "node:assert/strict";

import {
  createApproveRequest,
  EventNotFoundError,
  NotUnderReviewError,
  NotAssignedCoordinatorError,
  ClarificationOpenError,
} from "./approveRequest.js";

// --- in-memory fake Firestore ------------------------------------------------
class FakeDocRef {
  constructor(store, path) { this.store = store; this.path = path; }
}
class FakeCollectionRef {
  constructor(store, name) { this.store = store; this.name = name; }
  doc(id) { return new FakeDocRef(this.store, `${this.name}/${id}`); }
}
class FakeTransaction {
  constructor(store) { this.store = store; }
  async get(ref) {
    if (ref instanceof FakeCollectionRef) {
      const docs = Object.entries(this.store)
        .filter(([path]) => path.startsWith(`${ref.name}/`))
        .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }));
      return { docs };
    }
    const data = this.store[ref.path];
    return { exists: data !== undefined, data: () => data };
  }
  update(ref, data) { this.store[ref.path] = { ...this.store[ref.path], ...data }; }
  set(ref, data, options) {
    this.store[ref.path] = options?.merge ? { ...this.store[ref.path], ...data } : data;
  }
}
function fakeFirestore(seed = {}) {
  const store = { ...seed };
  return {
    store,
    collection: (name) => new FakeCollectionRef(store, name),
    runTransaction: (fn) => fn(new FakeTransaction(store)),
  };
}

// --- fixtures ----------------------------------------------------------------
const STAMP = "STAMP";
const makeService = (firestore) =>
  createApproveRequest({ firestore, serverTimestamp: () => STAMP, newId: () => "hist-1" });

const seedEvent = (id, overrides = {}) => ({
  [`events/${id}`]: { status: "Under Review", coordinator_id: "c1", ...overrides },
});
const seedClarification = (id, eventId, status) => ({
  [`clarification_requests/${id}`]: { event_id: eventId, status },
});

// --- C6-TC1 (AC2, happy path): a valid approval records the decision ----------
test("C6-TC1 approving an Under Review event by its assigned coordinator records the decision", async () => {
  const firestore = fakeFirestore({ ...seedEvent("e1") });
  const approveRequest = makeService(firestore);

  const result = await approveRequest("e1", "c1");

  assert.equal(result.approved, true);
  const event = firestore.store["events/e1"];
  assert.equal(event.status, "Approved");
  assert.equal(event.deciding_coordinator_id, "c1");
  assert.equal(event.decided_at, STAMP);
});

// --- C6-TC2 (AC1): approve only from Under Review ----------------------------
test("C6-TC2 approve is rejected from any status other than Under Review", async () => {
  for (const status of ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"]) {
    const firestore = fakeFirestore({ ...seedEvent("e1", { status }) });
    const approveRequest = makeService(firestore);
    await assert.rejects(() => approveRequest("e1", "c1"), NotUnderReviewError, `status=${status}`);
    assert.equal(firestore.store["events/e1"].status, status, "status unchanged");
  }
});

// --- C6-TC3 (AC3): the assigned coordinator may approve ----------------------
test("C6-TC3 the assigned coordinator can approve", async () => {
  const firestore = fakeFirestore({ ...seedEvent("e1", { coordinator_id: "c1" }) });
  const approveRequest = makeService(firestore);
  const result = await approveRequest("e1", "c1");
  assert.equal(result.approved, true);
});

// --- C6-TC4 (AC3): a non-assigned coordinator may not approve ----------------
test("C6-TC4 a coordinator not assigned to the event cannot approve", async () => {
  const firestore = fakeFirestore({ ...seedEvent("e1", { coordinator_id: "c1" }) });
  const approveRequest = makeService(firestore);
  await assert.rejects(() => approveRequest("e1", "c2"), NotAssignedCoordinatorError);
  assert.equal(firestore.store["events/e1"].status, "Under Review", "status unchanged");
});

// --- C6-TC5 (AC4): blocked while a clarification request is open -------------
test("C6-TC5 approve is blocked while a clarification request is open", async () => {
  const firestore = fakeFirestore({
    ...seedEvent("e1"),
    ...seedClarification("clr1", "e1", "Open"),
  });
  const approveRequest = makeService(firestore);
  await assert.rejects(() => approveRequest("e1", "c1"), ClarificationOpenError);
  assert.equal(firestore.store["events/e1"].status, "Under Review", "status unchanged");
});

// --- C6-TC6 (AC4): available again once the clarification is closed ----------
test("C6-TC6 approve succeeds once the clarification is closed", async () => {
  const firestore = fakeFirestore({
    ...seedEvent("e1"),
    ...seedClarification("clr1", "e1", "Closed"),
  });
  const approveRequest = makeService(firestore);
  const result = await approveRequest("e1", "c1");
  assert.equal(result.approved, true);
  assert.equal(firestore.store["events/e1"].status, "Approved");
});

// --- C6-TC7 (AC5): the approval is recorded in the event's history -----------
test("C6-TC7 approving writes an entry to the event's history", async () => {
  const firestore = fakeFirestore({ ...seedEvent("e1") });
  const approveRequest = makeService(firestore);

  await approveRequest("e1", "c1");

  const history = firestore.store["event_history/hist-1"];
  assert.ok(history, "a history entry was written");
  assert.equal(history.event_id, "e1");
  assert.equal(history.new_value, "Approved");
  assert.equal(history.actor_id, "c1");
  assert.equal(history.created_at, STAMP);
});

// --- C6-TC8 (AC1/AC2): re-approving does not re-decide (idempotency) ---------
test("C6-TC8 re-approving an already-approved event is rejected and does not re-decide", async () => {
  const firestore = fakeFirestore({ ...seedEvent("e1") });
  const approveRequest = makeService(firestore);

  await approveRequest("e1", "c1");
  const firstDecidedAt = firestore.store["events/e1"].decided_at;

  // Now Approved (not Under Review), so a second attempt is rejected by AC1.
  await assert.rejects(() => approveRequest("e1", "c1"), NotUnderReviewError);
  assert.equal(firestore.store["events/e1"].decided_at, firstDecidedAt, "decision unchanged");
});

// --- C6-TC9 (guard): an unknown event id is reported -------------------------
test("C6-TC9 an unknown event id is reported rather than silently ignored", async () => {
  const firestore = fakeFirestore({});
  const approveRequest = makeService(firestore);
  await assert.rejects(() => approveRequest("missing", "c1"), EventNotFoundError);
});
