// Keeps the emulator baseline (fixtures.js) internally consistent, so integration tests never
// fail because the seed data itself is wrong. Pure data checks — runs in the normal unit run,
// no emulator needed.

import test from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";

import { baseline, IDS } from "./fixtures.js";

const ROLES = ["EVENT_ORGANISER", "EVENT_COORDINATOR", "EVENT_COORDINATOR_LEAD", "VENUE_STAFF",
  "TECHNICAL_SUPPORT_STAFF", "SAFETY_OFFICER", "ATTENDEE"];
const EVENT_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "PLANNING", "SAFETY_REVIEW",
  "CONFIRMED", "COMPLETED", "CANCELLED", "REJECTED"];
const BOOKING_STATUSES = ["PENDING", "HELD", "APPROVED", "REJECTED", "WITHDRAWN", "RELEASED", "REPLACED", "EXPIRED"];
const ACTIVE_BOOKING = ["PENDING", "HELD", "APPROVED"];

const docs = baseline();
const byCollection = (name) => docs.filter(({ path }) => path.split("/")[0] === name)
  .map(({ path, data }) => ({ id: path.split("/")[1], ...data }));
const find = (name, id) => byCollection(name).find((doc) => doc.id === id);

const users = byCollection("users");
const events = byCollection("events");
const venues = byCollection("venues");
const bookings = byCollection("venue_bookings");

test("every document path is a collection/id pair and no path repeats", () => {
  const paths = docs.map(({ path }) => path);
  for (const path of paths) assert.match(path, /^[a-z_]+\/[^/]+$/, path);
  assert.equal(new Set(paths).size, paths.length, "duplicate path");
});

test("baseline() returns fresh objects each call", () => {
  const first = baseline();
  first[0].data.name = "changed";
  assert.notEqual(baseline()[0].data.name, "changed");
});

test("there is a user for every role, all active", () => {
  for (const role of ROLES) assert.ok(users.some((u) => u.role === role), `no ${role}`);
  for (const u of users) {
    assert.ok(ROLES.includes(u.role), `${u.id} has unknown role ${u.role}`);
    assert.equal(u.user_id, u.id);
    assert.equal(u.is_active, true);
    assert.match(u.mobile_number, /^[0-9]{7,15}$/);
  }
});

test("there is an event in every status", () => {
  for (const status of EVENT_STATUSES) assert.ok(events.some((e) => e.status === status), `no ${status} event`);
  for (const e of events) assert.ok(EVENT_STATUSES.includes(e.status), `${e.id}: ${e.status}`);
});

test("events link to users with the right role", () => {
  const roleOf = (id) => find("users", id)?.role;
  for (const e of events) {
    assert.equal(roleOf(e.organiser_id), "EVENT_ORGANISER", `${e.id} organiser`);
    if (e.status === "DRAFT" || e.status === "SUBMITTED") {
      assert.equal(e.coordinator_id, null, `${e.id} should be unassigned (K1)`);
    } else {
      assert.equal(roleOf(e.coordinator_id), "EVENT_COORDINATOR", `${e.id} coordinator`);
      assert.ok(find("coordinator_assignments", `${e.id}_${e.coordinator_id}`), `${e.id} has no assignment record`);
    }
  }
});

test("venues carry every field Venue Staff edits need, with integer sizes", () => {
  for (const v of venues) {
    for (const field of ["max_capacity", "setup_minutes", "turnaround_minutes"]) {
      assert.ok(Number.isInteger(v[field]) && v[field] >= 0, `${v.id}.${field}`);
    }
    assert.ok(v.layouts.length > 0, `${v.id} layouts`);
    for (const field of ["facilities", "accessibility", "operating_hours"]) assert.ok(Array.isArray(v[field]), `${v.id}.${field}`);
    for (const field of ["emergency_access_notes", "known_restrictions", "special_space_availability"]) {
      assert.equal(typeof v[field], "string", `${v.id}.${field}`);
    }
    const staff = find("venue_staff", v.id);
    assert.ok(staff, `${v.id} has no venue_staff doc keyed by its id`);
    assert.equal(find("users", staff.user_id)?.role, "VENUE_STAFF");
  }
});

test("bookings are valid and fit their event and venue", () => {
  for (const b of bookings) {
    const e = find("events", b.event_id);
    const v = find("venues", b.venue_id);
    assert.ok(e && v, `${b.id} links`);
    assert.ok(BOOKING_STATUSES.includes(b.status), `${b.id}: ${b.status}`);
    assert.ok(Number.isInteger(b.expected_attendance) && b.expected_attendance > 0);
    assert.ok(b.expected_attendance <= e.expected_attendance, `${b.id} over event attendance`);
    assert.ok(b.expected_attendance <= v.max_capacity, `${b.id} over venue capacity`);
    // Occupied window = start − setup to end + turnaround, using the venue's values (E9/F9).
    assert.equal(b.occupied_start.toMillis(), b.start_datetime.toMillis() - v.setup_minutes * 60_000, `${b.id} occupied_start`);
    assert.equal(b.occupied_end.toMillis(), b.end_datetime.toMillis() + v.turnaround_minutes * 60_000, `${b.id} occupied_end`);
    if (b.status === "HELD") {
      assert.ok(b.hold_expires_at.toMillis() < b.occupied_start.toMillis(), `${b.id} hold must end before the booking`);
    }
  }
});

test("no two active bookings of the same venue overlap", () => {
  const active = bookings.filter((b) => ACTIVE_BOOKING.includes(b.status));
  for (const a of active) for (const b of active) {
    if (a.id >= b.id || a.venue_id !== b.venue_id) continue;
    const overlap = a.occupied_start.toMillis() < b.occupied_end.toMillis() && b.occupied_start.toMillis() < a.occupied_end.toMillis();
    assert.ok(!overlap, `${a.id} clashes with ${b.id}`);
  }
});

test("confirmed and later events point at an approved booking and a passed safety check", () => {
  const confirmed = find("events", IDS.events.confirmed);
  const booking = find("venue_bookings", confirmed.approved_venue_booking_id);
  assert.equal(booking.status, "APPROVED");
  assert.equal(booking.event_id, confirmed.id);
  const review = find("safety_reviews", confirmed.last_safety_review_id);
  assert.equal(review.outcome, "APPROVE");
  assert.equal(review.event_id, confirmed.id);
  assert.equal(find("users", review.reviewer_id).role, "SAFETY_OFFICER");
});

test("the open clarification belongs to the under-review event", () => {
  const e = find("events", IDS.events.underReview);
  const c = find("clarification_requests", e.open_clarification_id);
  assert.equal(c.status, "OPEN");
  assert.equal(c.event_id, e.id);
});

test("registrations fill the confirmed event exactly, with one on the waiting list", () => {
  const e = find("events", IDS.events.confirmed);
  const regs = byCollection("registrations");
  for (const r of regs) {
    assert.equal(r.id, `${r.event_id}_${r.attendee_id}`);
    assert.equal(find("users", r.attendee_id).role, "ATTENDEE");
  }
  assert.equal(regs.filter((r) => r.status === "REGISTERED").length, e.registration_capacity);
  assert.equal(regs.filter((r) => r.status === "WAITLISTED").length, 1);
});

test("equipment requests and reservations stay within stock and link up", () => {
  const stock = Object.fromEntries(byCollection("equipment_inventory").map((i) => [i.equipment_type, i.total_quantity]));
  for (const r of byCollection("equipment_requests")) {
    assert.equal(r.id, r.event_id);
    assert.equal(r.request_id, r.event_id);
    for (const line of r.lines) assert.ok(line.quantity <= stock[line.equipment_type], `${r.id} ${line.equipment_type}`);
  }
  for (const res of byCollection("equipment_reservations")) {
    assert.ok(res.quantity <= stock[res.equipment_type]);
    const approvedBooking = bookings.find((b) => b.event_id === res.event_id && b.status === "APPROVED");
    assert.ok(approvedBooking, `${res.id} needs an approved booking on its event`);
  }
});

test("every *_id / user reference in the records points at a real document", () => {
  const refs = [
    ["notifications", "user_id", "users"], ["notifications", "event_id", "events"],
    ["event_history", "event_id", "events"], ["change_requests", "event_id", "events"],
    ["change_requests", "organiser_id", "users"], ["safety_reviews", "event_id", "events"],
    ["equipment_reservations", "event_id", "events"], ["venue_unavailability", "venue_id", "venues"],
    ["event_venue_requirements", "event_id", "events"], ["event_facilities", "event_id", "events"],
    ["event_accessibility", "event_id", "events"], ["event_equipment", "event_id", "events"],
  ];
  for (const [collection, field, target] of refs) {
    for (const doc of byCollection(collection)) assert.ok(find(target, doc[field]), `${collection}/${doc.id}.${field} → ${doc[field]}`);
  }
});

test("dates are fixed Firestore Timestamps or YYYY-MM-DD / HH:MM strings", () => {
  for (const e of events) {
    if (e.event_date) assert.match(e.event_date, /^\d{4}-\d{2}-\d{2}$/);
    for (const field of ["start_time", "end_time"]) if (e[field]) assert.match(e[field], /^\d{2}:\d{2}$/);
    assert.ok(e.created_at instanceof admin.firestore.Timestamp);
  }
});
