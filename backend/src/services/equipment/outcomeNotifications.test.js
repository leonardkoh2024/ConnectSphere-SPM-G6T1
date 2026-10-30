// J6 / SCRUM-155 AC3 — what the coordinator is told, and to whom.

import assert from "node:assert/strict";
import test from "node:test";

import { arrangedMessage, eventNameOf, notifyCoordinator, unableMessage } from "./outcomeNotifications.js";

const eventSnapshot = (data) => ({ exists: true, data: () => data });
const missingEvent = { exists: false, data: () => undefined };

const recorder = () => {
  const firestore = {
    collection(name) {
      return { doc: () => ({ id: "notification-1", path: `${name}/notification-1`, collectionName: name }) };
    }
  };
  const transaction = {
    created: [],
    create(reference, data) { this.created.push({ reference, data }); }
  };
  return { firestore, transaction };
};

test("TC-2203 the arranged message lists what was reserved and counts what was not", () => {
  assert.equal(
    arrangedMessage({
      eventName: "Q4 Partner Summit",
      lines: [
        { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" },
        { equipment_type: "VIDEO_CONFERENCING", quantity: "1", fulfillment_status: "RESERVED" }
      ]
    }),
    "Q4 Partner Summit: your equipment is reserved. Reserved: 2 × audio, 1 × video conferencing."
  );
  assert.equal(
    arrangedMessage({
      eventName: "Q4 Partner Summit",
      lines: [
        { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" },
        { equipment_type: "VISUAL", quantity: 1, fulfillment_status: "RESOLVED" },
        { equipment_type: "LIGHTING", quantity: 1, fulfillment_status: "RESOLVED" }
      ]
    }),
    "Q4 Partner Summit: some of your equipment is reserved. Reserved: 2 × audio. 2 lines were unable to be fulfilled."
  );
  // Every line refused: arranged, nothing reserved, and it says so.
  assert.equal(
    arrangedMessage({ eventName: "", lines: [{ equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESOLVED" }] }),
    "Your event: none of your requested equipment could be reserved. 1 line was unable to be fulfilled."
  );
});

test("TC-2204 the unable-to-fulfil message names the quantity, type and trimmed reason", () => {
  assert.equal(
    unableMessage({
      eventName: "Q4 Partner Summit",
      line: { equipment_type: "VISUAL", quantity: "3" },
      reason: "  Projector under repair.  "
    }),
    "Q4 Partner Summit: Technical Support cannot fulfil 3 × visual. Reason: Projector under repair."
  );
  assert.match(unableMessage({ line: { equipment_type: "AUDIO", quantity: 1 }, reason: "None left" }), /^Your event: /);
});

test("TC-2205 the notification goes to the event's current coordinator, in the inbox's shape", () => {
  const { firestore, transaction } = recorder();
  const record = notifyCoordinator({
    firestore,
    transaction,
    eventSnapshot: eventSnapshot({ coordinator_id: "coord-2", organiser_id: "org-1" }),
    eventId: "event-1",
    type: "EQUIPMENT_UNABLE_TO_FULFIL",
    message: "Q4 Partner Summit: Technical Support cannot fulfil 1 × visual. Reason: None left",
    createdAt: { serverTimestamp: true },
    extra: { equipment_line_index: 1 }
  });

  assert.equal(transaction.created.length, 1);
  assert.equal(transaction.created[0].reference.path, "notifications/notification-1");
  assert.deepEqual(transaction.created[0].data, {
    notification_id: "notification-1",
    user_id: "coord-2",
    event_id: "event-1",
    type: "EQUIPMENT_UNABLE_TO_FULFIL",
    message: "Q4 Partner Summit: Technical Support cannot fulfil 1 × visual. Reason: None left",
    is_read: false,
    created_at: { serverTimestamp: true },
    read_at: null,
    equipment_line_index: 1
  });
  assert.deepEqual(record, transaction.created[0].data);
});

test("TC-2206 with no event or no coordinator there is nobody to tell, and nothing is written", () => {
  for (const snapshot of [missingEvent, eventSnapshot({ organiser_id: "org-1" }), eventSnapshot({ coordinator_id: "" }), undefined]) {
    const { firestore, transaction } = recorder();
    const record = notifyCoordinator({
      firestore, transaction, eventSnapshot: snapshot, eventId: "event-1",
      type: "EQUIPMENT_ARRANGED", message: "x", createdAt: null
    });
    assert.equal(record, null);
    assert.equal(transaction.created.length, 0);
  }
  assert.equal(eventNameOf(eventSnapshot({ name: "Q4 Partner Summit", reference_no: "EVT-1" })), "Q4 Partner Summit");
  assert.equal(eventNameOf(eventSnapshot({ reference_no: "EVT-1" })), "EVT-1");
  assert.equal(eventNameOf(missingEvent), "");
});
