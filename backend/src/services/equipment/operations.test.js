// Edge cases of the equipment operations (G2–G5, J5, J6, D3 AC5, D4), called directly over an
// in-memory Firestore keyed by "collection/id". The happy paths live in requests/reservations/
// supportNotifications.test.js; these pin down the boundaries, conflicts and failures.
import assert from "node:assert/strict";
import test from "node:test";

import { calculateEquipmentAvailability, EquipmentConflictError, EquipmentValidationError, equipmentWindowFromVenueBookings } from "./availability.js";
import { arrangedMessage, unableMessage } from "./outcomeNotifications.js";
import { createEquipmentRequestActions } from "./requests.js";
import { createEquipmentReservations } from "./reservations.js";
import { amendedMessage, createSupportNotifier } from "./supportNotifications.js";

const storeFirestore = (seed = {}) => {
  const store = { ...seed };
  let generated = 0;
  const snapshotOf = (path) => ({ id: path.split("/")[1], ref: { path }, exists: store[path] !== undefined, data: () => store[path] });
  const run = (target) => (target.kind !== "query" ? snapshotOf(target.path) : {
    docs: Object.keys(store)
      .filter((path) => path.startsWith(`${target.name}/`) && target.filters.every(([field, value]) => store[path][field] === value))
      .map(snapshotOf)
  });
  const queryRef = (name, filters = []) => ({
    kind: "query", name, filters, where: (field, _operator, value) => queryRef(name, [...filters, [field, value]])
  });
  return {
    store,
    collection: (name) => ({
      doc: (id) => ({ kind: "doc", path: `${name}/${id ?? `generated-${++generated}`}`, id }),
      where: (field, operator, value) => queryRef(name).where(field, operator, value)
    }),
    runTransaction: async (operation) => {
      const writes = [];
      const result = await operation({
        get: async (target) => run(target),
        set: (target, data) => writes.push(() => { store[target.path] = data; }),
        create: (target, data) => writes.push(() => { store[target.path] = data; }),
        update: (target, data) => writes.push(() => { store[target.path] = { ...store[target.path], ...data }; })
      });
      writes.forEach((write) => write());
      return result;
    }
  };
};

const BOOKING = { status: "APPROVED", occupied_start: new Date("2026-11-04T00:30:00Z"), occupied_end: new Date("2026-11-04T09:30:00Z") };
const WINDOW = { start_datetime: new Date("2026-11-04T00:30:00Z"), end_datetime: new Date("2026-11-04T09:30:00Z") };
const base = (extra = {}) => ({
  "events/E1": { coordinator_id: "coord-1", name: "Partner Summit", status: "PLANNING" },
  "equipment_requests/E1": { event_id: "E1", status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 2 }] },
  "equipment_inventory/AUDIO": { total_quantity: 5 },
  ...extra
});
const reservationsOver = (seed, bookings = [BOOKING]) => {
  const firestore = storeFirestore(seed);
  return { firestore, service: createEquipmentReservations({ firestore, serverTimestamp: () => "STAMP", getApprovedEventBookings: async () => bookings }) };
};
const actionsOver = (seed) => {
  const firestore = storeFirestore(seed);
  return { firestore, actions: createEquipmentRequestActions({ firestore, serverTimestamp: () => "STAMP" }) };
};
const reserveAudio = (changes = {}) => ({ eventId: "E1", equipmentType: "AUDIO", quantity: 2, userId: "tech-1", ...changes });
const paths = (store, prefix) => Object.keys(store).filter((path) => path.startsWith(prefix));

// ---- availability wrappers ---------------------------------------------------------------------------

test("TC-1197 [failure] G2 a booking window the domain cannot read is a 409; a bad availability input is a 400", () => {
  assert.throws(() => equipmentWindowFromVenueBookings([]), (error) => error instanceof EquipmentConflictError && /approved venue booking is required/.test(error.message));
  assert.throws(() => calculateEquipmentAvailability({ equipmentType: "AUDIO", start: null, end: null, requestedQuantity: 1, inventory: { total_quantity: 1 } }),
    (error) => error instanceof EquipmentValidationError && error.statusCode === 400);
});

// ---- reserve -----------------------------------------------------------------------------------------

test("TC-1243 [boundary] G3 with no line index the first open line of that type is reserved and the request becomes Arranged", async () => {
  const { firestore, service } = reservationsOver(base({
    "equipment_requests/E1": { event_id: "E1", status: "PENDING", lines: [
      { equipment_type: "AUDIO", quantity: 1, fulfillment_status: "RESOLVED" },
      { equipment_type: "AUDIO", quantity: 2 }
    ] },
    "equipment_inventory/AUDIO": { total_quantity: 2, availability_revision: null },
    "equipment_unavailability/U1": { equipment_type: "AUDIO", quantity: 1, status: "BACK_IN_USE", ...WINDOW }
  }));
  const reservation = await service.reserve(reserveAudio({ lineIndex: "first" }));
  assert.equal(reservation.line_index, 1);
  assert.equal(firestore.store["equipment_requests/E1"].status, "ARRANGED");
  assert.equal(firestore.store["equipment_inventory/AUDIO"].availability_revision, 1);
});

test("TC-1244 [failure] G3 reserve refuses a blank event, a request that is missing, not Pending or without lines", async () => {
  const { service } = reservationsOver(base());
  await assert.rejects(service.reserve(reserveAudio({ eventId: "  " })), { statusCode: 400 });
  await assert.rejects(service.reserve(reserveAudio({ eventId: "E2" })), { statusCode: 409, message: "This event no longer has a Pending equipment request." });
  const arranged = reservationsOver(base({ "equipment_requests/E1": { status: "ARRANGED", lines: [] } }));
  await assert.rejects(arranged.service.reserve(reserveAudio()), { statusCode: 409 });
  const noLines = reservationsOver(base({ "equipment_requests/E1": { status: "PENDING" } }));
  await assert.rejects(noLines.service.reserve(reserveAudio()), { statusCode: 409, message: "This equipment type is not in the event's request." });
});

test("TC-1245 [conflict] G3 a line of another type, or one already reserved, cannot be reserved again", async () => {
  const { service } = reservationsOver(base({ "equipment_requests/E1": { status: "PENDING", lines: [
    { equipment_type: "VISUAL", quantity: 1 }, { equipment_type: "AUDIO", quantity: 1, fulfillment_status: "RESERVED" }
  ] } }));
  await assert.rejects(service.reserve(reserveAudio({ lineIndex: 0 })), { statusCode: 409, message: "This equipment request line has already been resolved." });
  await assert.rejects(service.reserve(reserveAudio({ lineIndex: 1 })), { statusCode: 409 });
});

test("TC-1198 [failure] G2 equipment with no inventory record, or a corrupt revision, cannot be reserved", async () => {
  const missing = reservationsOver(base({ "equipment_requests/E1": { status: "PENDING", lines: [{ equipment_type: "OTHERS", quantity: 1 }] } }));
  await assert.rejects(missing.service.reserve(reserveAudio({ equipmentType: "OTHERS", quantity: 1, lineIndex: 0 })), {
    statusCode: 404, message: "No held inventory is recorded for OTHERS."
  });
  const corrupt = reservationsOver(base({ "equipment_inventory/AUDIO": { total_quantity: 5, availability_revision: -1 } }));
  await assert.rejects(corrupt.service.reserve(reserveAudio({ lineIndex: 0 })), { statusCode: 400, message: "The equipment inventory revision is invalid." });
});

test("TC-1246 [conflict] G3 an event's active reservation for the line, or a legacy one without a line, blocks a duplicate", async () => {
  for (const existing of [
    { event_id: "E1", equipment_type: "AUDIO", quantity: 1, status: "approved", line_index: 0, ...WINDOW },
    { event_id: "E1", equipment_type: "AUDIO", quantity: 1, status: "RESERVED", ...WINDOW }
  ]) {
    const { firestore, service } = reservationsOver(base({ "equipment_reservations/R0": existing }));
    await assert.rejects(service.reserve(reserveAudio({ lineIndex: 0 })), { statusCode: 409, message: /already reserved for the event/ });
    assert.deepEqual(paths(firestore.store, "equipment_reservations/"), ["equipment_reservations/R0"]);
  }
  // A released one, or one without a status, for another line does not.
  const { service } = reservationsOver(base({
    "equipment_reservations/R0": { event_id: "E1", equipment_type: "AUDIO", quantity: 1, status: "RELEASED", line_index: 0, ...WINDOW },
    "equipment_reservations/R1": { event_id: "E1", equipment_type: "AUDIO", quantity: 1, line_index: 4, ...WINDOW }
  }));
  assert.equal((await service.reserve(reserveAudio({ lineIndex: 0 }))).status, "RESERVED");
});

test("TC-1199 [boundary] G2 stock out of use for an overlapping period reduces what can be reserved, exactly to zero", async () => {
  const { service } = reservationsOver(base({
    "equipment_inventory/AUDIO": { total_quantity: 3 },
    "equipment_unavailability/U1": { equipment_type: "AUDIO", quantity: 1, ...WINDOW }
  }));
  assert.equal((await service.reserve(reserveAudio({ lineIndex: 0 }))).quantity, 2);
  const short = reservationsOver(base({
    "equipment_inventory/AUDIO": { total_quantity: 3 },
    "equipment_unavailability/U1": { equipment_type: "AUDIO", quantity: 2, ...WINDOW }
  }));
  await assert.rejects(short.service.reserve(reserveAudio({ lineIndex: 0 })), { statusCode: 409, message: /1 free, 1 more needed/ });
});

// ---- release -----------------------------------------------------------------------------------------

const reserved = (changes = {}) => ({ reservation_id: "R1", event_id: "E1", equipment_type: "AUDIO", quantity: 2, status: "RESERVED", ...changes });

test("TC-1308 [failure] G5 release needs an id, an existing reservation and its inventory", async () => {
  const { service } = reservationsOver(base({ "equipment_reservations/R1": reserved({ equipment_type: "OTHERS" }) }));
  await assert.rejects(service.release({ reservationId: " " }), { statusCode: 400 });
  await assert.rejects(service.release({ reservationId: "R9", userId: "t" }), { statusCode: 404, message: "Equipment reservation not found." });
  await assert.rejects(service.release({ reservationId: "R1", userId: "t" }), { statusCode: 404, message: "The reservation's inventory record could not be found." });
});

test("TC-1309 [boundary] G5 a reservation without a line index finds its line by id; the default reason is recorded", async () => {
  const { firestore, service } = reservationsOver(base({
    "equipment_requests/E1": { status: "ARRANGED", lines: [{ equipment_type: "VISUAL", quantity: 1 }, { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED", reservation_id: "R1" }] },
    "equipment_reservations/R1": reserved()
  }));
  await service.release({ reservationId: "R1", reason: "   ", userId: "tech-1" });
  assert.equal(firestore.store["equipment_reservations/R1"].release_reason, "No longer required");
  assert.equal(firestore.store["equipment_requests/E1"].lines[1].fulfillment_status, "PENDING");
  const [history] = paths(firestore.store, "equipment_request_history/").map((path) => firestore.store[path]);
  assert.equal(history.line_index, null);
  assert.equal(history.reason, "No longer required");
});

test("TC-1310 [boundary] G5 a release whose request is gone, has no lines, or points elsewhere leaves the request alone", async () => {
  for (const request of [undefined, { status: "ARRANGED" }, { status: "ARRANGED", lines: [{ reservation_id: "OTHER" }] }]) {
    const { firestore, service } = reservationsOver(base({
      "equipment_requests/E1": request,
      "equipment_reservations/R1": reserved({ line_index: request?.lines ? 0 : undefined })
    }));
    if (request === undefined) delete firestore.store["equipment_requests/E1"];
    assert.deepEqual(await service.release({ reservationId: "R1", reason: "Moved", userId: "tech-1" }), { reservationId: "R1", status: "RELEASED" });
    assert.deepEqual(firestore.store["equipment_requests/E1"], request);
  }
});

// ---- release after cancellation (D4) -----------------------------------------------------------------

test("TC-0508 [failure] D4 cancellation release needs an event id and the event's own coordinator", async () => {
  const { service } = reservationsOver(base({ "events/E1": { coordinator_id: "coord-1", status: "CANCELLED" } }));
  await assert.rejects(service.releaseCancelledEventReservations({ eventId: "" }), { statusCode: 400 });
  await assert.rejects(service.releaseCancelledEventReservations({ eventId: "E9", userId: "coord-1" }), { statusCode: 409 });
  await assert.rejects(service.releaseCancelledEventReservations({ eventId: "E1", userId: "coord-2" }), {
    statusCode: 409, message: "Only the current event coordinator may release its equipment."
  });
});

test("TC-0509 [failure] D4 a reservation whose inventory is missing aborts the whole release", async () => {
  const { firestore, service } = reservationsOver(base({
    "events/E1": { coordinator_id: "coord-1", status: "CANCELLED" },
    "equipment_reservations/R1": reserved(),
    "equipment_reservations/R2": reserved({ reservation_id: "R2", equipment_type: "STAGING" })
  }));
  await assert.rejects(service.releaseCancelledEventReservations({ eventId: "E1", userId: "coord-1" }), {
    statusCode: 404, message: "The inventory record for STAGING could not be found."
  });
  assert.equal(firestore.store["equipment_reservations/R1"].status, "RESERVED");
});

test("TC-0510 [boundary] D4 with no request on file and reservations without ids or statuses, only active ones are released", async () => {
  const { firestore, service } = reservationsOver({
    "events/E1": { coordinator_id: "coord-1", status: "CANCELLED" },
    "equipment_inventory/AUDIO": { total_quantity: 5 },
    "equipment_reservations/R1": { event_id: "E1", equipment_type: "AUDIO", quantity: 1, status: "RESERVED" },
    "equipment_reservations/R2": { event_id: "E1", equipment_type: "AUDIO", quantity: 1 }
  });
  assert.deepEqual(await service.releaseCancelledEventReservations({ eventId: "E1", reason: " Venue lost ", userId: "coord-1" }), { released: 1 });
  const [history] = paths(firestore.store, "equipment_request_history/").map((path) => firestore.store[path]);
  assert.equal(history.reservation_id, "R1");
  assert.equal(history.reason, "Venue lost");
  assert.equal(firestore.store["equipment_requests/E1"], undefined);
  assert.equal(firestore.store["equipment_reservations/R2"].status, undefined);
});

test("TC-0511 [boundary] D4 a request with no lines is still marked Cancelled", async () => {
  const { firestore, service } = reservationsOver(base({
    "events/E1": { coordinator_id: "coord-1", status: "CANCELLED" },
    "equipment_requests/E1": { status: "PENDING" }
  }));
  assert.deepEqual(await service.releaseCancelledEventReservations({ eventId: "E1", userId: "coord-1" }), { released: 0 });
  assert.deepEqual(firestore.store["equipment_requests/E1"].lines, []);
  assert.equal(firestore.store["equipment_requests/E1"].status, "CANCELLED");
});

// ---- amend and resolve (G4) --------------------------------------------------------------------------

const amend = (changes = {}) => ({ eventId: "E1", lineIndex: 0, equipmentType: "AUDIO", quantity: 3, note: "More", userId: "tech-1", ...changes });
const resolve = (changes = {}) => ({ eventId: "E1", lineIndex: 0, reason: "Broken", userId: "tech-1", ...changes });

test("TC-1271 [failure] G4 amend validates the event, the line index, the type and the quantity first", async () => {
  const { actions } = actionsOver(base());
  await assert.rejects(actions.amendLine(amend({ eventId: 7 })), { message: "Choose an event before amending an equipment request." });
  await assert.rejects(actions.amendLine(amend({ lineIndex: "x" })), { message: "Choose a valid equipment request line." });
  await assert.rejects(actions.amendLine(amend({ equipmentType: "audio" })), { message: "Choose a supported equipment type." });
  await assert.rejects(actions.amendLine(amend({ quantity: 1.5 })), { message: "Quantity must be a whole number greater than zero." });
  await assert.rejects(actions.amendLine(amend({ note: 5 })), { message: "A note explaining the amendment is required." });
});

test("TC-1272 [conflict] G4 amend refuses a missing or non-Pending request, a missing line and a fulfilled line", async () => {
  await assert.rejects(actionsOver({}).actions.amendLine(amend()), { statusCode: 404, message: "Equipment request not found." });
  await assert.rejects(actionsOver(base({ "equipment_requests/E1": { status: "ARRANGED", lines: [] } })).actions.amendLine(amend()), { statusCode: 409 });
  await assert.rejects(actionsOver(base({ "equipment_requests/E1": { status: "PENDING" } })).actions.amendLine(amend()), { statusCode: 404, message: "Equipment request line not found." });
  await assert.rejects(actionsOver(base({ "equipment_requests/E1": { status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 1, fulfillment_status: "RESOLVED" }] } })).actions.amendLine(amend()), {
    statusCode: 409, message: "A reserved or resolved line cannot be amended."
  });
});

test("TC-1273 [boundary] G4 only an active reservation of the same type for that line (or no line) blocks an amendment", async () => {
  const blocking = actionsOver(base({ "equipment_reservations/R1": { event_id: "E1", equipment_type: "AUDIO", status: "reserved" } }));
  await assert.rejects(blocking.actions.amendLine(amend()), { statusCode: 409, message: "A line with an active reservation cannot be amended." });
  const harmless = actionsOver(base({
    "equipment_reservations/R1": { event_id: "E1", equipment_type: "VISUAL", status: "RESERVED", line_index: 0 },
    "equipment_reservations/R2": { event_id: "E1", equipment_type: "AUDIO", status: "RESERVED", line_index: 3 },
    "equipment_reservations/R3": { event_id: "E1", equipment_type: "AUDIO", line_index: 0 }
  }));
  assert.equal((await harmless.actions.amendLine(amend())).line.quantity, 3);
});

test("TC-1274 [failure] G4 unable-to-fulfil validates the event and the line index first", async () => {
  const { actions } = actionsOver(base());
  await assert.rejects(actions.resolveLine(resolve({ eventId: "" })), { message: "Choose an event before resolving an equipment line." });
  await assert.rejects(actions.resolveLine(resolve({ lineIndex: -1 })), { message: "Choose a valid equipment request line." });
});

test("TC-1275 [conflict] G4 unable-to-fulfil refuses a non-Pending request, a missing or fulfilled line and an actively reserved line", async () => {
  await assert.rejects(actionsOver(base({ "equipment_requests/E1": { status: "CANCELLED", lines: [] } })).actions.resolveLine(resolve()), { statusCode: 409 });
  await assert.rejects(actionsOver(base({ "equipment_requests/E1": { status: "PENDING" } })).actions.resolveLine(resolve()), { statusCode: 404 });
  await assert.rejects(actionsOver(base({ "equipment_requests/E1": { status: "PENDING", lines: [{ equipment_type: "AUDIO", fulfillment_status: "RESERVED" }] } })).actions.resolveLine(resolve()), {
    statusCode: 409, message: "This equipment request line has already been fulfilled or resolved."
  });
  await assert.rejects(actionsOver(base({ "equipment_reservations/R1": { event_id: "E1", equipment_type: "AUDIO", status: "APPROVED", line_index: 0 } })).actions.resolveLine(resolve()), {
    statusCode: 409, message: "This line has an active reservation and cannot be resolved."
  });
  const harmless = actionsOver(base({
    "equipment_reservations/R1": { event_id: "E1", equipment_type: "VISUAL", status: "RESERVED" },
    "equipment_reservations/R2": { event_id: "E1", equipment_type: "AUDIO", status: "RESERVED", line_index: 2 },
    "equipment_reservations/R3": { event_id: "E1", equipment_type: "AUDIO" }
  }));
  assert.equal((await harmless.actions.resolveLine(resolve())).status, "ARRANGED");
});

// ---- notices -----------------------------------------------------------------------------------------

test("TC-2162 [boundary] J5/J6 a line with no type reads as 'equipment' and a missing reason reads as blank", () => {
  assert.equal(amendedMessage({ eventName: "", lines: [{ quantity: 2 }] }), "An event: the equipment request was amended. Now requested: 2 × equipment.");
  assert.equal(unableMessage({ eventName: "Gala", line: { quantity: 1 } }), "Gala: Technical Support cannot fulfil 1 × equipment. Reason: ");
  assert.match(arrangedMessage({ lines: [{ quantity: 1, fulfillment_status: "RESERVED" }] }), /^Your event: your equipment is reserved\. Reserved: 1 × equipment\.$/);
});

const notifierOver = (seed) => {
  const firestore = storeFirestore(seed);
  return { firestore, notifier: createSupportNotifier({ firestore, serverTimestamp: () => "STAMP" }) };
};
const confirmedEvent = (changes = {}) => ({ "events/E1": { coordinator_id: "coord-1", name: "Gala", status: "CONFIRMED", confirmed_at: "2026-11-01T02:00:00.000Z", ...changes } });
const tech = { "users/tech-1": { role: "TECHNICAL_SUPPORT_STAFF", is_active: true } };

test("TC-0493 [failure] D3 AC5 the confirmation notice needs an event id", async () => {
  await assert.rejects(notifierOver({}).notifier.notifyConfirmed({ eventId: " " }), { statusCode: 400 });
});

test("TC-0494 [boundary] D3 AC5 nothing is sent before confirmation, without equipment lines, without recipients, or twice", async () => {
  const request = { "equipment_requests/E1": { lines: [{ equipment_type: "AUDIO", quantity: 1 }] } };
  const cases = [
    { ...tech, ...request, ...confirmedEvent({ status: "SAFETY_REVIEW" }) },
    { ...tech, ...request, ...confirmedEvent({ confirmed_at: null }) },
    { ...tech, ...confirmedEvent() },
    { ...tech, ...confirmedEvent(), "equipment_requests/E1": {} },
    { ...request, ...confirmedEvent() },
    { ...tech, ...request, ...confirmedEvent(), "equipment_confirmation_notices/E1": { confirmed_at: "2026-11-01T02:00:00.000Z" } }
  ];
  for (const seed of cases) {
    const { firestore, notifier } = notifierOver(seed);
    assert.deepEqual(await notifier.notifyConfirmed({ eventId: "E1" }), { eventId: "E1", sent: 0 });
    assert.deepEqual(paths(firestore.store, "notifications/"), []);
  }
});

test("TC-0495 [normal] D3 AC5 a Timestamp confirmation time is told once, and a later re-confirmation is told again", async () => {
  const { firestore, notifier } = notifierOver({
    ...tech,
    ...confirmedEvent({ confirmed_at: { toDate: () => new Date("2026-11-02T02:00:00.000Z") } }),
    "equipment_requests/E1": { lines: [{ equipment_type: "AUDIO", quantity: 1 }] },
    "equipment_confirmation_notices/E1": { confirmed_at: "2026-11-01T02:00:00.000Z" }
  });
  assert.deepEqual(await notifier.notifyConfirmed({ eventId: "E1" }), { eventId: "E1", sent: 1 });
  assert.equal(firestore.store["equipment_confirmation_notices/E1"].confirmed_at, "2026-11-02T02:00:00.000Z");
  assert.match(firestore.store[paths(firestore.store, "notifications/")[0]].message, /^Gala was confirmed on .* SGT\. Its equipment arrangements are final\.$/);
});

test("TC-1311 [boundary] G5/D4 a release with no reason given, and a cancelled request's line found by document id", async () => {
  const single = reservationsOver(base({ "equipment_reservations/R1": reserved({ line_index: 0 }) }));
  await single.service.release({ reservationId: "R1", userId: "tech-1" });
  assert.equal(single.firestore.store["equipment_reservations/R1"].release_reason, "No longer required");

  const { firestore, service } = reservationsOver(base({
    "events/E1": { coordinator_id: "coord-1", status: "CANCELLED" },
    "equipment_requests/E1": { status: "ARRANGED", lines: [{ equipment_type: "AUDIO", quantity: 1, reservation_id: "doc-7" }] },
    "equipment_reservations/doc-7": { event_id: "E1", equipment_type: "AUDIO", quantity: 1, status: "RESERVED" }
  }));
  await service.releaseCancelledEventReservations({ eventId: "E1", userId: "coord-1" });
  assert.equal(firestore.store["equipment_requests/E1"].lines[0].fulfillment_status, "RELEASED");
});

test("TC-2163 [boundary] J5 a request line with no type is still compared and announced", async () => {
  const { notifier } = notifierOver({
    ...tech,
    "events/E1": { coordinator_id: "coord-1", name: "Gala", status: "PLANNING" },
    "equipment_requests/E1": { lines: [{ quantity: 1 }] }
  });
  assert.equal((await notifier.notifyTechnicalSupport({ eventId: "E1", userId: "coord-1" })).sent, 1);
});
