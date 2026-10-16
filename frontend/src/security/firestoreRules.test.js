// Stories A4 and A5 at the server boundary — TC-015 ("every restricted request is
// refused server-side; hiding navigation alone is not relied upon") and the direct
// -access half of TC-016 ("direct access to another organiser's event is refused").
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

describe('TC-015 no request is left unguarded', () => {
  test('nothing is granted unconditionally', () => {
    expect(RULES).not.toMatch(/if\s+true/);
    expect(RULES).not.toMatch(/allow\s+[a-z,\s]+:\s*if\s+signedIn\(\)\s*;/);
  });

  test('every allow rule tests the caller identity/role or explicitly denies all clients', () => {
    const conditions = allowConditions(RULES.replace(/\s+/g, ' '));

    expect(conditions.length).toBeGreaterThan(0);
    conditions.forEach((condition) =>
      expect(condition).toMatch(/request\.auth\.uid|hasRole\(|ownsEvent\(|currentCoordinator\(|canReadEvent\(|assignedVenueStaff\(|^false$/)
    );
  });

  test('a signed-in user cannot promote themselves to another role', () => {
    const users = matchBlock('users');

    expect(users).toContain("request.resource.data.role in ['EVENT_ORGANISER', 'ATTENDEE']");
    expect(users).toContain('request.resource.data.role == resource.data.role');
  });

  test('a user profile is private except for active coordinator directory entries (and organisers, to coordinators — see C6 below)', () => {
    const users = matchBlock('users');
    expect(users).toContain('userId == request.auth.uid');
    expect(users).toContain("resource.data.role == 'EVENT_COORDINATOR'");
    expect(users).toContain('resource.data.is_active == true');
  });

  // C2 / SCRUM-103 AC2 — TC-347. The coordinator's lists name each organiser, so
  // a coordinator may read organiser profiles, and only those.
  test('TC-347 a coordinator may read organiser profiles and no other role', () => {
    const get = matchBlock('users').match(/allow get: if ([\s\S]*?);/)[1];
    expect(get).toContain("(hasRole('EVENT_COORDINATOR') && resource.data.role == 'EVENT_ORGANISER')");
    expect(get.match(/hasRole\('EVENT_COORDINATOR'\)/g)).toHaveLength(1);
    expect(get).not.toMatch(/ATTENDEE|VENUE_STAFF|TECHNICAL_SUPPORT_STAFF|SAFETY_OFFICER/);
  });
});

describe('TC-016 events are readable only by the roles related to them', () => {
  const scoped = Object.values(ROLES).filter((role) => EVENT_SCOPE_FIELD[role]);

  test.each(scoped)('%s may read an event only when its scope field matches their uid', (role) => {
    const readRule = eventsGetList();

    expect(readRule).toContain(`hasRole('${role}')`);
    expect(readRule).toContain(EVENT_SCOPE_FIELD[role]);
    expect(readRule).toContain('request.auth.uid');
  });

  test('the rule uses the same field per role as the client query', () => {
    const readRule = eventsGetList();

    scoped.forEach((role) => {
      const clause = readRule.split('||').find((part) => part.includes(`hasRole('${role}')`));
      expect(clause).toContain(EVENT_SCOPE_FIELD[role]);
    });
  });

  test('attendees are given no route to the events collection', () => {
    expect(matchBlock('events')).not.toContain(ROLES.ATTENDEE);
  });

  test('event writes are limited to the owning organiser or assigned coordinator workflow', () => {
    const events = matchBlock('events');

    expect(events).toMatch(/allow create:\s*if hasRole\('EVENT_ORGANISER'\) && request\.resource\.data\.organiser_id == request\.auth\.uid/);
    expect(events).toContain("hasRole('EVENT_ORGANISER') && resource.data.organiser_id == request.auth.uid");
    expect(events).toContain('coordinatorWorkflowUpdate()');
  });
});

// TC-080 — coordinator_id and assigned_at are the backend's alone to write; a
// client (even the owning organiser) may never set or change either. As with
// TC-015/016, this asserts the rule text — the text is what a loosened rule
// would change — with full behavioural proof left to a Rules Playground
// screenshot in the evidence pack, since this repo runs no emulator.
describe('TC-080 coordinator assignment fields remain protected', () => {
  test('create requires coordinator_id and assigned_at to be absent or null', () => {
    const events = matchBlock('events');
    const createRule = events.match(/allow create:\s*if([^;]*);/)[1];

    expect(createRule).toContain('noClientCoordinatorWrite()');

    expect(events).toContain("request.resource.data.get('coordinator_id', null) == null");
    expect(events).toContain("request.resource.data.get('assigned_at', null) == null");
  });

  test('organiser updates require coordinator_id and assigned_at to stay unchanged', () => {
    const events = matchBlock('events');
    const updateRule = events.match(/allow update:\s*if([^;]*);/)[1];

    expect(updateRule).toContain('coordinatorUnchanged()');

    expect(events).toContain("request.resource.data.get('coordinator_id', null) == resource.data.get('coordinator_id', null)");
    expect(events).toContain("request.resource.data.get('assigned_at', null) == resource.data.get('assigned_at', null)");
  });

  test('C9 reassignment is limited to the current coordinator and an active coordinator target', () => {
    const events = matchBlock('events');

    expect(events).toContain('resource.data.coordinator_id == request.auth.uid');
    expect(events).toContain("data.role == 'EVENT_COORDINATOR'");
    expect(events).toContain('data.is_active == true');
    expect(events).toContain("hasOnly(['coordinator_id', 'assigned_at', 'updated_at'])");
  });
});

describe('D2 significant event details require an acknowledged audit record', () => {
  test('only the assigned coordinator can change the significant event fields in planning statuses', () => {
    const events = matchBlock('events');

    expect(events).toContain('coordinatorSignificantDetailsUpdate()');
    expect(events).toContain('significantChangeHistory(eventId)');
    expect(RULES).toContain("changedEvent.status in ['APPROVED', 'PLANNING', 'CONFIRMED']");
    expect(events).toContain("'expected_attendance', 'event_date', 'start_time', 'end_time'");
    expect(events).toContain("'last_significant_change_id', 'updated_at'");
  });

  test('event requirement edits are paired with an acknowledged history record', () => {
    expect(matchBlock('event_venue_requirements')).toContain('significantChangeHistory(request.resource.data.event_id)');
    expect(matchBlock('event_facilities')).toContain('significantChangeHistory(request.resource.data.event_id)');
    expect(matchBlock('event_accessibility')).toContain('significantChangeHistory(request.resource.data.event_id)');
    expect(matchBlock('event_history')).toContain("request.resource.data.action_type == 'SIGNIFICANT_EVENT_DETAILS_CHANGED'");
    expect(matchBlock('event_history')).toContain('request.resource.data.warning_acknowledged == true');
  });

  test('registrations are readable only by the current coordinator and cannot be written in D2', () => {
    const block = matchBlock('registrations');
    expect(block).toContain("hasRole('EVENT_COORDINATOR') && currentCoordinator(resource.data.event_id)");
    expect(block).not.toMatch(/allow\s+(create|update|delete|write)/);
  });
});

describe('F1/F7 venue booking snapshots and confirmation boundary', () => {
  test('new booking requests carry layout and facility snapshots', () => {
    const bookings = matchBlock('venue_bookings');
    expect(bookings).toContain('request.resource.data.layout_snapshot is string');
    expect(bookings).toContain('request.resource.data.required_facilities_snapshot is list');
  });

  test('booking approval may only link the event to the booking approved in the same transaction', () => {
    const events = matchBlock('events');
    expect(events).toContain('venueBookingApprovalLinkUpdate()');
    expect(events).toContain("booking.status == 'APPROVED'");
    expect(events).toContain('booking.event_id == eventId');
    expect(events).toContain('assignedVenueStaff(booking.venue_id)');
  });

  test('Confirmed requires the linked booking to belong to the event and remain Approved', () => {
    const events = matchBlock('events');
    expect(events).toContain("request.resource.data.status == 'CONFIRMED'");
    expect(events).toContain('approvedBooking.event_id == eventId');
    expect(events).toContain("approvedBooking.status == 'APPROVED'");
  });
});

describe('G1 equipment requests are editable by the assigned coordinator and queued for Technical Support', () => {
  test('the assigned coordinator can prefill the organiser equipment lines', () => {
    const equipment = matchBlock('event_equipment');
    expect(equipment).toContain('currentCoordinator(resource.data.event_id)');
    expect(equipment).toContain('ownsEvent(resource.data.event_id)');
  });

  test('equipment_requests requires a non-empty pending request and is writable only by the assigned coordinator', () => {
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

  test('equipment request decision history is readable only by the assigned coordinator', () => {
    const history = matchBlock('equipment_request_history');
    expect(history).toContain("hasRole('EVENT_COORDINATOR')");
    expect(history).toContain('currentCoordinator(resource.data.event_id)');
    expect(history).not.toMatch(/allow\s+(create|update|delete|write)/);
  });
});

describe('G2 equipment availability is visible to Technical Support', () => {
  test('pooled inventory and unavailability records are readable only by Technical Support', () => {
    const inventory = matchBlock('equipment_inventory');
    expect(inventory).toContain("hasRole('TECHNICAL_SUPPORT_STAFF')");
    expect(inventory).not.toMatch(/allow\s+(create|update|delete|write)/);
    const unavailable = matchBlock('equipment_unavailability');
    expect(unavailable).toContain("hasRole('TECHNICAL_SUPPORT_STAFF')");
    expect(unavailable).not.toMatch(/allow\s+(create|update|delete|write)/);
  });

  test('reservation and inventory writes are denied to browser clients', () => {
    const reservations = matchBlock('equipment_reservations');
    expect(reservations).toContain("hasRole('TECHNICAL_SUPPORT_STAFF')");
    expect(reservations).not.toMatch(/allow\s+(create|update|delete|write)/);
    expect(matchBlock('equipment_inventory')).not.toMatch(/allow\s+(create|update|delete|write)/);
    expect(matchBlock('venue_bookings')).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'APPROVED'");
    expect(matchBlock('equipment_requests')).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'PENDING'");
  });
});

describe('C7 TC-074 rejected events are immutable to the organiser', () => {
  test('organiser updates are limited to drafts or the open clarification window', () => {
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
  test.each(['clarification_requests', 'clarification_responses', 'coordinator_assignments', 'notifications'])('%s checks role or relationship', (collection) => {
    const block = matchBlock(collection);
    expect(block).not.toMatch(/allow read, write:\s*if false/);
    expect(block).toMatch(/request\.auth\.uid|hasRole\(|canReadEvent\(|currentCoordinator\(|ownsEvent\(/);
  });
});

describe('E2 TC-094 venue catalogue reads are role-gated', () => {
  test.each(['venues', 'venue_layouts', 'venue_facilities', 'venue_accessibility', 'venue_operating_hours', 'venue_unavailability'])('%s is readable only by coordinators and venue staff', (collection) => {
    const block = matchBlock(collection);
    expect(block).toContain("hasRole('EVENT_COORDINATOR')");
    expect(block).toMatch(/hasRole\('VENUE_STAFF'\)|assignedVenueStaff\(/);
    expect(block).not.toContain('EVENT_ORGANISER');
    expect(block).not.toContain('ATTENDEE');
    expect(block).not.toContain('TECHNICAL_SUPPORT_STAFF');
  });

  test('venue bookings are readable by Technical Support only when approved for equipment window checks', () => {
    const bookings = matchBlock('venue_bookings');
    expect(bookings).toContain("hasRole('EVENT_COORDINATOR')");
    expect(bookings).toContain("hasRole('TECHNICAL_SUPPORT_STAFF') && resource.data.status == 'APPROVED'");
    expect(bookings).not.toContain('EVENT_ORGANISER');
    expect(bookings).not.toContain('ATTENDEE');
  });
});

describe('E1 venue catalogue updates are assigned-staff only', () => {
  test('updates preserve ownership and enforce valid capacity and supported layouts', () => {
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

  test('assignment records are only readable by their assigned Venue Staff user', () => {
    const assignments = matchBlock('venue_staff');
    expect(assignments).toContain("hasRole('VENUE_STAFF')");
    expect(assignments).toContain('resource.data.user_id == request.auth.uid');
  });
});

// J1 / SCRUM-150 — TC-262. A recipient reads only their own notifications and may
// change nothing but the read marker; there is no delete, so read ones stay.
describe('TC-262 notifications are private and only ever marked read', () => {
  const notifications = () => matchBlock('notifications');

  test('reads are limited to the addressee', () => {
    expect(notifications()).toContain('allow get, list: if signedIn() && resource.data.user_id == request.auth.uid;');
  });

  test('the only update is marking one read', () => {
    const update = notifications().match(/allow update:\s*if([^;]*);/);
    expect(update).not.toBeNull();
    expect(update[1]).toContain('resource.data.user_id == request.auth.uid');
    expect(update[1]).toContain('request.resource.data.is_read == true');
    expect(update[1]).toContain("affectedKeys().hasOnly(['is_read', 'read_at'])");
  });

  test('no client may delete a notification', () => {
    expect(notifications()).not.toMatch(/allow[^:]*delete/);
  });
});

// J1 / SCRUM-150 AC2 — TC-284. A notification can only be addressed to someone
// related to its event by role, and only by someone who is themselves related
// to it, so nobody's inbox can be filled from outside their events.
describe('TC-284 notifications are only ever addressed to people related to the event', () => {
  const create = () => {
    const rule = matchBlock('notifications').match(/allow create:\s*if(.*)\);\s*$/);
    expect(rule).not.toBeNull();
    return rule[1];
  };

  test('the writer must be related to the event', () => {
    expect(create()).toContain('currentCoordinator(request.resource.data.event_id)');
    expect(create()).toContain('ownsEvent(request.resource.data.event_id)');
  });

  // J6 split the rule in two: a venue booking outcome takes the decider's clause
  // and nothing else; every other notification takes the clauses below.
  const VENUE_OUTCOMES = "['VENUE_BOOKING_APPROVED', 'VENUE_BOOKING_REJECTED']";
  const ORDINARY = `!(request.resource.data.get('type', '') in ${VENUE_OUTCOMES}) && (`;
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

  test("every branch ties the recipient to the event's organiser or coordinator", () => {
    // The coordinator, organiser, safety-officer and (A6) Lead branches, in order,
    // then (J4) Venue Staff for their own venue.
    const branches = ordinary().split(/\|\| \(/);
    expect(branches).toHaveLength(5);
    branches.slice(0, 4).forEach((branch) => {
      expect(branch).toMatch(/request\.resource\.data\.user_id (==|in)/);
      expect(branch).toMatch(/organiser_id|coordinator_id/);
    });
    expect(branches[4]).toMatch(/venue_staff\/.*\.data\.user_id == request\.resource\.data\.user_id/);
  });

  // J6 / SCRUM-155 AC1 — TC-313. A booking's outcome goes only to the coordinator
  // who raised it, only from the Venue Staff member who decided it, only for the
  // event and venue booked, and only in the same commit as the decision.
  test('TC-313 a booking outcome is told only by its decider, to its raiser, with the decision', () => {
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

  // TC-344. Nobody else can send a booking outcome: the ordinary clauses are
  // closed to those types. Equipment outcomes are refused to every browser; the
  // equipment service writes them with the Admin SDK, which these rules do not bind.
  test('TC-344 outcome types cannot be sent through any other clause, nor equipment outcomes from a browser', () => {
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

  test('the Lead may read every event', () => {
    expect(eventsGetList()).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
  });

  test('event updates admit the Lead assignment path', () => {
    const updateRule = events().match(/allow update:\s*if([^;]*);/)[1];
    expect(updateRule).toContain('leadAssignmentUpdate()');
  });

  test('the Lead may only move a non-terminal event to a different active coordinator', () => {
    const lead = events().slice(
      events().indexOf('function leadAssignmentUpdate()'),
      events().indexOf('function coordinatorSignificantDetailsUpdate()')
    );
    expect(lead).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
    expect(lead).toContain("!(resource.data.status in ['COMPLETED', 'CANCELLED', 'REJECTED'])");
    expect(lead).toContain("request.resource.data.coordinator_id != resource.data.get('coordinator_id', null)");
    expect(lead).toContain("data.role == 'EVENT_COORDINATOR'");
    expect(lead).toContain('data.is_active == true');
    expect(lead).toContain("hasOnly(['coordinator_id', 'assigned_at', 'updated_at'])");
  });

  test('the active-coordinator directory is also listable by the Lead', () => {
    expect(matchBlock('users')).toContain("hasRole('EVENT_COORDINATOR_LEAD')");
  });
});

// K1 / SCRUM-182 AC2 — only the Lead reaches an unassigned event. A coordinator
// may read an event only when it carries their own id, so an event with no
// coordinator is out of reach even by direct id/URL; the Lead reads them all.
describe('K1 SCRUM-182 unassigned events are the Lead\'s alone', () => {
  test('K1-TC5 AC2 a coordinator reaches an event only via its coordinator_id, so unassigned ones are unreachable', () => {
    const readRule = eventsGetList();
    expect(readRule).toContain("hasRole('EVENT_COORDINATOR') && resource.data.get('coordinator_id', '') == request.auth.uid");
  });

  test('K1-TC6 AC2 the Lead may read every event, assigned or not', () => {
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

  test('only the current coordinator, from Under Review, with no open clarification', () => {
    expect(workflow()).toContain("hasRole('EVENT_COORDINATOR')");
    expect(workflow()).toContain('resource.data.coordinator_id == request.auth.uid');
    expect(approveClause()).toContain("resource.data.status == 'UNDER_REVIEW'");
    expect(approveClause()).toContain("resource.data.get('open_clarification_id', null) == null");
  });

  test('the approval changes nothing but status and updated_at', () => {
    expect(approveClause()).toContain("affectedKeys().hasOnly(['status', 'updated_at'])");
  });

  test('an organiser can never write Approved themselves', () => {
    const start = RULES.indexOf('function organiserMayEdit');
    const organiserRule = RULES.slice(start, RULES.indexOf('// A7 AC4', start));
    expect(organiserRule).not.toContain('APPROVED');
  });

  test('the EVENT_APPROVED history entry is writable by the current coordinator', () => {
    const history = matchBlock('event_history');
    expect(history).toContain('request.resource.data.actor_id == request.auth.uid');
    expect(history).toContain('currentCoordinator(request.resource.data.event_id)');
  });
});

describe('C2/C3 a coordinator can read an organiser profile, one at a time', () => {
  test('get is open to coordinators for organiser profiles only', () => {
    const getRule = matchBlock('users').match(/allow get:\s*if([^;]*);/)[1];
    expect(getRule).toContain("hasRole('EVENT_COORDINATOR') && resource.data.role == 'EVENT_ORGANISER'");
  });

  test('organisers still cannot be listed or browsed', () => {
    const listRule = matchBlock('users').match(/allow list:\s*if([^;]*);/)[1];
    expect(listRule).not.toContain('EVENT_ORGANISER');
  });

  test('profile writes are unchanged — nobody gains a way to edit another user', () => {
    const users = matchBlock('users');
    expect(users).toContain('allow update: if signedIn() && userId == request.auth.uid');
  });
});

// A7 / SCRUM-170 — the Safety Officer at the server boundary (AC2, AC3, AC4, AC6).
// TC-372 to TC-377, TC-380, TC-382 and TC-383 in docs/test-cases.md.
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
  test('TC-372 the Safety Officer may read an event only while it is in Safety Review', () => {
    const readRule = eventsGetList().replace(/\s+/g, ' ');
    const clauses = readRule.split('||').filter((part) => part.includes("'SAFETY_OFFICER'"));
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain("hasRole('SAFETY_OFFICER') && resource.data.status == 'SAFETY_REVIEW'");
    expect(functionBody('safetyReviewing')).toContain("hasRole('SAFETY_OFFICER')");
    expect(functionBody('safetyReviewing')).toContain(".data.status == 'SAFETY_REVIEW'");
  });

  // AC3 — the facts of a review, each readable only while that event is under review.
  test('TC-375 the review facts are readable by the Safety Officer only through safetyReviewing', () => {
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
  test('TC-373 a safety review is created once, by the reviewer, with a valid outcome, and never changed', () => {
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
  test('TC-374 the Safety Officer moves an event only to the status its review record names', () => {
    const update = functionBody('safetyOutcomeUpdate');
    [
      "hasRole('SAFETY_OFFICER')",
      "resource.data.status == 'SAFETY_REVIEW'",
      'review.event_id == eventId',
      'review.reviewer_id == request.auth.uid',
      "review.outcome == 'APPROVE' && request.resource.data.status == 'CONFIRMED'",
      'approvedVenueBookingFor(approvedBookingId)',
      "review.outcome in ['REJECT', 'REQUEST_CHANGES'] && request.resource.data.status == 'PLANNING'",
      "affectedKeys().hasOnly(['status', 'last_safety_review_id', 'updated_at'])"
    ].forEach((clause) => expect(update).toContain(clause));
    expect(matchBlock('events').match(/allow update: if (.*?);/)[1]).toContain('safetyOutcomeUpdate()');
  });

  // AC6 — every other write is refused to the Safety Officer server-side: only
  // these four collections name them in a write condition at all.
  test('TC-376 the Safety Officer can write only the outcome, its history and its notices', () => {
    const writable = collections.filter((collection) => writeConditions(collection)
      .some((condition) => /'SAFETY_OFFICER'|safetyReviewing\(|safetyOutcomeUpdate\(\)|safetyOutcomeCommit\(/.test(condition)));
    expect(writable.sort()).toEqual(['event_history', 'events', 'notifications', 'safety_reviews']);
  });

  // AC3 — equipment placement and crowd movement come from the event's coordinator,
  // and that is the only thing the new clause lets them change.
  test('TC-377 the coordinator may set only the two safety planning notes, on their own event, while planning', () => {
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
  test('TC-382 a safety review counts only in the commit that records it', () => {
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
  test('TC-383 the Safety Officer writes history and notices only alongside an outcome', () => {
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
  test('TC-380 a Safety Officer account cannot be created or claimed from the browser', () => {
    const users = matchBlock('users');
    expect(users).toContain("request.resource.data.role in ['EVENT_ORGANISER', 'ATTENDEE']");
    expect(users).toContain('request.resource.data.role == resource.data.role');
    expect(users.match(/allow create: if (.*?);/)[1]).not.toContain('SAFETY_OFFICER');
  });
});

