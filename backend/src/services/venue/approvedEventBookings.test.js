import assert from "node:assert/strict";
import test from "node:test";

import { fakeFirestore } from "../../../testing/fakeFirestore.js";
import { getApprovedEventBookings, getApprovedEventVenueNames } from "./approvedEventBookings.js";

const seed = () => ({
  venue_bookings: {
    b1: { event_id: "E1", venue_id: "V1", status: "APPROVED" },
    b2: { event_id: "E1", venue_id: "V2", status: "APPROVED" },
    b3: { event_id: "E1", venue_id: "V1", status: "APPROVED" },
    b4: { event_id: "E1", venue_id: "V3", status: "HELD" },
    b5: { event_id: "E1", status: "APPROVED" },
    b6: { event_id: "E2", venue_id: "V1", status: "APPROVED" }
  },
  venues: { V1: { name: "Main Hall" }, V2: {} }
});

test("TC-1052 [normal] F12 an event's approved bookings are read inside the caller's transaction", async () => {
  const firestore = fakeFirestore(seed());
  const bookings = await firestore.runTransaction((transaction) => getApprovedEventBookings({ firestore, transaction, eventId: "E1" }));
  assert.deepEqual(bookings.map((booking) => booking.venue_id), ["V1", "V2", "V1", undefined]);
  assert.deepEqual(firestore.log.reads, ["venue_bookings?event_id=E1&status=APPROVED"]);
});

test("TC-1452 [boundary] H2 venue names come once each in booking order, falling back to the id", async () => {
  const firestore = fakeFirestore(seed());
  assert.deepEqual(await getApprovedEventVenueNames({ firestore, eventId: "E1" }), ["Main Hall", "V2"]);
  assert.deepEqual(await getApprovedEventVenueNames({ firestore, eventId: "none" }), []);
});

test("TC-1453 [failure] H2 a venue missing from the catalogue is named by its id", async () => {
  const firestore = fakeFirestore({ venue_bookings: { b1: { event_id: "E1", venue_id: "GONE", status: "APPROVED" } }, venues: {} });
  assert.deepEqual(await getApprovedEventVenueNames({ firestore, eventId: "E1" }), ["GONE"]);
});
