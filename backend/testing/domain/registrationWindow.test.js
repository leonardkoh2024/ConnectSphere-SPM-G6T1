// H1 / I3 AC4–AC5 — frontend/src/domain/registrationWindow.mjs: the registration window, capacity
// limits and the re-check after a significant change. Singapore time, half-open window.
import assert from "node:assert/strict";
import test from "node:test";

import {
  capacityReductionNeedsAcknowledgement,
  registeredFloorMessage,
  registrationAttemptRefusal,
  registrationInstant,
  registrationPhase,
  registrationRecheckApplies,
  registrationReview,
  registrationSetupRefusal,
  validateRegistrationSettings,
  venueCapacityCeiling
} from "../../../frontend/src/domain/registrationWindow.mjs";

const NOW = new Date("2026-11-05T04:00:00Z");
const event = (changes = {}) => ({
  status: "CONFIRMED", registration_required: true, registration_capacity: 50,
  event_date: "2026-11-12", start_time: "09:00",
  registration_open_date: "2026-11-01", registration_open_time: "09:00",
  registration_close_date: "2026-11-10", registration_close_time: "17:00", ...changes
});
const input = (changes = {}) => ({
  registrationCapacity: "40", registrationOpenDate: "2026-11-06", registrationOpenTime: "09:00",
  registrationCloseDate: "2026-11-11", registrationCloseTime: "17:00", ...changes
});

test("TC-1358 [boundary] H1 instants are Singapore time; missing, padded or impossible values give null", () => {
  assert.deepEqual(registrationInstant(" 2026-11-01 ", " 09:00 "), new Date("2026-11-01T01:00:00Z"));
  assert.equal(registrationInstant(undefined, "09:00"), null);
  assert.equal(registrationInstant("2026-11-01", null), null);
  assert.equal(registrationInstant("2026-11-01", "25:99"), null);
});

test("TC-1359 [boundary] H1 AC2 the phase is Not set, Scheduled, Open from the open instant, Closed from the close instant", () => {
  assert.equal(registrationPhase(event({ registration_close_time: undefined }), NOW), "NOT_SET");
  assert.equal(registrationPhase(event(), new Date("2026-11-01T00:59:59Z")), "SCHEDULED");
  assert.equal(registrationPhase(event(), new Date("2026-11-01T01:00:00Z")), "OPEN");
  assert.equal(registrationPhase(event(), new Date("2026-11-10T09:00:00Z")), "CLOSED");
  assert.equal(registrationPhase(event({ registration_open_date: "2020-01-01", registration_close_date: "2099-01-01" })), "OPEN");
});

test("TC-1360 [conflict] H1 AC1 setup is refused without the flag, before approval, after the end, or once closed", () => {
  assert.equal(registrationSetupRefusal(undefined).reason, "flag_off");
  assert.match(registrationSetupRefusal(event({ status: "SUBMITTED" }), NOW).message, /once your event is approved/);
  assert.match(registrationSetupRefusal(event({ status: undefined }), NOW).message, /once your event is approved/);
  assert.match(registrationSetupRefusal(event({ status: "cancelled" }), NOW).message, /completed, cancelled or rejected/);
  assert.equal(registrationSetupRefusal(event(), new Date("2026-11-11T00:00:00Z")).reason, "closed");
  assert.equal(registrationSetupRefusal(event({ status: "safety_review" }), NOW), null);
  assert.equal(registrationSetupRefusal(event({ registration_close_date: "2099-01-01" })), null);
});

test("TC-1514 [conflict] H3 AC4 a registration attempt is refused when not enabled, not approved, not yet open, or closed", () => {
  assert.equal(registrationAttemptRefusal(null).reason, "not_enabled");
  assert.equal(registrationAttemptRefusal(event({ status: "DRAFT" }), NOW).reason, "status");
  assert.equal(registrationAttemptRefusal(event({ registration_open_date: "" }), NOW).reason, "not_open_yet");
  assert.equal(registrationAttemptRefusal(event(), new Date("2026-10-01T00:00:00Z")).reason, "not_open_yet");
  assert.equal(registrationAttemptRefusal(event(), new Date("2026-11-10T09:00:00Z")).reason, "closed");
  assert.equal(registrationAttemptRefusal(event(), NOW), null);
  assert.equal(registrationAttemptRefusal(event({ registration_open_date: "2020-01-01", registration_close_date: "2099-01-01" })), null);
});

test("TC-1361 [boundary] H1 AC3 F12 the venue ceiling adds each approved venue once and ignores unknown capacities", () => {
  const bookings = [
    { venue_id: "V1", status: "approved" }, { venue_id: "V1", status: "APPROVED" },
    { venue_id: "V2", status: "APPROVED" }, { venue_id: "V3", status: "APPROVED" }, { venue_id: "V4", status: "HELD" }, null
  ];
  assert.equal(venueCapacityCeiling(bookings, { V1: { max_capacity: 100 }, V2: { max_capacity: "20" }, V3: {}, V4: { max_capacity: 999 } }), 120);
  assert.equal(venueCapacityCeiling([{ venue_id: "V3", status: "APPROVED" }], {}), null);
  assert.equal(venueCapacityCeiling(), null);
});

test("TC-1362 [normal] H1 valid settings are stored trimmed, with their instants", () => {
  const result = validateRegistrationSettings(input({ registrationCapacity: " 40 ", registrationOpenTime: " 09:00" }), { event: event(), ceiling: 100, registeredCount: 10, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.values.registration_capacity, 40);
  assert.equal(result.values.registration_open_time, "09:00");
  assert.deepEqual(result.values.registration_closes_at, new Date("2026-11-11T09:00:00Z"));
});

test("TC-1363 [boundary] H1 AC3 AC5 capacity: whole and positive, within the venue, not below those registered (one is 'person')", () => {
  const errorFor = (capacity, options = {}) => validateRegistrationSettings(input({ registrationCapacity: capacity }), { event: event(), ceiling: 100, now: NOW, ...options }).errors.registrationCapacity;
  assert.match(errorFor(undefined), /whole number greater than zero/);
  assert.match(errorFor("0"), /whole number greater than zero/);
  assert.match(errorFor("101"), /cannot exceed the venue capacity of 100/);
  assert.equal(errorFor("100"), undefined);
  assert.match(errorFor("4", { registeredCount: 5 }), /less than the 5 people already registered/);
  assert.equal(errorFor("5", { registeredCount: 5 }), undefined);
  assert.equal(registeredFloorMessage(1), "Registration capacity cannot be less than the 1 person already registered.");
  // No approved venue: the capacity carried by the request may stay, but not change.
  assert.match(errorFor("40", { ceiling: null }), /once a venue booking has been approved/);
  assert.equal(errorFor("50", { ceiling: undefined }), undefined);
  assert.match(validateRegistrationSettings(input(), { event: {}, now: NOW }).errors.registrationCapacity, /once a venue booking/);
});

test("TC-1364 [boundary] H1 AC2 the window must exist, close after it opens, at or before the start, and in the future", () => {
  const errors = (changes, options = {}) => validateRegistrationSettings(input(changes), { event: event(), ceiling: 100, now: NOW, ...options }).errors;
  assert.match(errors({ registrationCloseTime: "" }).registrationWindow, /are required/);
  assert.match(errors({ registrationCloseDate: "2026-11-06" , registrationCloseTime: "09:00" }).registrationCloseDate, /must be after registration open/);
  assert.match(errors({ registrationCloseDate: "2026-11-12", registrationCloseTime: "09:01" }).registrationCloseDate, /at or before the event start/);
  assert.equal(errors({ registrationCloseDate: "2026-11-12", registrationCloseTime: "09:00" }).registrationCloseDate, undefined);
  assert.match(errors({ registrationOpenDate: "2026-11-01", registrationCloseDate: "2026-11-02" }).registrationCloseDate, /must be in the future/);
  // With no readable event start, only the order and the future are checked.
  assert.equal(errors({ registrationCloseDate: "2027-01-01" }, { event: { registration_capacity: 50 }, ceiling: null }).registrationCloseDate, undefined);
  assert.equal(validateRegistrationSettings().ok, false);
  assert.equal(validateRegistrationSettings(input({ registrationCloseDate: "2099-01-01" }), { event: { event_date: "2099-02-01", start_time: "09:00" }, ceiling: 100 }).ok, true);
});

test("TC-1999 [boundary] I3 AC4 acknowledgement is needed only when lowering below those registered", () => {
  assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity: 50, newCapacity: 40, registeredCount: 45 }), true);
  assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity: 50, newCapacity: 45, registeredCount: 45 }), false);
  assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity: 30, newCapacity: 40, registeredCount: 45 }), false);
  for (const oldCapacity of [null, undefined, ""]) {
    assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity, newCapacity: 1, registeredCount: 9 }), false);
  }
  assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity: "abc", newCapacity: 1, registeredCount: 9 }), false);
  assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity: 50, newCapacity: "x", registeredCount: 9 }), false);
  assert.equal(capacityReductionNeedsAcknowledgement({ oldCapacity: 50, newCapacity: 1 }), false);
  assert.equal(capacityReductionNeedsAcknowledgement(), false);
});

test("TC-2000 [normal] I3 AC5 the re-check applies to date, start, attendance and venue changes only", () => {
  assert.equal(registrationRecheckApplies({ start_time: {} }), true);
  assert.equal(registrationRecheckApplies({ required_layout: {} }), true);
  assert.equal(registrationRecheckApplies({ end_time: {} }), false);
  assert.equal(registrationRecheckApplies(null), false);
  assert.equal(registrationRecheckApplies(), false);
});

test("TC-2001 [boundary] I3 AC5 review is flagged for a close after the new start or a capacity above the venue; exactly at the start is fine", () => {
  const venues = { V1: { max_capacity: 40 } };
  const bookings = [{ venue_id: "V1", status: "APPROVED" }];
  assert.deepEqual(registrationReview({ event: event({ event_date: "2026-11-10", start_time: "09:00" }), bookings, venues }),
    { needsReview: true, reasons: ["CLOSES_AFTER_START", "CAPACITY_ABOVE_VENUE"] });
  assert.deepEqual(registrationReview({ event: event({ event_date: "2026-11-10", start_time: "17:00", registration_capacity: 40 }), bookings, venues }),
    { needsReview: false, reasons: [] });
  assert.deepEqual(registrationReview({ event: event({ registration_capacity: "lots" }), bookings, venues }).reasons, []);
  assert.deepEqual(registrationReview({ event: event({ registration_close_date: undefined, start_time: undefined }) }).reasons, []);
  assert.deepEqual(registrationReview({ event: { registration_required: false } }), { needsReview: false, reasons: [] });
  assert.deepEqual(registrationReview({ event: null }), { needsReview: false, reasons: [] });
  assert.deepEqual(registrationReview(), { needsReview: false, reasons: [] });
});
