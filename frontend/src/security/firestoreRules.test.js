// Stories A4 and A5 at the server boundary: A4 ("every restricted request is
// refused server-side; hiding navigation alone is not relied upon") and the direct
// access half of A5 ("direct access to another organiser's event is refused").
//
// firestore.rules is the only thing that actually stops a crafted request, so it
// needs a test. Proving the *behaviour* means running the Firestore emulator,
// which needs packages and a Java runtime we have deliberately not added; what
// this file does instead is assert the policy the rules state, so that loosening a
// rule breaks the build. Behavioural evidence for these two cases comes from a
// Rules Playground screenshot in the test evidence pack.
//
// It lives under src/ because Create React App only collects tests from there.

import fs from 'fs';
import path from 'path';
import { EVENT_SCOPE_FIELD, ROLES } from '../domain/roles';

const RULES = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');

// The body of a `match /collection/{doc} { ... }` block, whitespace flattened so a
// condition split over several lines can be matched in one piece.
const matchBlock = (collection) => {
  const start = RULES.indexOf(`match /${collection}/`);
  if (start === -1) throw new Error(`No rules found for ${collection}`);
  const body = RULES.slice(start, RULES.indexOf('\n    }', start));
  return body.replace(/\s+/g, ' ');
};

const allowConditions = (text) => [...text.matchAll(/allow\s+[a-z,\s]+:\s*if([^;]*);/g)].map(([, condition]) => condition.trim());

const eventsGetList = () => {
  const conditions = allowConditions(matchBlock('events'));
  const readRule = matchBlock('events').match(/allow\s+get,\s*list:\s*if([^;]*);/);
  if (!readRule) throw new Error('events has no get/list rule');
  expect(conditions.length).toBeGreaterThan(0);
  return readRule[1];
};

describe('F10 coordinator clash resolution stays explicit and server-validated', () => {
  test('TC-1030 only the current coordinator can mark an approved booking for clash replacement', () => {
    const bookings = matchBlock('venue_bookings');
    expect(bookings).toContain("replacement_source == 'CLASH'");
    expect(bookings).toContain('currentCoordinator(resource.data.event_id)');
    expect(bookings).toContain("resource.data.status == 'APPROVED'");
    expect(bookings).toContain('replacement_requested_by == request.auth.uid');
  });

  test('TC-1031 the claimed conflicting booking must still be approved at the same venue and overlap', () => {
    const bookings = matchBlock('venue_bookings');
    expect(bookings).toContain('replacement_conflicting_booking_id != bookingId');
    expect(bookings).toContain("replacement_conflicting_booking_id)).data.status == 'APPROVED'");
    expect(bookings).toContain('replacement_conflicting_booking_id)).data.venue_id == resource.data.venue_id');
    expect(bookings).toContain('resource.data.occupied_start < get(');
    expect(bookings).toContain(').data.occupied_start < resource.data.occupied_end');
  });

  test('TC-1032 the event change is tied to a fresh history row and same-commit booking update', () => {
    const events = matchBlock('events');
    expect(events).toContain('coordinatorClashReplacementUpdate()');
    expect(events).toContain("history.action_type == 'VENUE_REPLACEMENT_REQUESTED'");
    expect(events).toContain('history.created_at == request.time');
    expect(events).toContain("booking.replacement_source == 'CLASH'");
  });
});

describe('F14 coordinator venue release follows the event lifecycle', () => {
  test('TC-1095 release is allowed during safety review and returns the event to Planning', () => {
    const events = matchBlock('events');
    expect(events).toContain("resource.data.status in ['APPROVED', 'PLANNING', 'CONFIRMED', 'SAFETY_REVIEW']");
    expect(events).toContain("resource.data.status in ['CONFIRMED', 'SAFETY_REVIEW']");
    expect(events).toContain("request.resource.data.status == 'PLANNING'");
    expect(events).toContain("request.resource.data.get('last_safety_review_id', null) == null");
  });

  test('TC-1096 completed events are not included in the release states', () => {
    const releaseFunction = matchBlock('events').split('function coordinatorSingleVenueReleaseUpdate()')[1]
      .split('function coordinatorClashReplacementUpdate()')[0];
    expect(releaseFunction).not.toContain("'COMPLETED'");
  });
});

describe('no request is left unguarded', () => {
  test('TC-0065 nothing is granted unconditionally', () => {
    expect(RULES).not.toMatch(/if\s+true/);
    expect(RULES).not.toMatch(/allow\s+[a-z,\s]+:\s*if\s+signedIn\(\)\s*;/);
  });

  test('TC-0066 every allow rule tests the caller identity/role or explicitly denies all clients', () => {
    const conditions = allowConditions(RULES.replace(/\s+/g, ' '));

    expect(conditions.length).toBeGreaterThan(0);
    conditions.forEach((condition) =>
      expect(condition).toMatch(/request\.auth\.uid|hasRole\(|ownsEvent\(|currentCoordinator\(|canReadEvent\(|assignedVenueStaff\(|^false$/)
    );
  });

  test('TC-0067 a signed-in user cannot promote themselves to another role', () => {
    const users = matchBlock('users');

    expect(users).toContain("request.resource.data.role in ['EVENT_ORGANISER', 'ATTENDEE']");
    expect(users).toContain('request.resource.data.role == resource.data.role');
  });

  test('TC-0407 a user profile is private except for active coordinator directory entries (and organisers, to coordinators — see C6 below)', () => {
    const users = matchBlock('users');
    expect(users).toContain('userId == request.auth.uid');
    expect(users).toContain("resource.data.role == 'EVENT_COORDINATOR'");
    expect(users).toContain('resource.data.is_active == true');
  });

  // C2 / SCRUM-103 AC2. The coordinator's lists name each organiser, so
  // a coordinator may read organiser profiles, and only those.
  test('TC-0337 a coordinator may read organiser profiles and no other role', () => {
    const get = matchBlock('users').match(/allow get: if ([\s\S]*?);/)[1];
    expect(get).toContain("(hasRole('EVENT_COORDINATOR') && resource.data.role == 'EVENT_ORGANISER')");
    expect(get.match(/hasRole\('EVENT_COORDINATOR'\)/g)).toHaveLength(1);
    expect(get).not.toMatch(/ATTENDEE|VENUE_STAFF|TECHNICAL_SUPPORT_STAFF|SAFETY_OFFICER/);
  });
});

describe('events are readable only by the roles related to them', () => {
  const scoped = Object.values(ROLES).filter((role) => EVENT_SCOPE_FIELD[role]);

  test.each(scoped)('TC-0072 %s may read an event only when its scope field matches their uid', (role) => {
    const readRule = eventsGetList();

    expect(readRule).toContain(`hasRole('${role}')`);
    expect(readRule).toContain(EVENT_SCOPE_FIELD[role]);
    expect(readRule).toContain('request.auth.uid');
  });

  test('TC-0073 the rule uses the same field per role as the client query', () => {
    const readRule = eventsGetList();

    scoped.forEach((role) => {
      const clause = readRule.split('||').find((part) => part.includes(`hasRole('${role}')`));
      expect(clause).toContain(EVENT_SCOPE_FIELD[role]);
    });
  });

  test('TC-0074 attendees are given no route to the events collection', () => {
    expect(matchBlock('events')).not.toContain(ROLES.ATTENDEE);
  });

  // H2 AC3 — attendees find open events through the registration service, which
  // sends only the public fields of events open now. Neither the events nor the
  // registrations rules may hand an attendee a direct read instead.
  test('TC-1492 the open-events list is not a browser read of events or registrations', () => {
    expect(matchBlock('events')).not.toContain(ROLES.ATTENDEE);
    // H2: an attendee has no browser read of registrations. (H1 gives attendees one
    // write, a window-gated create, so the role may appear — but never on a read.)
    const readClauses = matchBlock('registrations').match(/allow\s+(?:get|list|read)[^;]*;/g) || [];
    expect(readClauses.length).toBeGreaterThan(0);
    readClauses.forEach((clause) => expect(clause).not.toContain(ROLES.ATTENDEE));
    expect(matchBlock('registrations')).not.toMatch(/allow\s+[a-z,\s]*list[a-z,\s]*:\s*if\s+signedIn\(\)\s*;/);
  });

  test('TC-0075 event writes are limited to the owning organiser or assigned coordinator workflow', () => {
    const events = matchBlock('events');

    expect(events).toMatch(/allow create:\s*if hasRole\('EVENT_ORGANISER'\) && request\.resource\.data\.organiser_id == request\.auth\.uid/);
    expect(events).toContain("hasRole('EVENT_ORGANISER') && resource.data.organiser_id == request.auth.uid");
    expect(events).toContain('coordinatorWorkflowUpdate()');
  });

  test('TC-0529 D4 cancellation is restricted to the assigned coordinator and retained on the event', () => {
    const events = matchBlock('events');
    const workflow = events.slice(
      events.indexOf('function coordinatorWorkflowUpdate'),
      events.indexOf('function leadAssignmentUpdate')
    );

    expect(workflow).toContain("resource.data.coordinator_id == request.auth.uid");
    expect(workflow).toContain("request.resource.data.status == 'CANCELLED'");
    expect(workflow).toContain('request.resource.data.cancellation_reason.size() > 0');
    expect(workflow).toContain('last_cancellation_id');
    expect(workflow).toContain("action_type == 'EVENT_CANCELLED'");
    expect(workflow).toContain("'status', 'cancellation_reason', 'cancelled_at', 'last_cancellation_id', 'updated_at'");
    expect(events).toContain("allow delete: if hasRole('EVENT_ORGANISER') && resource.data.organiser_id == request.auth.uid && resource.data.status == 'DRAFT'");
  });

  test('TC-0076 cancellation notifications are tied to the event and registered attendees', () => {
    const notifications = matchBlock('notifications');

    expect(notifications).toContain('function eventCancellationRecord()');
    expect(notifications).toContain('function registeredAttendeeCancellationNotice()');
    expect(notifications).toContain("registration.status == 'REGISTERED'");
    expect(notifications).toContain("registrations/$(request.resource.data.get('registration_id', ''))");
    expect(notifications).toContain('request.resource.data.registration_id');
  });
});

// coordinator_id and assigned_at are the backend's alone to write; a
// client (even the owning organiser) may never set or change either. As with
// this asserts the rule text — the text is what a loosened rule
// would change — with full behavioural proof left to a Rules Playground
// screenshot in the evidence pack, since this repo runs no emulator.
describe('coordinator assignment fields remain protected', () => {
  test('TC-0311 create requires coordinator_id and assigned_at to be absent or null', () => {
    const events = matchBlock('events');
    const createRule = events.match(/allow create:\s*if([^;]*);/)[1];

    expect(createRule).toContain('noClientCoordinatorWrite()');

    expect(events).toContain("request.resource.data.get('coordinator_id', null) == null");
    expect(events).toContain("request.resource.data.get('assigned_at', null) == null");
  });

  test('TC-0312 organiser updates require coordinator_id and assigned_at to stay unchanged', () => {
    const events = matchBlock('events');
    const updateRule = events.match(/allow update:\s*if([^;]*);/)[1];

    expect(updateRule).toContain('coordinatorUnchanged()');

    expect(events).toContain("request.resource.data.get('coordinator_id', null) == resource.data.get('coordinator_id', null)");
    expect(events).toContain("request.resource.data.get('assigned_at', null) == resource.data.get('assigned_at', null)");
  });

  // The old C9 rule (the current coordinator reassigns to an active coordinator) is
  // superseded by K3: only the Lead reassigns. Its target and field checks are pinned in
  // 'A6 the Event Coordinator Lead assignment boundary' below, and K3 pins that the
  // coordinator path can no longer touch coordinator_id.
});

describe('D2 significant event details require an acknowledged audit record', () => {
  test('TC-0489 only the assigned coordinator can change the significant event fields in planning statuses', () => {
    const events = matchBlock('events');

    expect(events).toContain('|| coordinatorEventDetailsUpdate()');
    expect(events).toContain('significantChangeHistory(eventId)');
    expect(RULES).toContain("changedEvent.status in ['APPROVED', 'PLANNING', 'CONFIRMED']");
    expect(events).toContain("'expected_attendance', 'event_date', 'start_time', 'end_time', 'last_significant_change_id', 'updated_at'");
    // A significant field moves only together with a fresh acknowledged row.
    expect(events).toContain("(!keys.hasAny(['expected_attendance', 'event_date', 'start_time', 'end_time']) || keys.hasAny(['last_significant_change_id']))");
    expect(events).toContain("(!keys.hasAny(['last_significant_change_id']) || significantDetailsRecorded())");
  });

  test('TC-0490 D2 an acknowledgement covers only the commit it was written in', () => {
    expect(RULES).toContain('&& change.created_at == request.time;');
  });

  test('TC-0491 event requirement edits are paired with an acknowledged history record', () => {
    expect(matchBlock('event_venue_requirements')).toContain('significantChangeHistory(request.resource.data.event_id)');
    expect(matchBlock('event_facilities')).toContain('significantChangeHistory(request.resource.data.event_id)');
    expect(matchBlock('event_accessibility')).toContain('significantChangeHistory(request.resource.data.event_id)');
    expect(matchBlock('event_history')).toContain("request.resource.data.action_type == 'SIGNIFICANT_EVENT_DETAILS_CHANGED'");
    expect(matchBlock('event_history')).toContain('request.resource.data.warning_acknowledged == true');
  });

  test('TC-0492 registrations are readable only by the current coordinator, and no browser writes them', () => {
    const block = matchBlock('registrations');
    expect(block).toContain("hasRole('EVENT_COORDINATOR') && currentCoordinator(resource.data.event_id)");
    // D2 still never edits or removes registrations, and nobody gets a blanket write.
    expect(block).not.toMatch(/allow\s+(update|delete|write)/);
    // H3 (SCRUM-141) registers through the registration service, so no browser creates one.
    expect(block).not.toMatch(/allow\s+[a-z,\s]*create/);
  });
});

describe('F1/F7 venue booking snapshots and confirmation boundary', () => {
  test('TC-0902 new booking requests carry layout and facility snapshots', () => {
    const bookings = matchBlock('venue_bookings');
    expect(bookings).toContain('request.resource.data.layout_snapshot is string');
    expect(bookings).toContain('request.resource.data.required_facilities_snapshot is list');
  });

  describe('F5 venue booking rejection is terminal', () => {
    test('TC-0949 no browser update rule can transition a rejected booking to another state', () => {
      const bookings = matchBlock('venue_bookings');
      expect(bookings).not.toMatch(/(?<!request\.)resource\.data\.status == 'REJECTED'/);
      expect(bookings).not.toContain("resource.data.status in ['REJECTED'");
    });
  });

  test('TC-0903 booking approval may only link the event to the booking approved in the same transaction', () => {
    const events = matchBlock('events');
    expect(events).toContain('venueBookingApprovalLinkUpdate()');
    expect(events).toContain("booking.status == 'APPROVED'");
    expect(events).toContain('booking.event_id == eventId');
    expect(events).toContain('assignedVenueStaff(booking.venue_id)');
  });

  test('TC-0904 Confirmed requires the linked booking to belong to the event and remain Approved', () => {
    const events = matchBlock('events');
    expect(events).toContain("request.resource.data.status == 'CONFIRMED'");
    expect(events).toContain('approvedBooking.event_id == eventId');
    expect(events).toContain("approvedBooking.status == 'APPROVED'");
  });
});

describe('G1 equipment requests are editable by the assigned coordinator and queued for Technical Support', () => {
  test('TC-1190 the assigned coordinator can prefill the organiser equipment lines', () => {
    const equipment = matchBlock('event_equipment');
    expect(equipment).toContain('currentCoordinator(resource.data.event_id)');
    expect(equipment).toContain('ownsEvent(resource.data.event_id)');
  });

  test('TC-1191 equipment_requests requires a non-empty pending request and is writable only by the assigned coordinator', () => {
    const requests = matchBlock('equipment_requests');
    expect(requests).toContain("hasRole('EVENT_COORDINATOR')");
    expect(requests).toContain('currentCoordinator(eventId)');
    expect(requests).toContain("request.resource.data.status == 'PENDING'");
    expect(requests).toContain('request.resource.data.lines is list');
    expect(requests).toContain('request.resource.data.lines.size() > 0');
    expect(requests).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'PENDING'");
    expect(requests).toContain("'COMPLETED', 'CANCELLED', 'REJECTED'");
    expect(requests).not.toMatch(/allow\s+delete/);
    expect(requests).toContain("resource.data.get('has_support_decisions', false) == false");
  });

  test('TC-1192 equipment request decision history is readable only by the assigned coordinator', () => {
    const history = matchBlock('equipment_request_history');
    expect(history).toContain("hasRole('EVENT_COORDINATOR')");
    expect(history).toContain('currentCoordinator(resource.data.event_id)');
    expect(history).not.toMatch(/allow\s+(create|update|delete|write)/);
  });
});

describe('G2 equipment availability is visible to Technical Support', () => {
  test('TC-1241 pooled inventory and unavailability records are readable only by Technical Support', () => {
    const inventory = matchBlock('equipment_inventory');
    expect(inventory).toContain("hasRole('TECHNICAL_SUPPORT_STAFF')");
    expect(inventory).not.toMatch(/allow\s+(create|update|delete|write)/);
    const unavailable = matchBlock('equipment_unavailability');
    expect(unavailable).toContain("hasRole('TECHNICAL_SUPPORT_STAFF')");
    expect(unavailable).not.toMatch(/allow\s+(create|update|delete|write)/);
  });

  test('TC-1242 reservation and inventory writes are denied to browser clients', () => {
    const reservations = matchBlock('equipment_reservations');
    expect(reservations).toContain("hasRole('TECHNICAL_SUPPORT_STAFF')");
    expect(reservations).not.toMatch(/allow\s+(create|update|delete|write)/);
    expect(matchBlock('equipment_inventory')).not.toMatch(/allow\s+(create|update|delete|write)/);
    expect(matchBlock('venue_bookings')).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'APPROVED'");
    expect(matchBlock('equipment_requests')).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'PENDING'");
  });
});

describe('C7 rejected events are immutable to the organiser', () => {
  test('TC-0416 organiser updates are limited to drafts or the open clarification window', () => {
    const events = matchBlock('events');
    const updateRule = events.match(/allow update:\s*if([^;]*);/)[1];

    expect(updateRule).toContain('organiserMayEdit()');
    expect(events).toContain("resource.data.status == 'DRAFT'");
    expect(events).toContain("resource.data.status == 'UNDER_REVIEW'");
    expect(events).toContain("resource.data.get('open_clarification_id', null) != null");
    const organiserRule = events.slice(events.indexOf('function organiserMayEdit()'), events.indexOf('allow create:'));
    expect(organiserRule).not.toContain("resource.data.status == 'REJECTED'");
  });
});

describe('C4/C7/C9 workflow records are guarded for browser SDK access', () => {
  test.each(['clarification_requests', 'clarification_responses', 'coordinator_assignments', 'notifications'])('TC-0376 %s checks role or relationship', (collection) => {
    const block = matchBlock(collection);
    expect(block).not.toMatch(/allow read, write:\s*if false/);
    expect(block).toMatch(/request\.auth\.uid|hasRole\(|canReadEvent\(|currentCoordinator\(|ownsEvent\(/);
  });
});

describe('E2 venue catalogue reads are role-gated', () => {
  test.each(['venues', 'venue_layouts', 'venue_facilities', 'venue_accessibility', 'venue_operating_hours', 'venue_unavailability'])('TC-0585 %s is readable only by coordinators and venue staff', (collection) => {
    const block = matchBlock(collection);
    expect(block).toContain("hasRole('EVENT_COORDINATOR')");
    expect(block).toMatch(/hasRole\('VENUE_STAFF'\)|assignedVenueStaff\(/);
    expect(block).not.toContain('EVENT_ORGANISER');
    expect(block).not.toContain('ATTENDEE');
    expect(block).not.toContain('TECHNICAL_SUPPORT_STAFF');
  });

  test('TC-0586 venue bookings are readable by Technical Support only when approved for equipment window checks', () => {
    const bookings = matchBlock('venue_bookings');
    expect(bookings).toContain("hasRole('EVENT_COORDINATOR')");
    expect(bookings).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'APPROVED'");
    expect(bookings).not.toContain('EVENT_ORGANISER');
    expect(bookings).not.toContain('ATTENDEE');
  });
});

describe('E1 venue catalogue updates are assigned-staff only', () => {
  test('TC-0556 updates preserve ownership and enforce valid capacity and supported layouts', () => {
    const venues = matchBlock('venues');
    const updateRule = venues.match(/allow update:\s*if([^;]*);/)[1];

    expect(updateRule).toContain('assignedVenueStaff(venueId)');
    expect(RULES).toContain("function assignedVenueStaff(venueId)");
    expect(RULES).toContain("hasRole('VENUE_STAFF')");
    expect(RULES).toContain('venue_staff/$(venueId)');
    expect(RULES).toContain('.data.user_id == request.auth.uid');
    expect(updateRule).toContain('request.resource.data.max_capacity is int');
    expect(updateRule).toContain('request.resource.data.max_capacity > 0');
    expect(updateRule).toContain('request.resource.data.layouts.size() > 0');
    expect(updateRule).not.toContain("hasRole('EVENT_COORDINATOR')");
    expect(updateRule).not.toContain('venue_bookings');
  });

  test('TC-0557 assignment records are only readable by their assigned Venue Staff user', () => {
    const assignments = matchBlock('venue_staff');
    expect(assignments).toContain("hasRole('VENUE_STAFF')");
    expect(assignments).toContain('resource.data.user_id == request.auth.uid');
  });

  // J4 / SCRUM-153 — a coordinator raising a booking reads that venue's assignment
  // to notify its staff, but only as a single get: listing it is still refused.
  test('TC-0558 a coordinator may get one venue assignment but never list them', () => {
    const coordinatorRules = [...matchBlock('venue_staff').matchAll(/allow ([a-z, ]+): if ([^;]*);/g)]
      .filter(([, , condition]) => condition.includes("hasRole('EVENT_COORDINATOR')"))
      .map(([, operations]) => operations.trim());

    expect(coordinatorRules).toEqual(['get']);
  });
});

// J1 / SCRUM-150. A recipient reads only their own notifications and may
// change nothing but the read marker; there is no delete, so read ones stay.
describe('notifications are private and only ever marked read', () => {
  const notifications = () => matchBlock('notifications');

  test('TC-2117 reads are limited to the addressee', () => {
    expect(notifications()).toContain('allow get, list: if signedIn() && resource.data.user_id == request.auth.uid;');
  });

  test('TC-2118 the only update is marking one read', () => {
    const update = notifications().match(/allow update:\s*if([^;]*);/);
    expect(update).not.toBeNull();
    expect(update[1]).toContain('resource.data.user_id == request.auth.uid');
    expect(update[1]).toContain('request.resource.data.is_read == true');
    expect(update[1]).toContain("affectedKeys().hasOnly(['is_read', 'read_at'])");
  });

  test('TC-2119 no client may delete a notification', () => {
    expect(notifications()).not.toMatch(/allow[^:]*delete/);
  });
});

// J1 / SCRUM-150 AC2. A notification can only be addressed to someone
// related to its event by role, and only by someone who is themselves related
// to it, so nobody's inbox can be filled from outside their events.
describe('notifications are only ever addressed to people related to the event', () => {
  const create = () => {
    const rule = matchBlock('notifications').match(/allow create:\s*if(.*)\);\s*$/);
    expect(rule).not.toBeNull();
    return rule[1];
  };

  test('TC-2120 the writer must be related to the event', () => {
    expect(create()).toContain('currentCoordinator(request.resource.data.event_id)');
    expect(create()).toContain('ownsEvent(request.resource.data.event_id)');
  });

  // J6 split the rule in two: a venue booking outcome takes the decider's clause
  // and nothing else; every other notification takes the clauses below.
  const VENUE_OUTCOMES = "['VENUE_BOOKING_APPROVED', 'VENUE_BOOKING_REJECTED']";
  const ORDINARY = "request.resource.data.get('type', '') != 'EVENT_CANCELLED' && (";
  const DECIDED = `(request.resource.data.get('type', '') in ${VENUE_OUTCOMES}`;
  const ordinary = () => {
    const at = create().indexOf(ORDINARY);
    expect(at).toBeGreaterThan(-1);
    return create().slice(at + ORDINARY.length);
  };
  const decided = () => {
    const at = create().indexOf(DECIDED);
    expect(at).toBeGreaterThan(-1);
    return create().slice(at, create().indexOf('|| (!(', at));
  };

  test("TC-2121 every branch ties the recipient to the event's organiser or coordinator", () => {
    // The coordinator, organiser, safety-officer and (A6) Lead branches, in order,
    // then (L1) the Safety Officer waiting notice, then (J2) the organiser's own
    // submission notice, then (J4) Venue Staff for their own venue.
    const branches = ordinary().split(/\|\| \(/);
    expect(branches).toHaveLength(11);
    branches.slice(0, 4).forEach((branch) => {
      expect(branch).toMatch(/request\.resource\.data\.user_id (==|in)/);
      expect(branch).toMatch(/organiser_id|coordinator_id/);
    });
    expect(branches[4]).toContain("request.resource.data.type == 'ARRANGEMENT_REVIEW_REQUIRED'");
    expect(branches[5]).toContain("request.resource.data.type == 'SAFETY_REVIEW_CANCELLED'");
    expect(branches[6]).toContain("request.resource.data.type == 'SAFETY_REVIEW_WAITING'");
    expect(branches[6]).toContain("data.role == 'SAFETY_OFFICER'");
    expect(branches[7]).toContain("request.resource.data.type in ['DATE', 'TIME', 'VENUE']");
    expect(branches[8]).toContain("request.resource.data.type in ['UNASSIGNED_EVENT', 'UNASSIGNED_EVENT_CANCELLED']");
    expect(branches[10]).toMatch(/venue_staff\/.*\.data\.user_id == request\.resource\.data\.user_id/);
  });

  // J6 / SCRUM-155 AC1. A booking's outcome goes only to the coordinator
  // who raised it, only from the Venue Staff member who decided it, only for the
  // event and venue booked, and only in the same commit as the decision.
  test('TC-2235 a booking outcome is told only by its decider, to its raiser, with the decision', () => {
    const notice = matchBlock('notifications').match(/function venueBookingOutcomeNotice\(booking\) \{ return (.*?); \}/);
    expect(notice).not.toBeNull();
    [
      'booking.event_id == request.resource.data.event_id',
      'booking.venue_id == request.resource.data.venue_id',
      'booking.requested_by == request.resource.data.user_id',
      'booking.decided_by == request.auth.uid',
      'booking.decided_at == request.time',
      'request.resource.data.created_at == request.time',
      "(request.resource.data.type == 'VENUE_BOOKING_APPROVED' && booking.status == 'APPROVED')",
      "(request.resource.data.type == 'VENUE_BOOKING_REJECTED' && booking.status == 'REJECTED')",
      'assignedVenueStaff(booking.venue_id)'
    ].forEach((clause) => expect(notice[1]).toContain(clause));
    expect(decided()).toContain("request.resource.data.get('booking_id', null) is string");
    expect(decided()).toContain('venueBookingOutcomeNotice( getAfter(/databases/$(database)/documents/venue_bookings/$(request.resource.data.booking_id)).data)');
  });

  // Nobody else can send a booking outcome: the ordinary clauses are
  // closed to those types. Equipment outcomes are refused to every browser; the
  // equipment service writes them with the Admin SDK, which these rules do not bind.
  test('TC-2236 outcome types cannot be sent through any other clause, nor equipment outcomes from a browser', () => {
    const refuseEquipment = "!(request.resource.data.get('type', '') in ['EQUIPMENT_ARRANGED', 'EQUIPMENT_UNABLE_TO_FULFIL'])";
    expect(create().indexOf(refuseEquipment)).toBeGreaterThan(-1);
    // A conjunct of the whole rule: it comes before the clauses open.
    expect(create().indexOf(refuseEquipment)).toBeLessThan(create().indexOf(DECIDED));
    expect(create().indexOf(DECIDED)).toBeLessThan(create().indexOf(ORDINARY));
    expect(ordinary()).not.toContain('VENUE_BOOKING_');
    expect(RULES.match(/EQUIPMENT_ARRANGED|EQUIPMENT_UNABLE_TO_FULFIL/g)).toHaveLength(2);
  });
});

// A6 / Week 7 change #5 AC5 — the Event Coordinator Lead's server boundary. The
// Lead oversees every event and is the only client role that may assign or
// reassign a coordinator. As with the rules above this asserts the policy text,
// so loosening it breaks the build; behavioural proof is a Rules Playground
// screenshot in the evidence pack, since this repo runs no emulator.
describe('A6 the Event Coordinator Lead assignment boundary', () => {
  const events = () => matchBlock('events');

  test('TC-0085 the Lead may read every event', () => {
    expect(eventsGetList()).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
  });

  test('TC-0086 event updates admit the Lead assignment path', () => {
    const updateRule = events().match(/allow update:\s*if([^;]*);/)[1];
    expect(updateRule).toContain('leadAssignmentUpdate()');
  });

  test('TC-0087 the Lead may only move a non-terminal event to a different active coordinator', () => {
    const lead = events().slice(
      events().indexOf('function leadAssignmentUpdate()'),
      events().indexOf('function ordinaryText(')
    );
    expect(lead).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
    expect(lead).toContain("!(resource.data.status in ['COMPLETED', 'CANCELLED', 'REJECTED'])");
    expect(lead).toContain("request.resource.data.coordinator_id != resource.data.get('coordinator_id', null)");
    expect(lead).toContain("data.role == 'EVENT_COORDINATOR'");
    expect(lead).toContain('data.is_active == true');
    expect(lead).toContain("hasOnly(['coordinator_id', 'assigned_at', 'updated_at'])");
  });

  test('TC-0088 the active-coordinator directory is also listable by the Lead', () => {
    expect(matchBlock('users')).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
  });
});

// K1 / SCRUM-182 AC2 — only the Lead reaches an unassigned event. A coordinator
// may read an event only when it carries their own id, so an event with no
// coordinator is out of reach even by direct id/URL; the Lead reads them all.
describe('K1 SCRUM-182 unassigned events are the Lead\'s alone', () => {
  test('TC-2281 K1 AC2 a coordinator reaches an event only via its coordinator_id, so unassigned ones are unreachable', () => {
    const readRule = eventsGetList();
    expect(readRule).toContain("hasRole('EVENT_COORDINATOR') && resource.data.get('coordinator_id', '') == request.auth.uid");
  });

  test('TC-2282 K1 AC2 the Lead may read every event, assigned or not', () => {
    expect(eventsGetList()).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
  });
});

// C6 / SCRUM-107 and the C2/C3 organiser details — two gaps found when the Approve
// button was restored: (1) no rule let the assigned coordinator move an Under Review
// event to Approved, so Approve was denied by the server; (2) a coordinator could not
// read the organiser's profile, so loading their assigned events (organiser name, C2)
// or an event's detail (organiser contact, C3) failed with "Missing or insufficient
// permissions". Same static-text style as the rest of this file.
describe('C6 the assigned coordinator may approve a reviewed request', () => {
  const workflow = () => {
    const start = RULES.indexOf('function coordinatorWorkflowUpdate');
    const end = RULES.indexOf('function leadAssignmentUpdate');
    return RULES.slice(start, end).replace(/\s+/g, ' ');
  };
  const approveClause = () => {
    const clause = workflow().split('|| (').find((part) => part.includes("request.resource.data.status == 'APPROVED'"));
    if (!clause) throw new Error('coordinatorWorkflowUpdate has no Approved transition');
    return clause;
  };

  test('TC-0408 only the current coordinator, from Under Review, with no open clarification', () => {
    expect(workflow()).toContain("hasRole('EVENT_COORDINATOR')");
    expect(workflow()).toContain('resource.data.coordinator_id == request.auth.uid');
    expect(approveClause()).toContain("resource.data.status == 'UNDER_REVIEW'");
    expect(approveClause()).toContain("resource.data.get('open_clarification_id', null) == null");
  });

  test('TC-0409 the approval changes nothing but status and updated_at', () => {
    expect(approveClause()).toContain("affectedKeys().hasOnly(['status', 'updated_at'])");
  });

  test('TC-0410 an organiser can never write Approved themselves', () => {
    const start = RULES.indexOf('function organiserMayEdit');
    const organiserRule = RULES.slice(start, RULES.indexOf('// A7 AC4', start));
    expect(organiserRule).not.toContain('APPROVED');
  });

  test('TC-0411 the EVENT_APPROVED history entry is writable by the current coordinator', () => {
    const history = matchBlock('event_history');
    expect(history).toContain('request.resource.data.actor_id == request.auth.uid');
    expect(history).toContain('currentCoordinator(request.resource.data.event_id)');
  });

  test('TC-0555 D6 history entries can be created but have no update or delete rule', () => {
    const history = matchBlock('event_history');
    expect(history).toContain('allow create:');
    expect(history).not.toMatch(/allow\s+update\b/);
    expect(history).not.toMatch(/allow\s+delete\b/);
  });
});

describe('C2/C3 a coordinator can read an organiser profile, one at a time', () => {
  test('TC-0338 get is open to coordinators for organiser profiles only', () => {
    const getRule = matchBlock('users').match(/allow get:\s*if([^;]*);/)[1];
    expect(getRule).toContain("hasRole('EVENT_COORDINATOR') && resource.data.role == 'EVENT_ORGANISER'");
  });

  // J8 lets an organiser list active Coordinator Leads, so the rule may name the organiser
  // as a reader; what must never appear is an organiser profile as something listed.
  test('TC-0339 organisers still cannot be listed or browsed', () => {
    const listRule = matchBlock('users').match(/allow list:\s*if([^;]*);/)[1];
    expect(listRule).not.toMatch(/resource\.data\.role == 'EVENT_ORGANISER'/);
  });

  test('TC-0340 profile writes are unchanged — nobody gains a way to edit another user', () => {
    const users = matchBlock('users');
    expect(users).toContain('allow update: if signedIn() && userId == request.auth.uid');
  });
});

// K3 / SCRUM-184 — reassignment at the server boundary. Same static-text style as
// the rest of this file: these pin the policy the rules state, so loosening it
// breaks the build.
describe('K3 SCRUM-184 reassigning an event moves every coordinator permission with it', () => {
  test('TC-2333 K3 AC4 coordinator workflow writes are keyed on the event\'s coordinator_id, so the outgoing coordinator loses them', () => {
    const start = RULES.indexOf('function coordinatorWorkflowUpdate');
    const workflow = RULES.slice(start, RULES.indexOf('function leadAssignmentUpdate')).replace(/\s+/g, ' ');
    expect(workflow).toContain('resource.data.coordinator_id == request.auth.uid');
  });

  test('TC-2334 K3 AC4 a coordinator\'s history and notification writes need them to be the current coordinator', () => {
    expect(RULES).toMatch(/function currentCoordinator\(eventId\)[^}]*coordinator_id == request\.auth\.uid/);
    expect(matchBlock('event_history')).toContain('currentCoordinator(request.resource.data.event_id)');
    expect(matchBlock('notifications')).toContain('currentCoordinator(request.resource.data.event_id)');
  });

  test('TC-2335 K3 AC3 the Lead may write the reassignment history entry and the assignment records', () => {
    expect(matchBlock('event_history')).toContain("action_type in ['COORDINATOR_ASSIGNED', 'COORDINATOR_REASSIGNED']");
    expect(matchBlock('coordinator_assignments')).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
  });

  test('TC-2336 K3 AC5 the Lead may notify the outgoing coordinator, the incoming coordinator and the organiser', () => {
    const notifications = matchBlock('notifications');
    const lead = notifications.slice(notifications.indexOf("hasRole('EVENT_COORDINATOR_LEAD')"));
    // incoming (after the write), outgoing (before the write), organiser.
    expect(lead).toContain(".data.get('coordinator_id', '')");
    expect(lead).toContain('getAfter(');
    expect(lead).toContain(".data.get('organiser_id', '')");
  });

  test('TC-2337 K3 (replaces C9 criterion 5) a coordinator can no longer change coordinator_id: only the Lead path does', () => {
    const start = RULES.indexOf('function coordinatorWorkflowUpdate');
    const workflow = RULES.slice(start, RULES.indexOf('function leadAssignmentUpdate')).replace(/\s+/g, ' ');
    expect(workflow).not.toContain("hasOnly(['coordinator_id'");
    expect(workflow).not.toContain('request.resource.data.coordinator_id');
    expect(matchBlock('events')).toContain('leadAssignmentUpdate()');
  });
});

// A7 / SCRUM-170 — the Safety Officer at the server boundary (AC2, AC3, AC4, AC6).
describe('A7 the Safety Officer reaches only events under review, and writes only their outcome', () => {
  const functionBody = (name) => {
    const match = RULES.replace(/\s+/g, ' ').match(new RegExp(`function ${name}\\([^)]*\\) \\{ (.*?) \\}(?= //| function| allow| match)`));
    expect(match).not.toBeNull();
    return match[1];
  };
  const collections = [...new Set([...RULES.matchAll(/match \/([a-z_]+)\/\{/g)].map(([, name]) => name))];
  const writeConditions = (collection) => [...matchBlock(collection).matchAll(/allow ([a-z, ]+): if (.*?);/g)]
    .filter(([, verbs]) => /create|update|delete|write/.test(verbs))
    .map(([, , condition]) => condition);

  // AC2 — an event is the Safety Officer's to read only while it is in Safety Review.
  test('TC-0164 the Safety Officer may read an event only while it is in Safety Review', () => {
    const readRule = eventsGetList().replace(/\s+/g, ' ');
    const clauses = readRule.split('||').filter((part) => part.includes("'SAFETY_OFFICER'"));
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain("hasRole('SAFETY_OFFICER') && resource.data.status == 'SAFETY_REVIEW'");
    expect(functionBody('safetyReviewing')).toContain("hasRole('SAFETY_OFFICER')");
    expect(functionBody('safetyReviewing')).toContain(".data.status == 'SAFETY_REVIEW'");
  });

  // AC3 — the facts of a review, each readable only while that event is under review.
  test('TC-0165 the review facts are readable by the Safety Officer only through safetyReviewing', () => {
    ['event_venue_requirements', 'event_accessibility', 'event_equipment', 'equipment_reservations', 'venue_bookings', 'event_history']
      .forEach((collection) => {
        const read = matchBlock(collection).match(/allow get, list: if (.*?);/)[1];
        expect(read).toContain('safetyReviewing(resource.data.event_id)');
        expect(read).not.toContain("hasRole('SAFETY_OFFICER')");
      });
    // Venue facts (capacity, layouts, accessibility, emergency access and
    // restrictions) are catalogue data, not event data.
    ['venues', 'venue_layouts', 'venue_accessibility']
      .forEach((collection) => expect(matchBlock(collection).match(/allow get, list: if (.*?);/)[1]).toContain("hasRole('SAFETY_OFFICER')"));
    // Earlier checks too: only for an event under review, not every event's.
    const reviewsRead = matchBlock('safety_reviews').match(/allow get, list: if (.*?);/)[1];
    expect(reviewsRead).toContain('safetyReviewing(resource.data.event_id)');
    expect(reviewsRead).not.toContain("hasRole('SAFETY_OFFICER')");
  });

  // AC4 — one write-once record per check, with a comment unless it is an approval.
  test('TC-0166 a safety review is created once, by the reviewer, with a valid outcome, and never changed', () => {
    const reviews = matchBlock('safety_reviews');
    const create = reviews.match(/allow create: if (.*?);/)[1];
    [
      'safetyReviewing(request.resource.data.event_id)',
      'request.resource.data.review_id == reviewId',
      'request.resource.data.reviewer_id == request.auth.uid',
      "request.resource.data.outcome in ['APPROVE', 'REJECT', 'REQUEST_CHANGES']",
      "(request.resource.data.outcome == 'APPROVE' || (request.resource.data.comment is string && request.resource.data.comment.size() > 0))",
      'request.resource.data.decided_at == request.time'
    ].forEach((clause) => expect(create).toContain(clause));
    expect(reviews).not.toMatch(/allow [a-z, ]*(update|delete|write)/);
  });

  // AC4 — the event moves only with a matching record: Confirmed on Approve,
  // Planning otherwise, and nothing else on the event changes.
  test('TC-0167 the Safety Officer moves an event only to the status its review record names', () => {
    const update = functionBody('safetyOutcomeUpdate');
    [
      "hasRole('SAFETY_OFFICER')",
      "resource.data.status == 'SAFETY_REVIEW'",
      'review.event_id == eventId',
      'review.reviewer_id == request.auth.uid',
      "review.outcome == 'APPROVE' && request.resource.data.status == 'CONFIRMED'",
      'approvedVenueBookingFor(approvedBookingId)',
      "review.outcome in ['REJECT', 'REQUEST_CHANGES'] && request.resource.data.status == 'PLANNING'",
      "affectedKeys().hasOnly(['status', 'last_safety_review_id', 'updated_at', 'returned_to_planning_at', 'technical_review_status', 'confirmed_at'])",
      "request.resource.data.confirmed_at == request.time"
    ].forEach((clause) => expect(update).toContain(clause));
    expect(matchBlock('events').match(/allow update: if (.*?);/)[1]).toContain('safetyOutcomeUpdate()');
  });

  test('TC-2452 L1 SCRUM-187 the assigned coordinator may move Approved or Planning to Safety Review', () => {
    const update = functionBody('sendForSafetyCheckUpdate');
    [
      "hasRole('EVENT_COORDINATOR')",
      'resource.data.coordinator_id == request.auth.uid',
      "resource.data.status in ['APPROVED', 'PLANNING']",
      "request.resource.data.status == 'SAFETY_REVIEW'",
      'request.resource.data.safety_review_requested_at == request.time',
      "affectedKeys().hasOnly(['status', 'safety_review_requested_at', 'updated_at'])"
    ].forEach((clause) => expect(update).toContain(clause));
    expect(matchBlock('events').match(/allow update: if (.*?);/)[1]).toContain('sendForSafetyCheckUpdate()');
    expect(matchBlock('notifications')).toContain("request.resource.data.type == 'SAFETY_REVIEW_WAITING'");
  });

  // AC6 — every other write is refused to the Safety Officer server-side: only
  // these four collections name them in a write condition at all.
  test('TC-0168 the Safety Officer can write only the outcome, its history and its notices', () => {
    const writable = collections.filter((collection) => writeConditions(collection)
      .some((condition) => /'SAFETY_OFFICER'|safetyReviewing\(|safetyOutcomeUpdate\(\)|safetyOutcomeCommit\(/.test(condition)));
    expect(writable.sort()).toEqual(['event_history', 'events', 'notifications', 'safety_reviews', 'venue_bookings']);
  });

  // AC3 — equipment placement and crowd movement come from the event's coordinator,
  // and that is the only thing the new clause lets them change.
  test('TC-0169 the coordinator may set only the two safety planning notes, on their own event, while planning', () => {
    const notes = functionBody('coordinatorSafetyNotesUpdate');
    [
      "hasRole('EVENT_COORDINATOR')",
      "resource.data.get('coordinator_id', '') == request.auth.uid",
      "resource.data.status in ['APPROVED', 'PLANNING']",
      'request.resource.data.status == resource.data.status',
      "request.resource.data.get('equipment_placement', '') is string",
      "request.resource.data.get('crowd_movement', '') is string",
      "request.resource.data.get('equipment_placement', '').size() <= 2000",
      "request.resource.data.get('crowd_movement', '').size() <= 2000",
      'request.resource.data.updated_at == request.time',
      "affectedKeys().hasOnly(['equipment_placement', 'crowd_movement', 'updated_at'])"
    ].forEach((clause) => expect(notes).toContain(clause));
    expect(matchBlock('events').match(/allow update: if (.*?);/)[1]).toContain('coordinatorSafetyNotesUpdate()');
  });

  // AC4 — a review record decided now, and the event pointed at it in the same
  // commit: an old record can never confirm a later check, nor be backdated.
  test('TC-0170 a safety review counts only in the commit that records it', () => {
    expect(functionBody('safetyOutcomeUpdate')).toContain('review.decided_at == request.time');
    expect(matchBlock('safety_reviews').match(/allow create: if (.*?);/)[1])
      .toContain("getAfter(/databases/$(database)/documents/events/$(request.resource.data.event_id)).data.get('last_safety_review_id', '') == reviewId");
    // The approved booking is looked up only on Approve, once its id is known.
    const update = functionBody('safetyOutcomeUpdate');
    expect(update.indexOf('approvedBookingId.size() > 0')).toBeLessThan(update.indexOf('approvedVenueBookingFor(approvedBookingId)'));
    expect(update).not.toContain('venue_bookings');
  });

  // AC4 / AC6 — the Safety Officer's history entries and notices go only with an
  // outcome, of an outcome type, to the event's coordinator and organiser.
  test('TC-0171 the Safety Officer writes history and notices only alongside an outcome', () => {
    const commit = functionBody('safetyOutcomeCommit');
    ['safetyReviewing(eventId)', "after.status in ['CONFIRMED', 'PLANNING']", 'decided_at == request.time']
      .forEach((clause) => expect(commit).toContain(clause));
    const types = "['SAFETY_CHECK_APPROVED', 'SAFETY_CHECK_REJECTED', 'SAFETY_CHANGES_REQUESTED']";
    const history = matchBlock('event_history').match(/allow create: if (.*?);/)[1];
    expect(history).toContain(`(safetyOutcomeCommit(request.resource.data.event_id) && request.resource.data.action_type in ${types})`);
    expect(history).not.toContain('|| safetyReviewing(');
    const notices = matchBlock('notifications');
    expect(notices).toContain(`(safetyOutcomeCommit(request.resource.data.event_id) && request.resource.data.type in ${types} && request.resource.data.user_id in [`);
    expect(notices).not.toContain('safetyReviewing(');
  });

  // AC1 — no browser can make itself a Safety Officer: self-registration creates
  // only organisers and attendees, and a user can never change their own role.
  test('TC-0172 a Safety Officer account cannot be created or claimed from the browser', () => {
    const users = matchBlock('users');
    expect(users).toContain("request.resource.data.role in ['EVENT_ORGANISER', 'ATTENDEE']");
    expect(users).toContain('request.resource.data.role == resource.data.role');
    expect(users.match(/allow create: if (.*?);/)[1]).not.toContain('SAFETY_OFFICER');
  });
});


// K5 / SCRUM-186 — a coordinator acts only on events currently assigned to them
// (AC2: refused server-side; AC3: nothing about another coordinator's event is
// readable). K3 already keys the workflow writes on coordinator_id (K3); K5
// closes what was left: the previous-coordinator read route and any write that still
// names a coordinator without the event's current assignment. Like the rest of this
// file it asserts the rule text, because the text is what a loosened rule would change.
describe('K5 SCRUM-186 a coordinator acts only on events currently assigned to them', () => {
  // Comments stripped (they hold brackets that would unbalance the splitter), then
  // whitespace flattened so a rule split over several lines reads as one piece.
  const bare = RULES.replace(/\/\/[^\n]*/g, '');
  const blockOf = (collection) => {
    const start = bare.indexOf(`match /${collection}/`);
    if (start === -1) throw new Error(`No rules found for ${collection}`);
    return bare.slice(start, bare.indexOf('\n    }', start)).replace(/\s+/g, ' ');
  };
  const collections = [...new Set([...bare.matchAll(/match \/([a-z_]+)\/\{/g)].map(([, name]) => name))];
  const ruleFunctions = () => Object.fromEntries(
    [...bare.replace(/\s+/g, ' ').matchAll(/function (\w+)\([^)]*\) \{ (.*?) \}(?= function| allow| match)/g)].map(([, name, body]) => [name, body])
  );
  // Splits "a || (b && c) || d" into its three alternatives, ignoring any || inside brackets.
  const alternatives = (condition) => {
    const parts = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < condition.length; i += 1) {
      if ('([{'.includes(condition[i])) depth += 1;
      else if (')]}'.includes(condition[i])) depth -= 1;
      else if (depth === 0 && condition.startsWith('||', i)) { parts.push(condition.slice(from, i).trim()); from = i + 2; i += 1; }
    }
    parts.push(condition.slice(from).trim());
    return parts;
  };
  // "this caller is the event's current coordinator", in any of the spellings the rules use.
  const NAMES_CURRENT_COORDINATOR = /currentCoordinator\(|coordinator_id(?:', '')?\)? == request\.auth\.uid/;
  const isWrite = (operations) => /create|update|delete|write/.test(operations);

  test("TC-2421 K5 AC3 a coordinator reads an event only while it is assigned to them: there is no previous-coordinator route", () => {
    const read = eventsGetList();

    expect(read).toContain("hasRole('EVENT_COORDINATOR') && resource.data.get('coordinator_id', '') == request.auth.uid");
    expect(read).not.toContain('previousCoordinator(');
  });

  test('TC-2422 K5 AC3 the records hanging off an event follow the same rule: canReadEvent is the owner or the current coordinator only', () => {
    expect(RULES).not.toContain('previousCoordinator');
    expect(ruleFunctions().canReadEvent).toBe('return ownsEvent(eventId) || currentCoordinator(eventId);');
  });

  test('TC-2423 K5 AC2 the current coordinator can withdraw a pending booking even if another coordinator raised it', () => {
    const update = blockOf('venue_bookings').match(/allow update: if (.*?);/)[1];
    const withdraw = alternatives(update).find((clause) =>
      clause.includes("request.resource.data.status == 'WITHDRAWN'")
      && clause.includes("resource.data.status == 'PENDING'")
    );

    expect(withdraw).toBeDefined();
    expect(withdraw).toContain('currentCoordinator(resource.data.event_id)');
    expect(withdraw).not.toContain('requested_by');
  });

  test('TC-2424 K5 AC2 sweep: every write the coordinator role is granted outside the events collection names the current coordinator', () => {
    const offenders = [];
    collections.forEach((collection) => {
      [...blockOf(collection).matchAll(/allow ([a-z, ]+): if (.*?);/g)]
        .filter(([, operations]) => isWrite(operations))
        .forEach(([, operations, condition]) => alternatives(condition)
          .filter((clause) => clause.includes("hasRole('EVENT_COORDINATOR')"))
          .forEach((clause) => {
            if (!NAMES_CURRENT_COORDINATOR.test(clause)) offenders.push(`${collection} (${operations.trim()}): ${clause.slice(0, 100)}`);
          }));
    });

    expect(offenders).toEqual([]);
  });

  test('TC-2425 K5 AC2 sweep: every rule function that grants the coordinator role does so only for the current coordinator', () => {
    const offenders = Object.entries(ruleFunctions())
      .filter(([, body]) => body.includes("hasRole('EVENT_COORDINATOR')") && !NAMES_CURRENT_COORDINATOR.test(body))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
    // The functions the events update rule is built from are all in that sweep.
    const functions = ruleFunctions();
    ['coordinatorWorkflowUpdate', 'coordinatorSafetyNotesUpdate', 'coordinatorVenueReleaseLinkUpdate', 'significantChangeHistory']
      .forEach((name) => expect(functions[name]).toBeDefined());
  });

  test('TC-2426 K5 AC2 sweep: the coordinator edit, approve and reject paths still exist and are all in the events update rule', () => {
    const update = blockOf('events').match(/allow update: if (.*?);/)[1];
    ['coordinatorWorkflowUpdate()', 'coordinatorEventDetailsUpdate()', 'coordinatorSafetyNotesUpdate()', 'coordinatorVenueReleaseLinkUpdate()']
      .forEach((call) => expect(update).toContain(call));
    const workflow = ruleFunctions().coordinatorWorkflowUpdate;
    ["request.resource.data.status == 'APPROVED'", "request.resource.data.status == 'REJECTED'", "request.resource.data.status == 'UNDER_REVIEW'"]
      .forEach((clause) => expect(workflow).toContain(clause));
  });
});

describe('D1 SCRUM-111 ordinary event details are edited only with a recorded history row', () => {
  test('TC-0449 D1 AC1/AC3 only the current coordinator, only in Approved, Planning or Confirmed, only the ordinary fields', () => {
    const events = matchBlock('events');
    expect(events).toContain('|| coordinatorEventDetailsUpdate()');
    expect(events).toContain("resource.data.status in ['APPROVED', 'PLANNING', 'CONFIRMED']");
    expect(events).toContain("keys.hasOnly([ 'name', 'purpose', 'description', 'contact_name', 'contact_email', 'contact_phone', 'internal_notes', 'last_detail_change_id', 'expected_attendance', 'event_date', 'start_time', 'end_time', 'last_significant_change_id', 'updated_at' ])");
    // An ordinary field moves only together with a fresh ordinary history row.
    expect(events).toContain("|| keys.hasAny(['last_detail_change_id']))");
    expect(events).toContain("(!keys.hasAny(['last_detail_change_id']) || ordinaryDetailsRecorded())");
  });

  test('TC-0450 D1 AC2 the event must point at an EVENT_DETAILS_UPDATED row by this actor, written in the same commit', () => {
    const events = matchBlock('events');
    expect(events).toContain("change.action_type == 'EVENT_DETAILS_UPDATED'");
    expect(events).toContain('change.actor_id == request.auth.uid');
    expect(events).toContain('change.created_at == request.time');
    expect(events).toContain('change.event_id == eventId');
  });
});

// J2 / SCRUM-151 AC1 — "submission received". The event has no coordinator yet, so the
// only person it can be told to is the organiser, and the organiser is the one writing
// it. The rule is as narrow as it can be made: their own event, their own inbox, one type,
// and only while the event is Submitted.
describe('J2 SCRUM-151 the organiser may send themselves the submission notice and nothing else', () => {
  const notices = () => matchBlock('notifications').match(/allow create:\s*if(.*)\);\s*$/)[1];
  const submissionBranch = () => {
    const found = notices().split(/\|\| \(/).filter((branch) => branch.includes("'EVENT_SUBMITTED'"));
    expect(found).toHaveLength(1);
    return found[0];
  };

  test('TC-2153 J2 AC1 the branch is the event\'s owner, writing to their own inbox, while the event is Submitted', () => {
    expect(submissionBranch()).toContain('ownsEvent(request.resource.data.event_id)');
    expect(submissionBranch()).toContain('request.resource.data.user_id == request.auth.uid');
    expect(submissionBranch()).toContain("get(/databases/$(database)/documents/events/$(request.resource.data.event_id)).data.status == 'SUBMITTED'");
  });

  test('TC-2154 J2 AC1 the type is pinned, so an organiser cannot write any other kind of notice to themselves', () => {
    expect(submissionBranch()).toContain("request.resource.data.type == 'EVENT_SUBMITTED'");
    expect(submissionBranch()).not.toMatch(/'type', ''\) in|\.type in /);
  });

  test('TC-2155 J2 AC1 sweep: every notification clause an organiser can use names the event they own', () => {
    const organiserBranches = notices().split(/\|\| \(/).filter((branch) => branch.includes('ownsEvent('));
    expect(organiserBranches.length).toBeGreaterThanOrEqual(2);
    organiserBranches.forEach((branch) => expect(branch).toContain('ownsEvent(request.resource.data.event_id)'));
  });

  test('TC-2156 J2 AC1 AC3 the coordinator may still tell the event\'s organiser about a decision', () => {
    const coordinatorBranch = notices().split(/\|\| \(/).find((branch) => branch.includes('currentCoordinator(request.resource.data.event_id)'));
    expect(coordinatorBranch).toBeDefined();
    expect(coordinatorBranch).toContain('.data.organiser_id');
  });
});

// J5 / SCRUM-154 — Technical Support notices. A coordinator's browser cannot list Technical
// Support accounts, so the equipment service (Admin SDK, which these rules do not bind)
// writes them and remembers what it last told them. The rules only need to let the
// coordinator save the on-site fields, and to keep every browser away from the rest.
describe('J5 SCRUM-154 Technical Support notices come only from the equipment service', () => {
  const notices = () => matchBlock('notifications').match(/allow create:\s*if(.*)\);\s*$/)[1];

  test('TC-2200 J5 AC2 AC4 the assigned coordinator may save the on-site support fields on their own request', () => {
    const update = matchBlock('equipment_requests').match(/allow update:(.*)$/)[1];
    expect(update).toMatch(/affectedKeys\(\)\.hasOnly\(\[[^\]]*'on_site_support'[^\]]*'on_site_support_details'[^\]]*\]\)/);
    // Still only while Pending and before Technical Support have decided anything.
    expect(update).toContain("resource.data.status == 'PENDING'");
    expect(update).toContain("resource.data.get('has_support_decisions', false) == false");
  });

  test('TC-2201 J5 AC1 AC2 AC3 AC4 no browser may create a Technical Support notice of any of the four types', () => {
    const refuse = "!(request.resource.data.get('type', '') in ['EQUIPMENT_REQUEST_RAISED', 'EQUIPMENT_REQUEST_AMENDED', 'ON_SITE_SUPPORT_REQUIRED', 'ON_SITE_SUPPORT_CHANGED'])";
    expect(notices()).toContain(refuse);
    // A conjunct of the whole rule: it comes before the clauses open.
    expect(notices().indexOf(refuse)).toBeLessThan(notices().indexOf('venueBookingOutcomeNotice('));
    // And no clause grants any of them: the type appears nowhere but in the refusal.
    expect(notices().split(refuse).join('')).not.toMatch(/EQUIPMENT_REQUEST_RAISED|ON_SITE_SUPPORT/);
  });

  test('TC-2202 J5 AC3 what the service last told Technical Support is not reachable from any browser', () => {
    expect(RULES).not.toContain('equipment_request_notices');
  });
});

// I3 / SCRUM-149 — re-request after a significant change. The arrangements service (Admin
// SDK, which these rules do not bind) marks the bookings, reservations and equipment request,
// writes the Venue Staff, Technical Support and Event Organiser notices, flags the registration
// for review and remembers what it did. No browser may do any of it, so the rules gain nothing:
// they only have to refuse the two new notice types and keep the new fields and state closed.
describe('I3 SCRUM-149 re-request marks and notices come only from the arrangements service', () => {
  const notices = () => matchBlock('notifications').match(/allow create:\s*if(.*)\);\s*$/)[1];

  test('TC-2070 I3 AC2 AC5 no browser may create a re-request or registration-review notice', () => {
    const refuse = "!(request.resource.data.get('type', '') in ['ARRANGEMENT_REREQUEST_REQUIRED', 'REGISTRATION_NEEDS_REVIEW'])";
    expect(notices()).toContain(refuse);
    // A conjunct of the whole rule: it comes before the clauses open.
    expect(notices().indexOf(refuse)).toBeLessThan(notices().indexOf('venueBookingOutcomeNotice('));
    // And no clause grants either type: they appear nowhere but in the refusal.
    expect(notices().split(refuse).join('')).not.toMatch(/ARRANGEMENT_REREQUEST_REQUIRED|REGISTRATION_NEEDS_REVIEW/);
  });

  test('TC-2071 I3 AC3 what the service last applied is not reachable from any browser', () => {
    expect(RULES).not.toContain('arrangement_rerequests');
  });

  test('TC-2072 I3 AC1 AC3 AC5 no rule lets a browser set the re-request marker or the registration-review flag', () => {
    expect(RULES).not.toContain('rerequest_');
    expect(RULES).not.toContain('registration_needs_review');
    expect(RULES).not.toContain('registration_review_');
  });
});

// H1 / SCRUM-139 — an organiser opens registration for an approved event. The capacity
// and window are written by the registration service (Admin SDK, which these rules do not
// bind), because AC3 needs the venue capacity of the event's approved bookings and an
// organiser may not read bookings or venues (A4). So the rules have three jobs here:
//   - keep every browser away from the registration fields once an event is past the
//     request stage (the organiser's own edit path stays the B5/C5 one: Draft, or Under
//     Review with a clarification open);
//   - keep the booking and venue records closed to organisers, so the service is the only
//     route to the ceiling;
//   - AC4: give no browser a way to create a registration at all. H3 (SCRUM-141) registers
//     through the registration service, which refuses one outside the open window by the
// server's clock (backend register.test.js), because a rule cannot
//     count places or see a duplicate.
describe('H1 SCRUM-139 registration capacity and window are set through the service, and the window is enforced', () => {
  const flat = RULES.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');

  test('TC-1438 H1 AC2 the instants the window is judged on are written by the service alone: no event update clause names them', () => {
    const events = flat.slice(flat.indexOf('match /events/'), flat.indexOf('match /event_venue_requirements/'));
    const update = events.match(/allow update:(.*?);/)[1];
    expect(update).not.toContain('registration_opens_at');
    expect(update).not.toContain('registration_closes_at');
    // Nor does any coordinator, Lead, Safety Officer or Venue Staff helper behind that rule.
    const helpers = events.slice(0, events.indexOf('allow create'));
    const names = [...helpers.matchAll(/function (\w+)\(/g)].map(([, name]) => name).filter((name) => name !== 'organiserMayEdit');
    names.forEach((name) => {
      const body = helpers.slice(helpers.indexOf(`function ${name}(`)).split(/ function /)[0];
      expect(body).not.toMatch(/registration_(capacity|opens_at|closes_at|open_|close_)/);
    });
  });

  test('TC-1439 H1 AC1 AC2 the organiser\'s own edit path is still only a Draft or a clarification amendment, so an approved event cannot be edited from the browser', () => {
    const rule = flat.match(/function organiserMayEdit\(\) \{ (.*?) \}(?= \/\/| function| allow|$)/)[1];
    expect(rule).toContain("resource.data.status == 'DRAFT'");
    expect(rule).toContain("resource.data.status == 'UNDER_REVIEW'");
    ['APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED'].forEach((status) => expect(rule).not.toContain(`'${status}'`));
  });

  test('TC-1440 H1 AC3 organisers still cannot read venue bookings or venues: the ceiling reaches them only through the service', () => {
    const bookingsRead = matchBlock('venue_bookings').match(/allow get, list:\s*if([^;]*);/)[1];
    const venuesRead = matchBlock('venues').match(/allow get, list:\s*if([^;]*);/)[1];
    expect(bookingsRead).not.toContain('EVENT_ORGANISER');
    expect(bookingsRead).not.toContain('ownsEvent(');
    expect(venuesRead).not.toContain('EVENT_ORGANISER');
  });

  test('TC-1441 H1 AC4 no browser can create, change or remove a registration: the service is the only way in', () => {
    const block = matchBlock('registrations');
    expect(block).not.toMatch(/allow\s+[a-z,\s]*(create|update|delete|write)/);
  });

  test('TC-1442 H1 AC4 no clause on registrations names the Attendee role', () => {
    expect(matchBlock('registrations')).not.toContain(ROLES.ATTENDEE);
  });

  test('TC-1443 H1 AC4 the browser-side window rule is gone, so nothing can rely on it instead of the service', () => {
    expect(flat).not.toContain('registrationWindowOpen');
  });
});

// H8 / SCRUM-146 — the organiser's registration list is built by the registration service, so
// the rules must give no organiser (or anyone else) a browser route round it. These pass today;
// they are guards that fail if a later story opens one.
describe('H8 the registration list reaches an organiser only through the service', () => {
  test('TC-1795 H8 AC3 no role but the event\'s current coordinator has any read of registrations, and an organiser has no clause in the block at all', () => {
    expect(matchBlock('registrations')).not.toContain(ROLES.ORGANISER);
    const readClauses = matchBlock('registrations').match(/allow\s+(?:get|list|read)[^;]*;/g) || [];
    expect(readClauses.length).toBeGreaterThan(0);
    readClauses.forEach((clause) => {
      expect(clause).toContain("hasRole('EVENT_COORDINATOR')");
      expect(clause).toContain('currentCoordinator(resource.data.event_id)');
      for (const other of [ROLES.ORGANISER, ROLES.ATTENDEE, ROLES.COORDINATOR_LEAD, ROLES.VENUE_STAFF, ROLES.TECH_SUPPORT, ROLES.SAFETY_OFFICER]) {
        expect(clause).not.toContain(other);
      }
      expect(clause).not.toContain('ownsEvent(');
      expect(clause).not.toMatch(/if\s+signedIn\(\)\s*;/);
    });
  });

  test('TC-1796 H8 AC1 AC3 an organiser has no read of attendees\' profiles, so names and contact details cannot be fetched from the browser', () => {
    const readClauses = matchBlock('users').match(/allow\s+(?:get|list|read)[^;]*;/g) || [];
    expect(readClauses.length).toBeGreaterThan(0);
    readClauses.forEach((clause) => {
      expect(clause).not.toContain("hasRole('ATTENDEE')");
      expect(clause).not.toMatch(/resource\.data\.role == 'ATTENDEE'/);
      // J8 — an organiser may list active Coordinator Leads, and no other profile.
      (clause.match(/hasRole\('EVENT_ORGANISER'\)[^|]*/g) || []).forEach((organiserRead) => {
        expect(organiserRead).toContain("resource.data.role == 'EVENT_COORDINATOR_LEAD'");
      });
    });
  });
});

// I1 / SCRUM-147.
describe('I1 an organiser raises a change request on their own submitted event', () => {
  const block = () => matchBlock('change_requests');
  const create = () => block().match(/allow create: if (.*?);/)[1];

  test('TC-1854 only the event\'s organiser creates one, in their own name, while the event is Submitted to Confirmed', () => {
    expect(create()).toContain("hasRole('EVENT_ORGANISER')");
    expect(create()).toContain('request.resource.data.organiser_id == request.auth.uid');
    expect(create()).toContain('ownsEvent(request.resource.data.event_id)');
    expect(create()).toContain("changedEvent().status in ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PLANNING', 'SAFETY_REVIEW', 'CONFIRMED']");
  });

  test('TC-1855 it names at least one known field, gives a reason, starts Pending and is stamped now', () => {
    const { CHANGEABLE_FIELD_NAMES } = require('../domain/changeRequests');
    expect(create()).toContain("request.resource.data.status == 'PENDING'");
    expect(create()).toContain('request.resource.data.reason.trim().size() > 0');
    expect(create()).toContain('request.resource.data.changes.size() > 0');
    expect(create()).toContain(`request.resource.data.changes.keys().hasOnly([${CHANGEABLE_FIELD_NAMES.map((field) => `'${field}'`).join(', ')}])`);
    expect(create()).toContain('request.resource.data.created_at == request.time');
  });

  test('TC-1856 it carries the event\'s coordinator as it stands', () => {
    expect(create()).toContain("request.resource.data.coordinator_id == changedEvent().get('coordinator_id', null)");
  });

  test('TC-1857 it is read by its organiser and the event\'s current coordinator, and nobody may delete it', () => {
    expect(block().match(/allow get, list: if (.*?);/)[1])
      .toBe('signedIn() && (resource.data.organiser_id == request.auth.uid || canReadEvent(resource.data.event_id))');
    expect(block()).not.toMatch(/allow[^:]*\b(delete|write)\b/);
  });

  test('TC-2301 K2/K3 the Lead reads requests and may only re-point a Pending request at the event\'s new coordinator', () => {
    const lead = block().match(/allow update: if (hasRole\('EVENT_COORDINATOR_LEAD'\).*?);/s)[1];
    expect(block()).toContain("allow get, list: if hasRole('EVENT_COORDINATOR_LEAD');");
    expect(lead).toContain("resource.data.status == 'PENDING'");
    expect(lead).toContain('getAfter(/databases/$(database)/documents/events/$(resource.data.event_id)).data.coordinator_id');
    expect(lead).toContain("hasOnly(['coordinator_id'])");
  });
});

describe('I2 SCRUM-148 the coordinator decides a Pending request once, and only as the rules allow', () => {
  const block = () => matchBlock('change_requests');
  const update = () => block().match(/allow update: if (.*?); allow /)[1];

  test('TC-1919 only the event\'s current coordinator updates it, and only while it is Pending', () => {
    expect(update()).toContain("hasRole('EVENT_COORDINATOR')");
    expect(update()).toContain("resource.data.status == 'PENDING'");
    expect(update()).toContain('currentCoordinator(resource.data.event_id)');
    expect(update()).toContain('request.resource.data.decided_by == request.auth.uid');
    expect(update()).toContain('request.resource.data.decided_at == request.time');
  });

  test('TC-1920 a decline needs a non-empty reason and its own history row', () => {
    expect(update()).toContain("request.resource.data.status == 'DECLINED'");
    expect(update()).toContain('request.resource.data.decision_reason.trim().size() > 0');
    expect(update()).toContain("decisionRecorded('CHANGE_REQUEST_DECLINED')");
  });

  test('TC-1921 an acceptance records the old values and commits only with the event update at the same time', () => {
    expect(update()).toContain("request.resource.data.status == 'ACCEPTED'");
    expect(update()).toContain('request.resource.data.applied_changes is map');
    expect(update()).toContain("decisionRecorded('CHANGE_REQUEST_ACCEPTED')");
    expect(update()).toContain('.data.updated_at == request.time');
  });

  test('TC-1922 nothing but the decision fields may change', () => {
    expect(update()).toContain("hasOnly(['status', 'decided_by', 'decided_at', 'decision_reason', 'decision_history_id'])");
    expect(update()).toContain("hasOnly(['status', 'decided_by', 'decided_at', 'decision_reason', 'applied_changes', 'decision_history_id'])");
  });
});
