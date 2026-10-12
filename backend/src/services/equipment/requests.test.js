import assert from "node:assert/strict";
import test from "node:test";

import { createEquipmentRequestActions } from "./requests.js";

const fixture = ({
  lines = [{ equipment_type: "AUDIO", quantity: 2 }],
  reservations = []
} = {}) => {
  const request = { status: "PENDING", lines };
  const transaction = {
    created: [],
    updates: [],
    async get(reference) {
      if (reference.path === "equipment_requests/event-1") {
        return { exists: true, data: () => request };
      }
      if (reference.collectionName === "equipment_reservations") {
        return { docs: reservations.map((data) => ({ data: () => data })) };
      }
      throw new Error(`Unexpected transaction read ${reference.path || reference.collectionName}`);
    },
    update(reference, data) {
      this.updates.push({ reference, data });
      Object.assign(request, data);
    },
    create(reference, data) {
      this.created.push({ reference, data });
    }
  };
  const firestore = {
    collection(name) {
      return {
        doc(id = "generated-history") {
          return { id, path: `${name}/${id}`, collectionName: name };
        },
        where(field, _operator, value) {
          return {
            collectionName: name,
            filters: [[field, value]],
            where(nextField, _nextOperator, nextValue) {
              this.filters.push([nextField, nextValue]);
              return this;
            }
          };
        }
      };
    },
    runTransaction: async (callback) => callback(transaction)
  };
  const actions = createEquipmentRequestActions({
    firestore,
    serverTimestamp: () => ({ serverTimestamp: true })
  });
  return { actions, request, transaction };
};

test("TC-307 line amendment stores changed type and quantity with a mandatory auditable note", async () => {
  const { actions, request, transaction } = fixture();
  const result = await actions.amendLine({
    eventId: "event-1",
    lineIndex: 0,
    equipmentType: "VISUAL",
    quantity: 3,
    note: "Substitute visual unit; requested model is unavailable.",
    userId: "tech-1"
  });

  assert.equal(result.line.equipment_type, "VISUAL");
  assert.equal(result.line.quantity, 3);
  assert.equal(result.line.amended_by, "tech-1");
  assert.ok(result.line.amended_at instanceof Date);
  assert.deepEqual(request.lines[0], result.line);
  assert.equal(transaction.created[0].data.action, "LINE_AMENDED");
  assert.equal(transaction.created[0].data.actor_id, "tech-1");
  assert.deepEqual(transaction.created[0].data.old_values, { equipment_type: "AUDIO", quantity: 2 });
  assert.deepEqual(transaction.created[0].data.new_values, { equipment_type: "VISUAL", quantity: 3 });
});

test("TC-308 an amendment without an explanatory note is rejected before writes", async () => {
  const { actions, transaction } = fixture();
  await assert.rejects(actions.amendLine({
    eventId: "event-1",
    lineIndex: 0,
    equipmentType: "AUDIO",
    quantity: 2,
    note: " ",
    userId: "tech-1"
  }), /note explaining the amendment is required/i);
  assert.equal(transaction.created.length, 0);
  assert.equal(transaction.updates.length, 0);
});

test("TC-312 an active reservation prevents the Support amendment from invalidating that line", async () => {
  const { actions, transaction } = fixture({
    reservations: [{
      event_id: "event-1",
      line_index: 0,
      equipment_type: "AUDIO",
      status: "RESERVED"
    }]
  });
  await assert.rejects(actions.amendLine({
    eventId: "event-1",
    lineIndex: 0,
    equipmentType: "VISUAL",
    quantity: 3,
    note: "Substitute visual equipment.",
    userId: "tech-1"
  }), /active reservation cannot be amended/i);
  assert.equal(transaction.created.length, 0);
  assert.equal(transaction.updates.length, 0);
});

test("TC-309 line unable-to-fulfil decision requires a reason and records the actor and time", async () => {
  const { actions, request, transaction } = fixture();
  await assert.rejects(actions.resolveLine({
    eventId: "event-1",
    lineIndex: 0,
    reason: " ",
    userId: "tech-1"
  }), /reason is required/i);

  const result = await actions.resolveLine({
    eventId: "event-1",
    lineIndex: 0,
    reason: "No compatible unit is available.",
    userId: "tech-1"
  });
  assert.equal(result.line.fulfillment_status, "RESOLVED");
  assert.equal(result.line.resolution_reason, "No compatible unit is available.");
  assert.equal(result.line.resolved_by, "tech-1");
  assert.ok(result.line.resolved_at instanceof Date);
  assert.equal(result.status, "ARRANGED");
  assert.equal(request.status, "ARRANGED");
  assert.equal(transaction.created[0].data.action, "LINE_UNABLE_TO_FULFILL");
  assert.equal(transaction.created[0].data.actor_id, "tech-1");
});

test("TC-310 request stays Pending until every line is reserved or resolved", async () => {
  const { actions, request } = fixture({
    lines: [
      { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" },
      { equipment_type: "VISUAL", quantity: 1 },
      { equipment_type: "LIGHTING", quantity: 1 }
    ]
  });
  const partial = await actions.resolveLine({
    eventId: "event-1",
    lineIndex: 1,
    reason: "No compatible unit is available.",
    userId: "tech-1"
  });
  assert.equal(partial.status, "PENDING");
  assert.equal(request.status, "PENDING");
  const result = await actions.resolveLine({
    eventId: "event-1",
    lineIndex: 2,
    reason: "No compatible unit is available.",
    userId: "tech-1"
  });
  assert.equal(result.status, "ARRANGED");
  assert.equal(request.status, "ARRANGED");
});
