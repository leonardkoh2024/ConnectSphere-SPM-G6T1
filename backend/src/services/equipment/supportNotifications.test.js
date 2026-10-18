// J5 / SCRUM-154 — Technical Support are told when equipment work arrives or changes.
//
// "Responsible for the event" is every active Technical Support member: nobody is
// attached to an event, and all of them work one shared queue. A coordinator's
// browser cannot list Technical Support accounts, so the equipment service (Admin
// SDK) writes these notices. It remembers what it last told Technical Support
// (`equipment_request_notices/{eventId}`) and only speaks when the saved request
// differs from that, so asking twice never sends twice.

import assert from "node:assert/strict";
import test from "node:test";

import {
  amendedMessage,
  createSupportNotifier,
  noticeState,
  onSiteChangedMessage,
  onSiteNeededMessage,
  raisedMessage,
  supportNoticeChanges,
  technicalSupportRecipients
} from "./supportNotifications.js";

const AUDIO = { equipment_type: "AUDIO", quantity: 2, technical_requirements: "Wireless" };
const LIGHTING = { equipment_type: "LIGHTING", quantity: 1, technical_requirements: "" };
const request = (overrides = {}) => ({
  status: "PENDING",
  lines: [AUDIO],
  on_site_support: false,
  on_site_support_details: "",
  ...overrides
});

// ---- what changed (pure) -------------------------------------------------------------

test("J5-TC1 AC1 AC2 a request seen for the first time is raised, and on-site support is raised with it when asked for", () => {
  assert.deepEqual(supportNoticeChanges({ previous: null, current: request() }), ["EQUIPMENT_REQUEST_RAISED"]);
  assert.deepEqual(
    supportNoticeChanges({ previous: null, current: request({ on_site_support: true, on_site_support_details: "Two technicians" }) }),
    ["EQUIPMENT_REQUEST_RAISED", "ON_SITE_SUPPORT_REQUIRED"]
  );
});

test("J5-TC2 AC3 AC4 saving the same request again changes nothing, so nothing is sent", () => {
  const current = request({ on_site_support: true, on_site_support_details: "Two technicians" });
  assert.deepEqual(supportNoticeChanges({ previous: noticeState(current), current }), []);
  // The state is a copy of what was told, not a reference to the request.
  assert.deepEqual(supportNoticeChanges({ previous: noticeState(request()), current: request() }), []);
});

test("J5-TC3 AC3 a changed type, quantity, requirement or number of lines is an amendment", () => {
  const previous = noticeState(request());
  const changed = [
    request({ lines: [{ ...AUDIO, quantity: 3 }] }),
    request({ lines: [{ ...AUDIO, equipment_type: "VISUAL" }] }),
    request({ lines: [{ ...AUDIO, technical_requirements: "Wired" }] }),
    request({ lines: [AUDIO, LIGHTING] })
  ];
  changed.forEach((current) => assert.deepEqual(supportNoticeChanges({ previous, current }), ["EQUIPMENT_REQUEST_AMENDED"]));
});

test("J5-TC4 AC2 AC4 on-site support turning on is needed, turning off or being reworded is a change", () => {
  const off = noticeState(request());
  const on = noticeState(request({ on_site_support: true, on_site_support_details: "Two technicians" }));
  assert.deepEqual(
    supportNoticeChanges({ previous: off, current: request({ on_site_support: true, on_site_support_details: "Two technicians" }) }),
    ["ON_SITE_SUPPORT_REQUIRED"]
  );
  assert.deepEqual(supportNoticeChanges({ previous: on, current: request() }), ["ON_SITE_SUPPORT_CHANGED"]);
  assert.deepEqual(
    supportNoticeChanges({ previous: on, current: request({ on_site_support: true, on_site_support_details: "Three technicians" }) }),
    ["ON_SITE_SUPPORT_CHANGED"]
  );
});

test("J5-TC5 AC3 AC4 an amendment and an on-site change in one save are both told, amendment first", () => {
  assert.deepEqual(
    supportNoticeChanges({
      previous: noticeState(request()),
      current: request({ lines: [AUDIO, LIGHTING], on_site_support: true, on_site_support_details: "Two technicians" })
    }),
    ["EQUIPMENT_REQUEST_AMENDED", "ON_SITE_SUPPORT_REQUIRED"]
  );
});

// ---- what it says ----------------------------------------------------------------------

test("J5-TC6 each message names the event and the change", () => {
  assert.equal(
    raisedMessage({ eventName: "Partner Summit", lines: [AUDIO] }),
    "Partner Summit: an equipment request was raised. Requested: 2 × audio."
  );
  assert.equal(
    amendedMessage({ eventName: "Partner Summit", lines: [{ ...AUDIO, quantity: 3 }, LIGHTING] }),
    "Partner Summit: the equipment request was amended. Now requested: 3 × audio, 1 × lighting."
  );
  assert.equal(
    onSiteNeededMessage({ eventName: "Partner Summit", details: "  Two technicians for setup  " }),
    "Partner Summit: on-site support is needed. Two technicians for setup"
  );
  assert.equal(
    onSiteChangedMessage({ eventName: "Partner Summit", needed: true, details: "Three technicians" }),
    "Partner Summit: the on-site support needed has changed. Three technicians"
  );
  assert.equal(
    onSiteChangedMessage({ eventName: "Partner Summit", needed: false }),
    "Partner Summit: on-site support is no longer needed."
  );
  assert.match(raisedMessage({ lines: [AUDIO] }), /^An event: /);
});

// ---- who is told ---------------------------------------------------------------------------

test("J5-TC7 AC1 every active Technical Support member is told, and nobody else", () => {
  const doc = (id, data) => ({ id, data: () => data });
  assert.deepEqual(
    technicalSupportRecipients([
      doc("tech-1", { role: "TECHNICAL_SUPPORT_STAFF", is_active: true }),
      doc("tech-2", { role: "TECHNICAL_SUPPORT_STAFF" }),
      doc("tech-3", { role: "TECHNICAL_SUPPORT_STAFF", is_active: false }),
      doc("coord-1", { role: "EVENT_COORDINATOR", is_active: true })
    ]),
    ["tech-1", "tech-2"]
  );
});

// ---- the notifier, against a fake database -------------------------------------------------

const fixture = ({
  current = request(),
  event = { coordinator_id: "coord-1", name: "Partner Summit", reference_no: "EVT-001", status: "APPROVED" },
  users = [
    ["tech-1", { role: "TECHNICAL_SUPPORT_STAFF", is_active: true }],
    ["tech-2", { role: "TECHNICAL_SUPPORT_STAFF" }],
    ["tech-gone", { role: "TECHNICAL_SUPPORT_STAFF", is_active: false }]
  ]
} = {}) => {
  const state = { request: current, event };
  const stored = new Map();
  const created = [];
  const sets = [];
  let counter = 0;
  const transaction = {
    async get(reference) {
      if (reference.collectionName === "users") {
        return { docs: users.map(([id, data]) => ({ id, data: () => data })) };
      }
      const data = reference.path === "equipment_requests/event-1" ? state.request
        : reference.path === "events/event-1" ? state.event
          : stored.get(reference.path);
      return { exists: data !== undefined && data !== null, data: () => data };
    },
    create(reference, data) { created.push({ reference, data }); },
    set(reference, data) { sets.push({ reference, data }); stored.set(reference.path, data); }
  };
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          const docId = id ?? `${name}-${++counter}`;
          return { id: docId, path: `${name}/${docId}`, collectionName: name };
        },
        where(field, _operator, value) {
          return { collectionName: name, filters: [[field, value]] };
        }
      };
    },
    runTransaction: async (callback) => callback(transaction)
  };
  const notifier = createSupportNotifier({ firestore, serverTimestamp: () => ({ serverTimestamp: true }) });
  const notify = (overrides = {}) => notifier.notifyTechnicalSupport({ eventId: "event-1", userId: "coord-1", ...overrides });
  return { state, created, sets, notify };
};

test("J5-TC8 AC1 the first save raises the request to every active Technical Support member, in the inbox's shape", async () => {
  const { created, sets, notify } = fixture();
  const result = await notify();

  assert.deepEqual(result, { eventId: "event-1", sent: 2, types: ["EQUIPMENT_REQUEST_RAISED"] });
  assert.deepEqual(created.map(({ data }) => data.user_id), ["tech-1", "tech-2"]);
  created.forEach(({ reference, data }) => {
    assert.equal(reference.collectionName, "notifications");
    assert.equal(data.notification_id, reference.id);
    assert.equal(data.event_id, "event-1");
    assert.equal(data.type, "EQUIPMENT_REQUEST_RAISED");
    assert.match(data.message, /^Partner Summit: an equipment request was raised\./);
    assert.equal(data.is_read, false);
    assert.equal(data.read_at, null);
    assert.deepEqual(data.created_at, { serverTimestamp: true });
  });
  assert.equal(new Set(created.map(({ reference }) => reference.id)).size, 2);
  // What it has now told them is remembered, so the next save is compared against it.
  assert.equal(sets.length, 1);
  assert.equal(sets[0].reference.path, "equipment_request_notices/event-1");
  Object.entries(noticeState(request())).forEach(([key, value]) => assert.deepEqual(sets[0].data[key], value));
  assert.equal(sets[0].data.event_id, "event-1");
  assert.deepEqual(sets[0].data.notified_at, { serverTimestamp: true });
});

test("J5-TC9 AC3 asking again with nothing changed sends nothing and writes nothing", async () => {
  const { created, sets, notify } = fixture();
  await notify();
  const [createdBefore, setsBefore] = [created.length, sets.length];

  const again = await notify();
  assert.deepEqual(again, { eventId: "event-1", sent: 0, types: [] });
  assert.equal(created.length, createdBefore);
  assert.equal(sets.length, setsBefore);
});

test("J5-TC10 AC3 an amended request is told to everyone, with what is now requested", async () => {
  const { state, created, notify } = fixture();
  await notify();
  created.length = 0;

  state.request = request({ lines: [{ ...AUDIO, quantity: 3 }] });
  const result = await notify();
  assert.deepEqual(result, { eventId: "event-1", sent: 2, types: ["EQUIPMENT_REQUEST_AMENDED"] });
  assert.deepEqual(created.map(({ data }) => data.type), ["EQUIPMENT_REQUEST_AMENDED", "EQUIPMENT_REQUEST_AMENDED"]);
  assert.match(created[0].data.message, /^Partner Summit: the equipment request was amended\. Now requested: 3 × audio\.$/);
});

test("J5-TC11 AC2 a request that needs on-site support tells them so, naming the event and what is needed", async () => {
  const { created, notify } = fixture({ current: request({ on_site_support: true, on_site_support_details: "Two technicians for setup" }) });
  const result = await notify();

  assert.deepEqual(result.types, ["EQUIPMENT_REQUEST_RAISED", "ON_SITE_SUPPORT_REQUIRED"]);
  assert.equal(result.sent, 4);
  const onSite = created.filter(({ data }) => data.type === "ON_SITE_SUPPORT_REQUIRED");
  assert.deepEqual(onSite.map(({ data }) => data.user_id), ["tech-1", "tech-2"]);
  assert.equal(onSite[0].data.message, "Partner Summit: on-site support is needed. Two technicians for setup");
});

test("J5-TC12 AC4 withdrawing or rewording the on-site support is told as a change", async () => {
  const { state, created, notify } = fixture({ current: request({ on_site_support: true, on_site_support_details: "Two technicians" }) });
  await notify();
  created.length = 0;

  state.request = request({ on_site_support: true, on_site_support_details: "Three technicians" });
  assert.deepEqual((await notify()).types, ["ON_SITE_SUPPORT_CHANGED"]);
  assert.equal(created[0].data.message, "Partner Summit: the on-site support needed has changed. Three technicians");
  created.length = 0;

  state.request = request();
  assert.deepEqual((await notify()).types, ["ON_SITE_SUPPORT_CHANGED"]);
  assert.equal(created[0].data.message, "Partner Summit: on-site support is no longer needed.");
});

test("J5-TC13 only the event's coordinator can ask, and a missing event, request or id is refused before any write", async () => {
  const stranger = fixture();
  await assert.rejects(stranger.notify({ userId: "coord-2" }), { statusCode: 403 });
  assert.equal(stranger.created.length + stranger.sets.length, 0);

  const noRequest = fixture({ current: null });
  await assert.rejects(noRequest.notify(), { statusCode: 404 });
  assert.equal(noRequest.created.length + noRequest.sets.length, 0);

  const noEvent = fixture({ event: null });
  await assert.rejects(noEvent.notify(), { statusCode: 404 });

  const blank = fixture();
  await assert.rejects(blank.notify({ eventId: "  " }), { statusCode: 400 });
  assert.equal(blank.created.length + blank.sets.length, 0);
});

test("J5-TC14 a completed, cancelled or rejected event tells Technical Support nothing", async () => {
  for (const status of ["COMPLETED", "CANCELLED", "REJECTED"]) {
    const { created, sets, notify } = fixture({ event: { coordinator_id: "coord-1", name: "Partner Summit", status } });
    assert.deepEqual(await notify(), { eventId: "event-1", sent: 0, types: [] });
    assert.equal(created.length + sets.length, 0);
  }
});

test("J5-TC15 with nobody active to tell, nothing is written, so the first member to join is still told next time", async () => {
  const { created, sets, notify } = fixture({
    users: [["tech-gone", { role: "TECHNICAL_SUPPORT_STAFF", is_active: false }]]
  });
  assert.deepEqual(await notify(), { eventId: "event-1", sent: 0, types: [] });
  assert.equal(created.length + sets.length, 0);
});
