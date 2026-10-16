import assert from "node:assert/strict";
import test from "node:test";

import { createEquipmentRequestActions } from "./requests.js";

const fixture = ({
  lines = [{ equipment_type: "AUDIO", quantity: 2 }],
  reservations = [],
  event = { coordinator_id: "coord-1", name: "Q4 Partner Summit" },
  status = "PENDING"
} = {}) => {
  const request = { status, lines };
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
      if (reference.path === "events/event-1") {
        return { exists: Boolean(event), data: () => event };
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

// J6 / SCRUM-155 AC3 — TC-314 – TC-316 in docs/test-cases.md.
const notices = (transaction) => transaction.created
  .filter((item) => item.reference.collectionName === "notifications")
  .map((item) => item.data);

test("TC-314 a line marked unable to be fulfilled tells the event's coordinator why", async () => {
  const { actions, transaction } = fixture({
    lines: [{ equipment_type: "AUDIO", quantity: 2 }, { equipment_type: "VISUAL", quantity: 1 }]
  });
  await actions.resolveLine({ eventId: "event-1", lineIndex: 1, reason: "Projector under repair.", userId: "tech-1" });

  const [notice, ...rest] = notices(transaction);
  assert.equal(rest.length, 0);
  assert.equal(notice.user_id, "coord-1");
  assert.equal(notice.event_id, "event-1");
  assert.equal(notice.type, "EQUIPMENT_UNABLE_TO_FULFIL");
  assert.equal(notice.equipment_line_index, 1);
  assert.equal(notice.is_read, false);
  assert.equal(notice.read_at, null);
  assert.equal(notice.notification_id, transaction.created.find((item) => item.data === notice).reference.id);
  assert.match(notice.message, /Q4 Partner Summit: Technical Support cannot fulfil 1 × visual\. Reason: Projector under repair\./);
});

test("TC-315 resolving the last open line also tells the coordinator the request is arranged", async () => {
  const { actions, transaction } = fixture({
    lines: [
      { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" },
      { equipment_type: "VISUAL", quantity: 1 }
    ]
  });
  await actions.resolveLine({ eventId: "event-1", lineIndex: 1, reason: "Projector under repair.", userId: "tech-1" });

  assert.deepEqual(notices(transaction).map((item) => item.type), ["EQUIPMENT_UNABLE_TO_FULFIL", "EQUIPMENT_ARRANGED"]);
  assert.equal(notices(transaction)[1].message,
    "Q4 Partner Summit: some of your equipment is reserved. Reserved: 2 × audio. 1 line was unable to be fulfilled.");
});

test("TC-316 with no coordinator on the event the decision still lands and nobody is notified", async () => {
  const { actions, request, transaction } = fixture({ event: { name: "Unassigned" } });
  await actions.resolveLine({ eventId: "event-1", lineIndex: 0, reason: "No compatible unit.", userId: "tech-1" });

  assert.equal(request.status, "ARRANGED");
  assert.equal(notices(transaction).length, 0);
});

// J6 / SCRUM-155 AC3 — TC-331 – TC-333 in docs/test-cases.md.
test("TC-331 an amendment is not an outcome, so the coordinator is not notified", async () => {
  const { actions, transaction } = fixture();
  await actions.amendLine({
    eventId: "event-1", lineIndex: 0, equipmentType: "VISUAL", quantity: 1,
    note: "Substitute unit.", userId: "tech-1"
  });

  assert.equal(notices(transaction).length, 0);
});

test("TC-332 a refused resolution writes no notification", async () => {
  const refusals = [
    [{ }, { reason: " " }, /reason is required/i],
    [{ status: "ARRANGED" }, {}, /Only Pending/],
    [{ lines: [{ equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" }] }, {}, /already been fulfilled/],
    [{ reservations: [{ equipment_type: "AUDIO", line_index: 0, status: "RESERVED" }] }, {}, /active reservation/],
    [{}, { lineIndex: 5 }, /line not found/]
  ];
  for (const [setup, call, error] of refusals) {
    const { actions, transaction } = fixture(setup);
    await assert.rejects(actions.resolveLine({
      eventId: "event-1", lineIndex: 0, reason: "No unit.", userId: "tech-1", ...call
    }), error);
    assert.equal(notices(transaction).length, 0);
    assert.equal(transaction.updates.length, 0);
  }
});

test("TC-333 several refused lines are counted in the plural when the request is arranged", async () => {
  const { actions, transaction } = fixture({
    lines: [
      { equipment_type: "VISUAL", quantity: 1, fulfillment_status: "RESOLVED" },
      { equipment_type: "AUDIO", quantity: 2 }
    ]
  });
  await actions.resolveLine({ eventId: "event-1", lineIndex: 1, reason: "None left.", userId: "tech-1" });

  assert.equal(notices(transaction)[1].message,
    "Q4 Partner Summit: none of your requested equipment could be reserved. 2 lines were unable to be fulfilled.");
});
