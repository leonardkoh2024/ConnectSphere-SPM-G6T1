// TC-072, TC-076, TC-077, TC-078, TC-079 — the transactional wiring around the
// rotation decision (which TC-073/074/075 already cover as plain values in
// frontend/src/domain/coordinatorAssignment.test.js).
//
// Run against a small in-memory fake of the two Firestore calls this module
// makes (collection().doc(), runTransaction with get/update/set), not the
// Firestore emulator — this repo has deliberately not added one (no Java
// runtime; see frontend/src/security/firestoreRules.test.js). A transaction is
// still the right tool for the real deployment; what a fake cannot prove is
// that two requests racing over the network truly serialise rather than being
// modelled as sequential calls, which is what a transaction guarantees but
// only a real Firestore instance can demonstrate.

import test from "node:test";
import assert from "node:assert/strict";

import { createAssignCoordinator, EventNotFoundError } from "./assignCoordinator.js";

class FakeDocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
  }
}

class FakeCollectionRef {
  constructor(store, name) {
    this.store = store;
    this.name = name;
  }
  doc(id) {
    return new FakeDocRef(this.store, `${this.name}/${id}`);
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
  }
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
  update(ref, data) {
    this.store[ref.path] = { ...this.store[ref.path], ...data };
  }
  set(ref, data, options) {
    this.store[ref.path] = options?.merge ? { ...this.store[ref.path], ...data } : data;
  }
}

function fakeFirestore(seed = {}) {
  const store = { ...seed };
  return {
    store,
    collection: (name) => new FakeCollectionRef(store, name),
    runTransaction: (fn) => fn(new FakeTransaction(store))
  };
}

const seedCoordinators = () => ({
  "coordinators/c1": { coordinator_seq: 1 },
  "coordinators/c2": { coordinator_seq: 2 },
  "coordinators/c3": { coordinator_seq: 3 }
});

const seedEvent = (id, overrides = {}) => ({ [`events/${id}`]: { status: "SUBMITTED", coordinator_id: null, ...overrides } });

const STAMP = "STAMP";

test("TC-072 a valid submission produces a well-formed assignment", async () => {
  const firestore = fakeFirestore({ ...seedCoordinators(), ...seedEvent("e1") });
  const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp: () => STAMP });

  const result = await assignCoordinator("e1");

  assert.equal(result.alreadyAssigned, false);
  assert.ok(["c1", "c2", "c3"].includes(result.coordinatorId));
  const event = firestore.store["events/e1"];
  assert.equal(event.coordinator_id, result.coordinatorId);
  assert.equal(event.assigned_at, STAMP);
  assert.equal(event.status, "SUBMITTED");
});

test("TC-076 an event is never assigned to two coordinators", async () => {
  const firestore = fakeFirestore({ ...seedCoordinators(), ...seedEvent("e1", { coordinator_id: "c1", assigned_at: "earlier" }) });
  const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp: () => STAMP });

  const result = await assignCoordinator("e1");

  assert.equal(result.alreadyAssigned, true);
  assert.equal(result.coordinatorId, "c1");
  assert.equal(firestore.store["events/e1"].coordinator_id, "c1");
  assert.equal(firestore.store["events/e1"].assigned_at, "earlier", "the original assignment is untouched");
});

test("TC-077 sequential submissions each get exactly one, distinct coordinator", async () => {
  const firestore = fakeFirestore({ ...seedCoordinators(), ...seedEvent("e1"), ...seedEvent("e2") });
  const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp: () => STAMP });

  const [r1, r2] = [await assignCoordinator("e1"), await assignCoordinator("e2")];

  assert.notEqual(r1.coordinatorId, r2.coordinatorId);
  assert.equal(firestore.store["assignment_cursor/default"].last_assigned_seq, 2, "the cursor advances once per assignment, not once per attempt");
});

test("TC-078 assignment timestamp recorded alongside coordinator_id", async () => {
  const firestore = fakeFirestore({ "coordinators/c1": { coordinator_seq: 1 }, ...seedEvent("e1") });
  const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp: () => STAMP });

  await assignCoordinator("e1");

  assert.equal(firestore.store["events/e1"].assigned_at, STAMP);
});

test("TC-079 assignment happens once — re-running does not reassign", async () => {
  const firestore = fakeFirestore({ ...seedCoordinators(), ...seedEvent("e1") });
  const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp: () => STAMP });

  const first = await assignCoordinator("e1");
  const second = await assignCoordinator("e1");

  assert.equal(second.alreadyAssigned, true);
  assert.equal(second.coordinatorId, first.coordinatorId);
  assert.equal(firestore.store["assignment_cursor/default"].last_assigned_seq, firestore.store["coordinators/" + first.coordinatorId].coordinator_seq);
});

test("an unknown event id is reported rather than silently ignored", async () => {
  const firestore = fakeFirestore(seedCoordinators());
  const assignCoordinator = createAssignCoordinator({ firestore, serverTimestamp: () => STAMP });

  await assert.rejects(() => assignCoordinator("missing"), EventNotFoundError);
});
