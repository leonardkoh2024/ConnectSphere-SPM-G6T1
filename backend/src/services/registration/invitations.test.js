// H7 / SCRUM-145 — Be invited to take a freed place. When a Registered place frees, the first
// person in the queue is invited in the same transaction, with a notification; the place is
// held for them for 48 hours (or until the event starts). They accept it to register, or
// decline it to leave the list. If it lapses they stay on the list and the place passes to the
// next person the next time anyone acts on the event.
// Runs under node's test runner: `npm run test:backend`.

import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { fakeFirestore } from "../../../testing/fakeFirestore.js";
import { createAttendeeRegistration } from "./register.js";
import { createRegistrationService } from "./service.js";

const NOW = new Date("2026-11-05T12:00:00+08:00");
const IN_48_HOURS = new Date(NOW.getTime() + 48 * 3600000);
const STAMP = { serverTimestamp: true };

const event = (changes = {}) => ({
  organiser_id: "organiser-1",
  name: "Harbour Tech Forum",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  status: "CONFIRMED",
  registration_required: true,
  registration_capacity: 2,
  registration_open_date: "2026-11-01",
  registration_open_time: "09:00",
  registration_close_date: "2026-11-10",
  registration_close_time: "17:00",
  ...changes
});

const record = (attendeeId, status, changes = {}) => ({
  registration_id: `e1_${attendeeId}`,
  event_id: "e1",
  attendee_id: attendeeId,
  status,
  ...changes
});
const queued = (attendeeId, hour, changes = {}) =>
  record(attendeeId, "WAITLISTED", { waitlisted_at: `2026-11-04T0${hour}:00:00.000Z`, registered_at: null, ...changes });

// Full (two places), with two people waiting: first, then second.
const fullWithQueue = (changes = {}) => ({
  "e1_attendee-1": record("attendee-1", "REGISTERED"),
  e1_x2: record("x2", "REGISTERED"),
  e1_first: queued("first", 1),
  e1_second: queued("second", 2),
  ...changes
});

const setup = ({ registrations = fullWithQueue(), eventChanges = {}, now = NOW } = {}) => {
  const firestore = fakeFirestore({ events: { e1: event(eventChanges) }, registrations, notifications: {} });
  const actions = createAttendeeRegistration({ firestore, serverTimestamp: () => STAMP, now: () => now });
  return { firestore, actions };
};

const notificationsFor = (firestore, userId) =>
  Object.values(firestore.store.notifications || {}).filter((notice) => notice.user_id === userId);

const refusedWith = async (promise, statusCode, reason, message) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.reason, reason);
    if (message) assert.match(error.message, message);
    return true;
  });
};

// ---- AC1: a freed place is offered to the first person, with a notification ------------

test("TC-1687 H7 AC1 a Registered place freed by withdrawal is offered to the first in the queue, in the same transaction", async () => {
  const { firestore, actions } = setup();
  await actions.withdraw({ eventId: "e1", attendeeId: "attendee-1" });

  const first = firestore.store.registrations.e1_first;
  assert.equal(first.status, "WAITLISTED");
  assert.deepEqual(first.invited_at, STAMP);
  assert.equal(first.invitation_expires_at.toISOString(), IN_48_HOURS.toISOString());
  assert.equal(firestore.store.registrations.e1_second.invitation_expires_at, undefined);
  assert.equal(firestore.log.transactions, 1);
});

test("TC-1688 H7 AC1 the invited attendee is notified, with the event and when the offer ends", async () => {
  const { firestore, actions } = setup();
  await actions.withdraw({ eventId: "e1", attendeeId: "attendee-1" });

  const [notice] = notificationsFor(firestore, "first");
  assert.equal(notice.type, "WAITLIST_PLACE_OFFERED");
  assert.equal(notice.event_id, "e1");
  assert.equal(notice.registration_id, "e1_first");
  assert.equal(notice.is_read, false);
  assert.match(notice.message, /Harbour Tech Forum/);
  assert.match(notice.message, /7 Nov 2026, 12:00/);
  assert.equal(notificationsFor(firestore, "second").length, 0);
});

test("TC-1689 H7 the offered place is held: someone not on the list cannot register into it", async () => {
  const { firestore, actions } = setup();
  await actions.withdraw({ eventId: "e1", attendeeId: "attendee-1" });
  await refusedWith(actions.register({ eventId: "e1", attendeeId: "outsider" }), 409, "full");
  assert.equal(firestore.store.registrations.e1_outsider, undefined);
});

test("TC-1690 H7 withdrawing a place on the waiting list frees nothing, so nobody is invited", async () => {
  const { firestore, actions } = setup();
  await actions.withdraw({ eventId: "e1", attendeeId: "first" });
  assert.equal(firestore.store.registrations.e1_second.invitation_expires_at, undefined);
  assert.equal(notificationsFor(firestore, "second").length, 0);
});

// ---- AC2: accepting registers them; nothing happens without it ---------------------------

// attendee-1's place freed, and was offered to `first`, before the time under test.
const invitedFirst = (expires = IN_48_HOURS) => fullWithQueue({
  "e1_attendee-1": record("attendee-1", "WITHDRAWN", { withdrawn_from: "REGISTERED", withdrawn_at: "2026-11-03T03:00:00.000Z" }),
  e1_first: queued("first", 1, { invited_at: "2026-11-03T04:00:00.000Z", invitation_expires_at: expires })
});

test("TC-1691 H7 AC2 the invited attendee accepts and is Registered", async () => {
  const { firestore, actions } = setup({ registrations: invitedFirst() });
  const result = await actions.acceptInvitation({ eventId: "e1", attendeeId: "first" });

  const first = firestore.store.registrations.e1_first;
  assert.equal(first.status, "REGISTERED");
  assert.deepEqual(first.registered_at, STAMP);
  assert.deepEqual(first.accepted_at, STAMP);
  assert.equal(result.registration.status, "REGISTERED");
  assert.equal(result.registration.active, true);
});

test("TC-1692 H7 AC2 an attendee is never registered without accepting: the invitation alone leaves them Waitlisted", async () => {
  const { firestore, actions } = setup();
  await actions.withdraw({ eventId: "e1", attendeeId: "attendee-1" });
  assert.equal(firestore.store.registrations.e1_first.status, "WAITLISTED");
});

test("TC-1693 H7 AC2 only someone holding an invitation can accept one", async () => {
  const { firestore, actions } = setup({ registrations: invitedFirst() });
  await refusedWith(actions.acceptInvitation({ eventId: "e1", attendeeId: "second" }), 409, "not_invited", /not been offered a place/i);
  await refusedWith(actions.acceptInvitation({ eventId: "e1", attendeeId: "stranger" }), 409, "not_invited");
  assert.equal(firestore.store.registrations.e1_second.status, "WAITLISTED");
});

// ---- AC3: 48 hours, or until the event starts ---------------------------------------------

test("TC-1694 H7 AC3 an invitation cannot be accepted once it has expired, and the attendee stays on the list", async () => {
  const { firestore, actions } = setup({ registrations: invitedFirst(new Date(NOW.getTime() - 1000)) });
  await refusedWith(actions.acceptInvitation({ eventId: "e1", attendeeId: "first" }), 409, "invitation_expired", /expired/i);
  assert.equal(firestore.store.registrations.e1_first.status, "WAITLISTED");
});

test("TC-1695 H7 AC3 an invitation issued close to the event ends when the event starts", async () => {
  const { firestore, actions } = setup({ eventChanges: { event_date: "2026-11-06", start_time: "09:00" } });
  await actions.withdraw({ eventId: "e1", attendeeId: "attendee-1" });
  assert.equal(firestore.store.registrations.e1_first.invitation_expires_at.toISOString(), "2026-11-06T01:00:00.000Z");
});

test("TC-1696 H7 AC3 nothing can be accepted once the event has started", async () => {
  const { actions } = setup({ registrations: invitedFirst(), now: new Date("2026-11-12T09:00:00+08:00") });
  await refusedWith(actions.acceptInvitation({ eventId: "e1", attendeeId: "first" }), 409, "event_started");
});

// ---- AC4: declining leaves the list; a lapse does not -------------------------------------

test("TC-1697 H7 AC4 declining removes the attendee from the list, and the place goes to the next person", async () => {
  const { firestore, actions } = setup({ registrations: invitedFirst() });
  await actions.declineInvitation({ eventId: "e1", attendeeId: "first" });

  const first = firestore.store.registrations.e1_first;
  assert.equal(first.status, "WITHDRAWN");
  assert.equal(first.withdrawn_from, "WAITLISTED");
  assert.deepEqual(first.declined_at, STAMP);
  assert.equal(firestore.store.registrations.e1_second.invitation_expires_at.toISOString(), IN_48_HOURS.toISOString());
  assert.equal(notificationsFor(firestore, "second")[0].type, "WAITLIST_PLACE_OFFERED");
});

test("TC-1698 H7 AC4 only someone holding an invitation can decline one", async () => {
  const { actions } = setup({ registrations: invitedFirst() });
  await refusedWith(actions.declineInvitation({ eventId: "e1", attendeeId: "second" }), 409, "not_invited");
});

test("TC-1699 H7 AC4 after a lapse, the next action on the event offers the place to the next person; the first keeps their spot", async () => {
  const { firestore, actions } = setup({ registrations: invitedFirst(new Date(NOW.getTime() - 1000)) });
  await refusedWith(actions.register({ eventId: "e1", attendeeId: "outsider" }), 409, "full");

  assert.equal(firestore.store.registrations.e1_first.status, "WAITLISTED");
  assert.equal(firestore.store.registrations.e1_second.invitation_expires_at.toISOString(), IN_48_HOURS.toISOString());
  assert.equal(notificationsFor(firestore, "second").length, 1);
  assert.equal(firestore.store.registrations.e1_outsider, undefined);
});

test("TC-1700 H7 AC4 the attendee whose invitation lapsed is offered the next place that frees", async () => {
  const lapsed = new Date(NOW.getTime() - 1000);
  const { firestore, actions } = setup({
    registrations: fullWithQueue({
      e1_first: queued("first", 1, { invited_at: "2026-11-03T04:00:00.000Z", invitation_expires_at: lapsed }),
      e1_x3: record("x3", "REGISTERED")
    }),
    eventChanges: { registration_capacity: 3 }
  });
  await actions.withdraw({ eventId: "e1", attendeeId: "attendee-1" });
  assert.equal(firestore.store.registrations.e1_first.invitation_expires_at.toISOString(), IN_48_HOURS.toISOString());
  assert.equal(firestore.store.registrations.e1_second.invitation_expires_at, undefined);
});

test("TC-1701 H7 leaving the list while holding an invitation passes the place on", async () => {
  const { firestore, actions } = setup({ registrations: invitedFirst() });
  await actions.withdraw({ eventId: "e1", attendeeId: "first" });
  assert.equal(firestore.store.registrations.e1_second.invitation_expires_at.toISOString(), IN_48_HOURS.toISOString());
});

// ---- the lists and the routes ---------------------------------------------------------------

const app = (firestore, now = NOW) => {
  const server = express();
  server.use(express.json());
  server.use("/api/registrations", createRegistrationService({
    firestore,
    verifyIdToken: async (token) => ({ uid: token }),
    now: () => now,
    serverTimestamp: () => STAMP,
    venueNamesFor: async () => ["Harbour Hall"]
  }));
  return server;
};

const call = async (firestore, { uid, path, method = "GET" }) => {
  const server = app(firestore).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const headers = uid ? { Authorization: `Bearer ${uid}` } : {};
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/registrations${path}`, { method, headers });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const routeStore = (registrations) => fakeFirestore({
  users: Object.fromEntries(["first", "second", "attendee-1", "outsider"].map((id) => [id, { role: "ATTENDEE" }])),
  events: { e1: event() },
  registrations,
  notifications: {}
});

test("TC-1702 H7 AC1 My registrations shows the invitation and when it ends", async () => {
  const { body } = await call(routeStore(invitedFirst()), { uid: "first", path: "/mine" });
  const entry = body.registrations.find((item) => item.event_id === "e1");
  assert.equal(entry.status, "WAITLISTED");
  assert.equal(entry.invitation_active, true);
  assert.equal(entry.can_accept, true);
  assert.equal(entry.invitation_expires_at, IN_48_HOURS.toISOString());
});

test("TC-1703 H7 AC4 opening My registrations passes a lapsed place to the waiting attendee next in line", async () => {
  const firestore = routeStore(invitedFirst(new Date(NOW.getTime() - 1000)));
  const { body } = await call(firestore, { uid: "second", path: "/mine" });
  const entry = body.registrations.find((item) => item.event_id === "e1");
  assert.equal(entry.invitation_active, true);
  assert.equal(notificationsFor(firestore, "second").length, 1);

  const firstView = (await call(firestore, { uid: "first", path: "/mine" })).body.registrations.find((item) => item.event_id === "e1");
  assert.equal(firstView.status, "WAITLISTED");
  assert.equal(firstView.invitation_lapsed, true);
  assert.equal(firstView.waitlist_position, 1);
});

test("TC-1704 H7 the open-events list counts an offered place as taken", async () => {
  const { body } = await call(routeStore(invitedFirst()), { uid: "outsider", path: "/open-events" });
  assert.equal(body.events.find((item) => item.id === "e1").remaining_places, 0);
});

test("TC-1705 H7 POST accept and decline answer with the registration, or the refusal's reason", async () => {
  const accepted = await call(routeStore(invitedFirst()), { uid: "first", path: "/events/e1/invitation/accept", method: "POST" });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.registration.status, "REGISTERED");
  assert.deepEqual(accepted.body.registration.venue_names, ["Harbour Hall"]);

  const declined = await call(routeStore(invitedFirst()), { uid: "first", path: "/events/e1/invitation/decline", method: "POST" });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.registration.status, "WITHDRAWN");

  const refused = await call(routeStore(invitedFirst()), { uid: "second", path: "/events/e1/invitation/accept", method: "POST" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.reason, "not_invited");
});

test("TC-1706 H7 only a signed-in Attendee may accept or decline", async () => {
  const firestore = routeStore(invitedFirst());
  firestore.store.users.organiser = { role: "EVENT_ORGANISER" };
  assert.equal((await call(firestore, { path: "/events/e1/invitation/accept", method: "POST" })).status, 401);
  const organiser = await call(firestore, { uid: "organiser", path: "/events/e1/invitation/decline", method: "POST" });
  assert.equal(organiser.status, 403);
  assert.equal(firestore.store.registrations.e1_first.status, "WAITLISTED");
});
