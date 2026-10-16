// G2 / G3 / G5 — the catalogue read: what Technical Support holds, what is
// reserved and for which event. TC-396 in docs/test-cases.md.
import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createEquipmentCatalogue } from "./catalogue.js";
import { createEquipmentService } from "./service.js";

const timestamp = (iso) => ({ toDate: () => new Date(iso) });
const rows = (items) => ({ docs: items.map(([id, data]) => ({ id, data: () => data })) });

const fakeFirestore = ({ role = "TECHNICAL_SUPPORT_STAFF" } = {}) => {
  const reads = [];
  const collections = {
    equipment_inventory: [["AUDIO", { equipment_type: "AUDIO", total_quantity: 10, availability_revision: 3 }]],
    equipment_reservations: [
      ["res-1", {
        reservation_id: "res-1", event_id: "event-1", equipment_type: "AUDIO", quantity: 2, line_index: 0,
        start_datetime: timestamp("2026-11-04T01:00:00.000Z"), end_datetime: timestamp("2026-11-04T09:00:00.000Z"),
        status: "RESERVED", reserved_by: "tech-1", created_at: timestamp("2026-10-16T08:00:00.000Z"),
        released_at: null, released_by: null, release_reason: null
      }],
      ["res-2", {
        reservation_id: "res-2", event_id: "event-gone", equipment_type: "AUDIO", quantity: 1,
        start_datetime: "2026-10-01T01:00:00.000Z", end_datetime: "2026-10-01T09:00:00.000Z",
        status: "RELEASED", reserved_by: "tech-2", released_at: timestamp("2026-09-20T08:00:00.000Z"),
        release_reason: "Event cancelled"
      }]
    ],
    equipment_unavailability: [["un-1", {
      equipment_type: "AUDIO", quantity: 1,
      start_datetime: timestamp("2026-11-04T00:00:00.000Z"), end_datetime: timestamp("2026-11-05T00:00:00.000Z")
    }]]
  };
  const requests = {
    "event-1": { event_name: "Partner Summit", reference_no: "EVT-001", event_date: "2026-11-04", status: "ARRANGED", lines: [] }
  };
  return {
    reads,
    collection(name) {
      return {
        async get() {
          reads.push(`list ${name}`);
          return rows(collections[name] || []);
        },
        doc(id) {
          return {
            async get() {
              reads.push(`get ${name}/${id}`);
              if (name === "users") return { exists: true, data: () => ({ role }) };
              const data = name === "equipment_requests" ? requests[id] : undefined;
              return { exists: Boolean(data), data: () => data };
            }
          };
        }
      };
    }
  };
};

test("TC-396 the catalogue returns stock, unavailability and every reservation with its event's details", async () => {
  const firestore = fakeFirestore();
  const catalogue = await createEquipmentCatalogue({ firestore }).load();

  assert.deepEqual(catalogue.inventory, [{ equipment_type: "AUDIO", total_quantity: 10 }]);
  assert.deepEqual(catalogue.unavailability, [{
    equipment_type: "AUDIO", quantity: 1, status: "UNAVAILABLE",
    start_datetime: "2026-11-04T00:00:00.000Z", end_datetime: "2026-11-05T00:00:00.000Z"
  }]);
  assert.deepEqual(catalogue.reservations, [
    {
      id: "res-1", event_id: "event-1", equipment_type: "AUDIO", quantity: 2, line_index: 0, status: "RESERVED",
      start_datetime: "2026-11-04T01:00:00.000Z", end_datetime: "2026-11-04T09:00:00.000Z",
      reserved_by: "tech-1", created_at: "2026-10-16T08:00:00.000Z",
      released_at: null, released_by: null, release_reason: null,
      event_name: "Partner Summit", reference_no: "EVT-001", event_date: "2026-11-04"
    },
    {
      // The event's request is gone: the reservation is still listed, without its name.
      id: "res-2", event_id: "event-gone", equipment_type: "AUDIO", quantity: 1, line_index: null, status: "RELEASED",
      start_datetime: "2026-10-01T01:00:00.000Z", end_datetime: "2026-10-01T09:00:00.000Z",
      reserved_by: "tech-2", created_at: null,
      released_at: "2026-09-20T08:00:00.000Z", released_by: null, release_reason: "Event cancelled",
      event_name: null, reference_no: null, event_date: null
    }
  ]);
  // Each event's request is read once, and nothing else is read.
  assert.deepEqual(firestore.reads.sort(), [
    "get equipment_requests/event-1", "get equipment_requests/event-gone",
    "list equipment_inventory", "list equipment_reservations", "list equipment_unavailability"
  ]);
});

const getCatalogue = async (firestore, authorization = "Bearer valid-token") => {
  const app = express();
  app.use(express.json());
  app.use("/api/equipment", createEquipmentService({
    firestore,
    verifyIdToken: async () => ({ uid: "tech-1" }),
    serverTimestamp: () => ({}),
    getApprovedEventBookings: async () => []
  }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`http://127.0.0.1:${port}/api/equipment/catalogue`, { headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("TC-396 only signed-in Technical Support Staff can read the catalogue", async () => {
  const allowed = await getCatalogue(fakeFirestore());
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.reservations.length, 2);

  const coordinator = fakeFirestore({ role: "EVENT_COORDINATOR" });
  const refused = await getCatalogue(coordinator);
  assert.equal(refused.status, 403);
  assert.deepEqual(coordinator.reads, ["get users/tech-1"]);

  const anonymous = fakeFirestore();
  assert.equal((await getCatalogue(anonymous, null)).status, 401);
  assert.deepEqual(anonymous.reads, []);
});
