// Functional tests for every equipment route (G2–G5, J5, D3 AC5, D4): requests go through a real
// Express app built by createEquipmentService over an in-memory Firestore keyed by "collection/id".
import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createEquipmentService } from "./service.js";

const storeFirestore = (seed = {}) => {
  const store = { ...seed };
  let generated = 0;
  const snapshotOf = (path) => ({ id: path.split("/")[1], ref: { path }, exists: store[path] !== undefined, data: () => store[path] });
  const docRef = (name, id) => ({ kind: "doc", name, id, path: `${name}/${id}`, get: async () => snapshotOf(`${name}/${id}`) });
  const run = (target) => (target.kind !== "query" ? snapshotOf(target.path) : {
    docs: Object.keys(store)
      .filter((path) => path.startsWith(`${target.name}/`) && target.filters.every(([field, value]) => store[path][field] === value))
      .map(snapshotOf)
  });
  const queryRef = (name, filters = []) => ({
    kind: "query", name, filters,
    where: (field, _operator, value) => queryRef(name, [...filters, [field, value]]),
    get: async () => run(queryRef(name, filters))
  });
  return {
    store,
    collection: (name) => ({
      doc: (id) => docRef(name, id ?? `generated-${++generated}`),
      where: (field, operator, value) => queryRef(name).where(field, operator, value),
      get: async () => run(queryRef(name))
    }),
    runTransaction: async (operation) => {
      const writes = [];
      const result = await operation({
        get: async (target) => run(target),
        set: (target, data) => writes.push(() => { store[target.path] = data; }),
        create: (target, data) => writes.push(() => {
          assert.equal(store[target.path], undefined, `create over ${target.path}`);
          store[target.path] = data;
        }),
        update: (target, data) => writes.push(() => { store[target.path] = { ...store[target.path], ...data }; })
      });
      writes.forEach((write) => write());
      return result;
    }
  };
};

const BOOKING = { status: "APPROVED", occupied_start: new Date("2026-11-04T00:30:00Z"), occupied_end: new Date("2026-11-04T09:30:00Z") };

const seed = (extra = {}) => ({
  "users/tech-1": { role: "TECHNICAL_SUPPORT_STAFF", is_active: true },
  "users/coord-1": { role: "EVENT_COORDINATOR" },
  "users/safety-1": { role: "SAFETY_OFFICER" },
  "users/org-1": { role: "EVENT_ORGANISER" },
  "events/E1": { coordinator_id: "coord-1", name: "Partner Summit", status: "PLANNING" },
  "equipment_requests/E1": { event_id: "E1", status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 2 }, { equipment_type: "VISUAL", quantity: 1 }] },
  "equipment_inventory/AUDIO": { equipment_type: "AUDIO", total_quantity: 5, availability_revision: 0 },
  "equipment_inventory/VISUAL": { equipment_type: "VISUAL", total_quantity: 1, availability_revision: 0 },
  ...extra
});

const TOKENS = { "t-tech": "tech-1", "t-coord": "coord-1", "t-safety": "safety-1", "t-org": "org-1", "t-ghost": "ghost" };

const withServer = async (firestore, run, { bookings = [BOOKING] } = {}) => {
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", createEquipmentService({
    firestore,
    verifyIdToken: async (token) => { if (!TOKENS[token]) throw new Error("bad token"); return { uid: TOKENS[token] }; },
    serverTimestamp: () => "STAMP",
    getApprovedEventBookings: async () => bookings
  }));
  // Mirrors backend/src/index.js: an unhandled error becomes a JSON 500.
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const call = async (method, path, { token, body } = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/equipment${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

// Every route, the role it needs and a body that passes validation.
const ROUTES = [
  { name: "notify technical support", method: "POST", path: "/requests/E1/notify-technical-support", token: "t-coord", body: {} },
  { name: "notify confirmed", method: "POST", path: "/requests/E1/notify-confirmed", token: "t-safety", body: {} },
  { name: "catalogue", method: "GET", path: "/catalogue", token: "t-tech" },
  { name: "reserve", method: "POST", path: "/reservations", token: "t-tech", body: { event_id: "E1", equipment_type: "AUDIO", quantity: 2, line_index: 0 } },
  { name: "release", method: "POST", path: "/reservations/R1/release", token: "t-tech", body: {} },
  { name: "cancel reservations", method: "POST", path: "/events/E1/cancel-reservations", token: "t-coord", body: {} },
  { name: "amend line", method: "PATCH", path: "/requests/E1/lines/0", token: "t-tech", body: { equipment_type: "AUDIO", quantity: 3, note: "More mics" } },
  { name: "unable to fulfil", method: "POST", path: "/requests/E1/lines/0/unable-to-fulfill", token: "t-tech", body: { reason: "Out of stock" } }
];

test("TC-0037 [failure] A4 every equipment route refuses a missing token, a bad token and an unknown profile", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    for (const route of ROUTES) {
      assert.deepEqual(await call(route.method, route.path, { body: route.body }), { status: 401, body: { error: "Sign in is required." } }, route.name);
      assert.equal((await call(route.method, route.path, { token: "forged", body: route.body })).status, 401, route.name);
      assert.equal((await call(route.method, route.path, { token: "t-ghost", body: route.body })).status, 403, route.name);
    }
  });
});

test("TC-0038 [conflict] A4 each equipment route is refused to the wrong role", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    for (const route of ROUTES) {
      const response = await call(route.method, route.path, { token: "t-org", body: route.body });
      assert.equal(response.status, 403, route.name);
      assert.match(response.body.error, /^Only /, route.name);
    }
  });
});

test("TC-0039 [failure] a failing profile read is a 500 on every equipment route", async () => {
  const firestore = storeFirestore(seed());
  firestore.collection = () => ({ doc: () => ({ get: async () => { throw new Error("unavailable"); } }) });
  await withServer(firestore, async (call) => {
    for (const route of ROUTES) {
      assert.deepEqual(await call(route.method, route.path, { token: route.token, body: route.body }), {
        status: 500, body: { error: "Internal server error" }
      }, route.name);
    }
  });
});

test("TC-0040 [failure] a Firestore failure inside each operation is a 500, not a hang", async () => {
  const firestore = storeFirestore(seed());
  firestore.runTransaction = async () => { throw new Error("aborted"); };
  const collection = firestore.collection;
  // The catalogue reads outside a transaction, so fail its first collection read too.
  firestore.collection = (name) => (name === "equipment_inventory" ? { get: async () => { throw new Error("aborted"); } } : collection(name));
  await withServer(firestore, async (call) => {
    for (const route of ROUTES) {
      assert.equal((await call(route.method, route.path, { token: route.token, body: route.body })).status, 500, route.name);
    }
  });
});

test("TC-1251 [normal] G3 Technical Support reserve a line and get the reservation back with 201", async () => {
  const firestore = storeFirestore(seed());
  await withServer(firestore, async (call) => {
    const response = await call("POST", "/reservations", { token: "t-tech", body: { event_id: "E1", equipment_type: "AUDIO", quantity: 2, line_index: 0 } });
    assert.equal(response.status, 201);
    assert.equal(response.body.reservation.status, "RESERVED");
    assert.equal(response.body.reservation.quantity, 2);
    assert.equal(firestore.store["equipment_inventory/AUDIO"].availability_revision, 1);
  });
});

test("TC-1200 [conflict] G2 equipment counts are real: a request beyond free stock is refused with 409", async () => {
  const firestore = storeFirestore(seed({
    "equipment_reservations/other": {
      event_id: "E9", equipment_type: "AUDIO", quantity: 4, status: "RESERVED",
      start_datetime: new Date("2026-11-04T08:00:00Z"), end_datetime: new Date("2026-11-04T12:00:00Z")
    }
  }));
  await withServer(firestore, async (call) => {
    const response = await call("POST", "/reservations", { token: "t-tech", body: { event_id: "E1", equipment_type: "AUDIO", quantity: 2, line_index: 0 } });
    assert.equal(response.status, 409);
    assert.match(response.body.error, /1 free, 1 more needed/);
    assert.equal(Object.keys(firestore.store).filter((path) => path.startsWith("equipment_reservations/")).length, 1);
  });
});

test("TC-1252 [failure] G3 reservation input is validated before any read", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    const reserve = (body) => call("POST", "/reservations", { token: "t-tech", body });
    assert.deepEqual(await reserve({}), { status: 400, body: { error: "Choose an event before reserving equipment." } });
    assert.deepEqual(await reserve({ event_id: "E1", equipment_type: "LASERS", quantity: 1 }), { status: 400, body: { error: "Choose a supported equipment type." } });
    assert.deepEqual(await reserve({ event_id: "E1", equipment_type: "AUDIO", quantity: 0 }), { status: 400, body: { error: "Quantity must be a whole number greater than zero." } });
  });
});

test("TC-1315 [normal] G5 releasing a reservation reopens its line; a second release is refused", async () => {
  const firestore = storeFirestore(seed({
    "equipment_requests/E1": { event_id: "E1", status: "ARRANGED", lines: [{ equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED", reservation_id: "R1" }] },
    "equipment_reservations/R1": { reservation_id: "R1", event_id: "E1", equipment_type: "AUDIO", quantity: 2, status: "RESERVED", line_index: 0 }
  }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/reservations/R1/release", { token: "t-tech", body: { reason: "Moved" } }), {
      status: 200, body: { reservationId: "R1", status: "RELEASED" }
    });
    assert.equal(firestore.store["equipment_requests/E1"].status, "PENDING");
    assert.deepEqual(await call("POST", "/reservations/R1/release", { token: "t-tech", body: {} }), {
      status: 409, body: { error: "This equipment reservation is no longer active." }
    });
    assert.equal((await call("POST", "/reservations/missing/release", { token: "t-tech" })).status, 404);
  });
});

test("TC-0514 [normal] D4 the coordinator of a Cancelled event releases its reservations; a live event is refused", async () => {
  const firestore = storeFirestore(seed({
    "events/E1": { coordinator_id: "coord-1", status: "CANCELLED" },
    "equipment_reservations/R1": { reservation_id: "R1", event_id: "E1", equipment_type: "AUDIO", quantity: 2, status: "RESERVED" },
    "events/E2": { coordinator_id: "coord-1", status: "PLANNING" }
  }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/events/E1/cancel-reservations", { token: "t-coord", body: {} }), { status: 200, body: { released: 1 } });
    assert.equal(firestore.store["equipment_reservations/R1"].release_reason, "Event cancelled");
    assert.equal((await call("POST", "/events/E2/cancel-reservations", { token: "t-coord", body: {} })).status, 409);
  });
});

test("TC-1281 [normal] G4 Technical Support amend a line and mark another unable to be fulfilled", async () => {
  const firestore = storeFirestore(seed());
  await withServer(firestore, async (call) => {
    const amended = await call("PATCH", "/requests/E1/lines/0", { token: "t-tech", body: { equipment_type: "AUDIO", quantity: 3, note: " More mics " } });
    assert.equal(amended.status, 200);
    assert.equal(amended.body.line.quantity, 3);
    assert.equal(amended.body.line.amendment_note, "More mics");
    const refused = await call("POST", "/requests/E1/lines/1/unable-to-fulfill", { token: "t-tech", body: { reason: "Projector broken" } });
    assert.equal(refused.status, 200);
    assert.equal(refused.body.status, "PENDING");
    assert.equal(refused.body.line.resolution, "UNABLE_TO_FULFILL");
  });
});

test("TC-1282 [failure] G4 amending or refusing needs a note or reason and a real line", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    assert.equal((await call("PATCH", "/requests/E1/lines/0", { token: "t-tech", body: { equipment_type: "AUDIO", quantity: 3 } })).status, 400);
    assert.equal((await call("PATCH", "/requests/E1/lines/-1", { token: "t-tech", body: { equipment_type: "AUDIO", quantity: 3, note: "x" } })).status, 400);
    assert.equal((await call("PATCH", "/requests/E1/lines/9", { token: "t-tech", body: { equipment_type: "AUDIO", quantity: 3, note: "x" } })).status, 404);
    assert.equal((await call("POST", "/requests/E1/lines/0/unable-to-fulfill", { token: "t-tech", body: {} })).status, 400);
    assert.equal((await call("POST", "/requests/E404/lines/0/unable-to-fulfill", { token: "t-tech", body: { reason: "x" } })).status, 404);
  });
});

test("TC-2164 [normal] J5 the coordinator's notify call tells active Technical Support once; another coordinator is refused", async () => {
  const firestore = storeFirestore(seed({ "users/coord-2": { role: "EVENT_COORDINATOR" } }));
  await withServer(firestore, async (call) => {
    const first = await call("POST", "/requests/E1/notify-technical-support", { token: "t-coord" });
    assert.equal(first.status, 200);
    assert.equal(first.body.sent, 1);
    assert.equal((await call("POST", "/requests/E1/notify-technical-support", { token: "t-coord" })).body.sent, 0);
  });
  const notMine = storeFirestore(seed({ "events/E1": { coordinator_id: "coord-2", name: "Partner Summit", status: "PLANNING" } }));
  await withServer(notMine, async (call) => {
    assert.equal((await call("POST", "/requests/E1/notify-technical-support", { token: "t-coord" })).status, 403);
  });
});

test("TC-0496 [normal] D3 AC5 the Safety Officer's confirmation is announced to Technical Support; an unknown event is a 404", async () => {
  const firestore = storeFirestore(seed({ "events/E1": { coordinator_id: "coord-1", name: "Partner Summit", status: "CONFIRMED", confirmed_at: "2026-11-01T02:00:00.000Z" } }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/requests/E1/notify-confirmed", { token: "t-safety" }), { status: 200, body: { eventId: "E1", sent: 1 } });
    assert.deepEqual(await call("POST", "/requests/E9/notify-confirmed", { token: "t-safety" }), { status: 404, body: { error: "Event not found." } });
  });
});

test("TC-1201 [normal] G2 the catalogue is served to Technical Support", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    const response = await call("GET", "/catalogue", { token: "t-tech" });
    assert.equal(response.status, 200);
    assert.ok(response.body);
  });
});
