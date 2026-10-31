// Proves the shared baseline (fixtures.js) seeds into the emulator intact, that real service code
// can act on it, and that every test gets it back untouched afterwards.

import test from "node:test";
import assert from "node:assert/strict";

import { emulatorFirestore, serverTimestamp, useFreshBaseline } from "./firestoreEmulator.js";
import { baseline, IDS, sgt } from "./fixtures.js";
import { createAttendeeRegistration } from "../src/services/registration/register.js";
import { createRegistrationList } from "../src/services/registration/attendeeList.js";

const db = emulatorFirestore();
useFreshBaseline(db, baseline);

const { users: U, events: E, venues: V } = IDS;
const registration = (attendeeId) => db.doc(`registrations/${E.confirmed}_${attendeeId}`);

test("TC-1711 every baseline document is in the emulator, exactly as written", async () => {
  const expected = baseline();
  const snapshots = await db.getAll(...expected.map(({ path }) => db.doc(path)));
  expected.forEach(({ path, data }, i) => {
    assert.ok(snapshots[i].exists, `${path} missing`);
    assert.deepEqual(snapshots[i].data(), data, `${path} differs`);
  });
});

test("TC-1712 real service code works on the baseline: withdrawing frees a place for the waiting list (H7)", async () => {
  const registrations = createAttendeeRegistration({ firestore: db, serverTimestamp, now: () => sgt("2027-02-01", "10:00").toDate() });

  await registrations.withdraw({ eventId: E.confirmed, attendeeId: U.attendee });

  assert.equal((await registration(U.attendee).get()).data().status, "WITHDRAWN");
  const waiting = (await registration(U.attendee3).get()).data();
  assert.ok(waiting.invited_at, "the waitlisted attendee is invited to apply");
  const offers = await db.collection("notifications")
    .where("user_id", "==", U.attendee3).where("type", "==", "WAITLIST_PLACE_OFFERED").get();
  assert.equal(offers.size, 1);
});

test("TC-1713 …and the next test starts from the untouched baseline again", async () => {
  assert.equal((await registration(U.attendee).get()).data().status, "REGISTERED");
  assert.equal((await registration(U.attendee3).get()).data().invited_at, undefined);
  const offers = await db.collection("notifications").where("type", "==", "WAITLIST_PLACE_OFFERED").get();
  assert.equal(offers.size, 0);
});

test("TC-1714 the organiser's attendee list reads the baseline registrations", async () => {
  const list = await createRegistrationList({ firestore: db }).load({ eventId: E.confirmed, userId: U.organiser });
  assert.deepEqual(list.counts, { registered: 2, waitlisted: 1, withdrawn: 0 });
});

test("TC-1715 a test may delete and update baseline data freely", async () => {
  await db.doc(`events/${E.draft}`).delete();
  await db.doc(`venues/${V.hallA}`).update({ setup_minutes: 90 });
  assert.equal((await db.doc(`events/${E.draft}`).get()).exists, false);
});

test("TC-1716 …and both changes are undone for the next test", async () => {
  assert.ok((await db.doc(`events/${E.draft}`).get()).exists);
  assert.equal((await db.doc(`venues/${V.hallA}`).get()).data().setup_minutes, 30);
});
