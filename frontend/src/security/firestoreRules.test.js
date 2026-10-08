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
      expect(condition).toMatch(/request\.auth\.uid|hasRole\(|ownsEvent\(|currentCoordinator\(|canReadEvent\(|^false$/)
    );
  });

  test('a signed-in user cannot promote themselves to another role', () => {
    const users = matchBlock('users');

    expect(users).toContain("request.resource.data.role in ['EVENT_ORGANISER', 'ATTENDEE']");
    expect(users).toContain('request.resource.data.role == resource.data.role');
  });

  test('a user profile is private except for active coordinator directory entries', () => {
    const users = matchBlock('users');
    expect(users).toContain('userId == request.auth.uid');
    expect(users).toContain("resource.data.role == 'EVENT_COORDINATOR'");
    expect(users).toContain('resource.data.is_active == true');
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
  test.each(['venues', 'venue_layouts', 'venue_facilities', 'venue_accessibility', 'venue_operating_hours', 'venue_unavailability', 'venue_bookings'])('%s is readable only by coordinators and venue staff', (collection) => {
    const block = matchBlock(collection);
    expect(block).toContain("hasRole('EVENT_COORDINATOR')");
    expect(block).toContain("hasRole('VENUE_STAFF')");
    expect(block).not.toContain('EVENT_ORGANISER');
    expect(block).not.toContain('ATTENDEE');
    expect(block).not.toContain('TECHNICAL_SUPPORT_STAFF');
  });
});

describe('E1 venue catalogue updates are assigned-staff only', () => {
  test('updates preserve ownership and enforce valid capacity and supported layouts', () => {
    const venues = matchBlock('venues');
    const updateRule = venues.match(/allow update:\s*if([^;]*);/)[1];

    expect(updateRule).toContain("hasRole('VENUE_STAFF')");
    expect(updateRule).toContain('venue_staff/$(venueId)');
    expect(updateRule).toContain('.data.user_id == request.auth.uid');
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

  test("every branch ties the recipient to the event's organiser or coordinator", () => {
    // The coordinator, organiser and safety-officer branches, in that order.
    const branches = create().split(/\|\| \(/);
    expect(branches).toHaveLength(3);
    branches.forEach((branch) => {
      expect(branch).toMatch(/request\.resource\.data\.user_id (==|in)/);
      expect(branch).toMatch(/organiser_id|coordinator_id/);
    });
  });
});
