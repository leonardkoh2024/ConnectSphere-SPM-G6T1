// C2 / C3 — the organiser's name (C2 AC2) and contact (C3 AC2) are looked up from
// the organiser's user profile. A coordinator is not always allowed to read that
// profile, and one unreadable profile must never blank the whole screen: the list
// and the event detail still load, with the organiser shown by the fallback.
import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { ordinaryEventValues } from '../../domain/ordinaryEventChanges';
import { significantEventValues } from '../../domain/significantEventChanges';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), query: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(),
  writeBatch: jest.fn()
}));

const permissionDenied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const snapshot = (id, data) => ({ id, exists: () => Boolean(data), data: () => data });
const docs = (items) => ({ docs: items.map(([id, data]) => snapshot(id, data)) });

const event = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'SUBMITTED' };

beforeEach(() => {
  auth.currentUser = { uid: 'c1' };
  // Create React App resets mocks between tests, so the stubs are built here.
  firestore.collection.mockImplementation((db, name) => ({ name }));
  firestore.doc.mockImplementation((first, name, id) => (name ? { path: `${name}/${id}`, id } : { path: `${first.name}/auto`, id: 'auto' }));
  firestore.query.mockImplementation((source, ...constraints) => ({ name: source.name, constraints }));
  firestore.where.mockImplementation((field, op, value) => ({ field, value }));
  firestore.serverTimestamp.mockReturnValue('TS');
  firestore.getDoc.mockImplementation(async (ref) => {
    if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
    if (ref.path === 'users/org1') throw permissionDenied();
    if (ref.path === 'events/e1') return snapshot('e1', event);
    return snapshot(ref.id, null);
  });
  firestore.getDocs.mockImplementation(async (q) => {
    if (q.name === 'events') return docs([['e1', event]]);
    return docs([]);
  });
});

test('C2 TC1 an unreadable organiser profile does not stop the assigned events loading', async () => {
  const { events } = await reviewApi.list();

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ id: 'e1', name: 'Partner Summit', editable: true });
  // The row falls back to the organiser id (assignedRow), never a blank or an error.
  expect(events[0].organiser_name).toBeNull();
});

test('C3 TC1 an unreadable organiser profile does not stop the event detail loading', async () => {
  const detail = await reviewApi.detail('e1');

  expect(detail.event).toMatchObject({ id: 'e1', name: 'Partner Summit' });
  expect(detail.organiser).toBeNull();
});

test('C2 TC2 a readable organiser profile still supplies the name', async () => {
  firestore.getDoc.mockImplementation(async (ref) => {
    if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
    if (ref.path === 'users/org1') return snapshot('org1', { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg' });
    return snapshot(ref.id, null);
  });

  const { events } = await reviewApi.list();

  expect(events[0].organiser_name).toBe('Nadia Organiser');
});

test('C2 TC3 other failures are still reported, and say which step failed', async () => {
  firestore.getDocs.mockImplementation(async (q) => {
    if (q.name === 'events') throw permissionDenied();
    return docs([]);
  });

  await expect(reviewApi.list()).rejects.toThrow('assigned events: Missing or insufficient permissions.');
});

// K3 / SCRUM-184 — what leadReassign actually writes. A fake transaction records the
// writes so the persisted shape can be checked: the one-coordinator event update
// (AC3), the previous assignment kept with its original time (AC3), the history entry
// naming the Lead (AC3), and one notification for each of the three people (AC5).
describe('K3 SCRUM-184 the Lead reassigns an event', () => {
  const stored = {
    'users/lead1': { role: 'EVENT_COORDINATOR_LEAD', name: 'Lena Lead' },
    'users/c1': { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true },
    'users/c2': { role: 'EVENT_COORDINATOR', name: 'Alex Coordinator', is_active: true },
    'events/e2': { organiser_id: 'org1', coordinator_id: 'c1', assigned_at: 'T0', name: 'Workshop', status: 'UNDER_REVIEW' },
    'coordinator_assignments/e2_c1': { event_id: 'e2', coordinator_id: 'c1', assigned_at: 'T0', ended_at: null }
  };
  let writes;

  beforeEach(() => {
    auth.currentUser = { uid: 'lead1' };
    writes = { updates: [], sets: [] };
    firestore.runTransaction.mockImplementation(async (db, work) => work({
      get: async (ref) => snapshot(ref.id, stored[ref.path]),
      update: (ref, data) => writes.updates.push([ref.path, data]),
      set: (ref, data) => writes.sets.push([ref.path, data])
    }));
  });

  const setsAt = (prefix) => writes.sets.filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);

  test('K3 TC1 AC3 the event ends up with exactly the one new coordinator', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    expect(writes.updates).toEqual([['events/e2', { coordinator_id: 'c2', assigned_at: 'TS', updated_at: 'TS' }]]);
  });

  test('K3 TC2 AC3 the previous assignment keeps its original time, the reassignment time and the Lead', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    const previous = writes.sets.find(([path]) => path === 'coordinator_assignments/e2_c1')[1];
    expect(previous).toMatchObject({ coordinator_id: 'c1', assigned_at: 'T0', ended_at: 'TS', reassigned_by: 'lead1' });
    const next = writes.sets.find(([path]) => path === 'coordinator_assignments/e2_c2')[1];
    expect(next).toMatchObject({ coordinator_id: 'c2', assigned_at: 'TS', ended_at: null });
  });

  test('K3 TC3 AC3 the history entry records who, from whom, to whom and both times', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    expect(setsAt('event_history')[0]).toMatchObject({
      event_id: 'e2', action_type: 'COORDINATOR_REASSIGNED', actor_id: 'lead1',
      old_value: 'c1', new_value: 'c2', previous_assigned_at: 'T0', created_at: 'TS'
    });
  });

  test('K3 TC4 AC5 the outgoing coordinator, the incoming coordinator and the organiser are each told, in their own words', async () => {
    await reviewApi.leadReassign('e2', 'c2');

    const notices = setsAt('notifications');
    expect(notices.map((item) => item.user_id)).toEqual(['c1', 'c2', 'org1']);
    expect(notices.every((item) => item.type === 'COORDINATOR_REASSIGNED' && item.event_id === 'e2')).toBe(true);
    expect(notices[0].message).toMatch(/no longer/i);
    expect(notices[1].message).toMatch(/assigned to you/i);
    expect(notices[2].message).toMatch(/Alex Coordinator/);
  });

  test('K3 TC5 AC2 reassigning to the coordinator who already holds the event is refused and writes nothing', async () => {
    await expect(reviewApi.leadReassign('e2', 'c1')).rejects.toThrow('cannot be reassigned');

    expect(writes.updates).toEqual([]);
    expect(writes.sets).toEqual([]);
  });

  test('K3 TC6 AC1 only the Lead may reassign: a coordinator calling it is refused and writes nothing', async () => {
    auth.currentUser = { uid: 'c1' };

    await expect(reviewApi.leadReassign('e2', 'c2')).rejects.toThrow('cannot be reassigned');

    expect(writes.updates).toEqual([]);
    expect(writes.sets).toEqual([]);
  });

  test('K3 TC7 AC1 a finished event is refused and writes nothing', async () => {
    stored['events/e2'] = { ...stored['events/e2'], status: 'COMPLETED' };

    await expect(reviewApi.leadReassign('e2', 'c2')).rejects.toThrow('cannot be reassigned');

    expect(writes.sets).toEqual([]);
    stored['events/e2'] = { ...stored['events/e2'], status: 'UNDER_REVIEW' };
  });

  test('K3 TC8 (replaces C9 criterion 5) the adapter offers no coordinator-side reassign, only the Lead\'s', () => {
    expect(reviewApi.reassign).toBeUndefined();
    expect(typeof reviewApi.leadReassign).toBe('function');
  });
});

// K4 / SCRUM-185 — the data the Lead's oversight screen is built from. The board must
// carry what AC1 shows (coordinator name, last-activity time), must never include a
// draft (K1: a draft is the organiser's unsubmitted work), must stay Lead-only, and
// must write nothing (AC4: the view cannot edit an event). Reads here go through a fake
// that refuses what the real rules would, as in the K3 adapter tests.
describe("K4 SCRUM-185 the Lead's oversight board", () => {
  const stored = {
    'users/lead1': { role: 'EVENT_COORDINATOR_LEAD', name: 'Lena Lead' },
    'users/c1': { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true },
    'users/c2': { role: 'EVENT_COORDINATOR', name: 'Alex Coordinator', is_active: true },
    'users/org1': { name: 'Nadia Organiser' }
  };
  const eventDocs = [
    ['e1', { organiser_id: 'org1', coordinator_id: 'c1', name: 'Workshop', status: 'UNDER_REVIEW', updated_at: { toDate: () => new Date('2026-10-10T00:00:00Z') } }],
    ['e2', { organiser_id: 'org1', coordinator_id: null, name: 'Gala', status: 'SUBMITTED', submitted_at: '2026-10-14T00:00:00.000Z' }],
    ['e3', { organiser_id: 'org1', coordinator_id: null, name: 'Unsent idea', status: 'DRAFT' }],
    ['e4', { organiser_id: 'org1', coordinator_id: 'c2', name: 'Concert', status: 'COMPLETED' }]
  ];

  // The fake database answers the way firestore.rules does for the people involved:
  //   events   : list/get allowed to the Lead only (a coordinator is refused a whole-collection read)
  //   users    : get allowed for your own profile or, for the Lead, any profile;
  //              list allowed only for a query limited to active coordinators
  // Anything else is refused with the same error Firestore gives, so a read the real
  // rules would block turns these tests red instead of surfacing in the live app.
  const roleOf = () => stored[`users/${auth.currentUser.uid}`]?.role;
  const isLead = () => roleOf() === 'EVENT_COORDINATOR_LEAD';

  beforeEach(() => {
    auth.currentUser = { uid: 'lead1' };
    firestore.getDoc.mockImplementation(async (ref) => {
      const [collection, id] = ref.path.split('/');
      if (collection === 'users' && !(id === auth.currentUser.uid || isLead())) throw permissionDenied();
      return snapshot(ref.id, stored[ref.path]);
    });
    firestore.getDocs.mockImplementation(async (q) => {
      if (q.name === 'events') {
        if (!isLead()) throw permissionDenied();
        return docs(eventDocs);
      }
      if (q.name === 'users') {
        const limits = Object.fromEntries((q.constraints || []).map((item) => [item.field, item.value]));
        const limitedToActiveCoordinators = limits.role === 'EVENT_COORDINATOR' && limits.is_active === true;
        if (!(isLead() || roleOf() === 'EVENT_COORDINATOR') || !limitedToActiveCoordinators) throw permissionDenied();
        return docs([['c1', stored['users/c1']], ['c2', stored['users/c2']]]);
      }
      return docs([]);
    });
  });

  test('K4 TC1 AC1 every submitted event is on the board with its coordinator name and last-activity time', async () => {
    const { events } = await reviewApi.leadBoard();

    expect(events.map((item) => item.id).sort()).toEqual(['e1', 'e2', 'e4']);
    const workshop = events.find((item) => item.id === 'e1');
    expect(workshop.coordinator_name).toBe('Joshua Chua');
    // The Firestore timestamp reaches the screen as an ISO string it can measure from.
    expect(workshop.updated_at).toBe('2026-10-10T00:00:00.000Z');
    // An unassigned event has no coordinator name, not a made-up one.
    expect(events.find((item) => item.id === 'e2').coordinator_name).toBeNull();
  });

  test('K4 TC2 AC1 a draft never reaches the board, so it cannot appear in the oversight view', async () => {
    const { events } = await reviewApi.leadBoard();

    expect(events.some((item) => item.status === 'DRAFT')).toBe(false);
  });

  test('K4 TC3 AC3 the coordinators the summary counts for are the active ones', async () => {
    const { coordinators } = await reviewApi.leadBoard();

    expect(coordinators.map((item) => item.id).sort()).toEqual(['c1', 'c2']);
    expect(coordinators.find((item) => item.id === 'c2').name).toBe('Alex Coordinator');
  });

  test('K4 TC4 AC4 loading the board writes nothing', async () => {
    await reviewApi.leadBoard();

    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  test('K4 TC5 only the Lead may load the board: a coordinator is refused', async () => {
    auth.currentUser = { uid: 'c1' };

    await expect(reviewApi.leadBoard()).rejects.toThrow('cannot oversee');
  });

  test('K4 TC6 AC1 under the real read rules the Lead can load every event, every coordinator name and the active coordinator list', async () => {
    const { events, coordinators } = await reviewApi.leadBoard();

    expect(events.length).toBeGreaterThan(0);
    expect(coordinators.length).toBeGreaterThan(0);
  });

  test('K4 TC7 AC1 the active-coordinator list is asked for the way the rules demand: limited to active coordinators', async () => {
    await reviewApi.leadBoard();

    const userQuery = firestore.query.mock.calls.map(([source, ...constraints]) => ({ name: source.name, constraints }))
      .find((item) => item.name === 'users');
    expect(userQuery.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'role', value: 'EVENT_COORDINATOR' }),
      expect.objectContaining({ field: 'is_active', value: true })
    ]));
  });

  test('K4 TC8 AC1 a profile the Lead cannot read does not blank the board: the row falls back to the id', async () => {
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'users/lead1') return snapshot('lead1', stored['users/lead1']);
      if (ref.path === 'users/c1') throw permissionDenied();
      return snapshot(ref.id, stored[ref.path]);
    });

    const { events } = await reviewApi.leadBoard();

    expect(events.map((item) => item.id).sort()).toEqual(['e1', 'e2', 'e4']);
  });
});

// K5 / SCRUM-186 — what a coordinator can see and open. The fake below refuses what
// firestore.rules refuses once K5 is in (an event is readable to a coordinator only
// while event.coordinator_id is theirs; every record hanging off an event follows it),
// so an adapter that still reaches for a reassigned or someone else's event fails here
// instead of passing against a fake that lets everything through.
describe('K5 SCRUM-186 a coordinator sees and opens only the events assigned to them', () => {
  const stored = {
    'users/c1': { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true },
    'users/c2': { role: 'EVENT_COORDINATOR', name: 'Alex Coordinator', is_active: true },
    'users/org1': { role: 'EVENT_ORGANISER', name: 'Nadia Organiser', email: 'nadia@smu.edu.sg' },
    'events/e1': { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'UNDER_REVIEW' },
    'events/e2': { organiser_id: 'org1', coordinator_id: 'c2', name: 'Rival Gala', description: 'Secret seating plan', status: 'UNDER_REVIEW' },
    // c1 held this one until the Lead handed it to c2, so an assignment record for c1 remains.
    'events/e3': { organiser_id: 'org1', coordinator_id: 'c2', name: 'Handed Over Retreat', status: 'APPROVED' },
    'events/e4': { organiser_id: 'org1', coordinator_id: null, name: 'Unassigned Fair', status: 'SUBMITTED' },
    'coordinator_assignments/e3_c1': { event_id: 'e3', coordinator_id: 'c1', assigned_at: 'T0', ended_at: 'T1' },
    'coordinator_assignments/e3_c2': { event_id: 'e3', coordinator_id: 'c2', assigned_at: 'T1', ended_at: null }
  };
  const entries = (prefix) => Object.entries(stored).filter(([path]) => path.startsWith(`${prefix}/`)).map(([path, data]) => [path.split('/')[1], data]);

  let reads;
  let looseEventRule;
  const eventReadable = (eventId) => {
    const event = stored[`events/${eventId}`];
    if (!event) return false;
    if (looseEventRule) return true;
    const me = stored[`users/${auth.currentUser.uid}`];
    if (me.role === 'EVENT_COORDINATOR') return event.coordinator_id === auth.currentUser.uid;
    if (me.role === 'EVENT_ORGANISER') return event.organiser_id === auth.currentUser.uid;
    return false;
  };
  const constraint = (q, field) => (q.constraints || []).find((item) => item.field === field);

  beforeEach(() => {
    auth.currentUser = { uid: 'c1' };
    reads = { paths: [], queries: [] };
    looseEventRule = false;
    firestore.getDoc.mockImplementation(async (ref) => {
      reads.paths.push(ref.path);
      const [collectionName, id] = ref.path.split('/');
      const me = stored[`users/${auth.currentUser.uid}`];
      if (collectionName === 'users') {
        const data = stored[ref.path];
        const allowed = id === auth.currentUser.uid
          || (me.role === 'EVENT_COORDINATOR' && data?.role === 'EVENT_ORGANISER')
          || (data?.role === 'EVENT_COORDINATOR' && data?.is_active === true);
        if (!allowed) throw permissionDenied();
        return snapshot(id, data);
      }
      if (collectionName === 'events') {
        if (!eventReadable(id)) throw permissionDenied();
        return snapshot(id, stored[ref.path]);
      }
      if (collectionName === 'event_venue_requirements') {
        if (!eventReadable(id)) throw permissionDenied();
        return snapshot(id, stored[ref.path]);
      }
      return snapshot(id, stored[ref.path]);
    });
    firestore.getDocs.mockImplementation(async (q) => {
      reads.queries.push(q.name);
      const mine = auth.currentUser.uid;
      if (q.name === 'events') {
        const byCoordinator = constraint(q, 'coordinator_id');
        const byOrganiser = constraint(q, 'organiser_id');
        if (!((byCoordinator && byCoordinator.value === mine) || (byOrganiser && byOrganiser.value === mine))) throw permissionDenied();
        return docs(entries('events').filter(([, data]) => data.coordinator_id === mine || data.organiser_id === mine));
      }
      if (q.name === 'coordinator_assignments') {
        if (constraint(q, 'coordinator_id')?.value === mine) return docs(entries('coordinator_assignments').filter(([, data]) => data.coordinator_id === mine));
        const eventId = constraint(q, 'event_id')?.value;
        if (!eventId || !eventReadable(eventId)) throw permissionDenied();
        return docs(entries('coordinator_assignments').filter(([, data]) => data.event_id === eventId));
      }
      if (q.name === 'users') return docs(entries('users').filter(([, data]) => data.role === 'EVENT_COORDINATOR' && data.is_active));
      if (q.name === 'venue_bookings') return docs([]);
      const eventId = constraint(q, 'event_id')?.value;
      if (eventId && !eventReadable(eventId)) throw permissionDenied();
      return docs([]);
    });
  });

  test('K5-TC1 AC1 the active event list holds only events currently assigned to the signed-in coordinator', async () => {
    const { events } = await reviewApi.list();

    expect(events.map((item) => item.id)).toEqual(['e1']);
    expect(events[0]).toMatchObject({ coordinator_id: 'c1', editable: true });
  });

  test('K5-TC2 AC1 a reassigned-away event stays out of the list even though an assignment record for this coordinator remains', async () => {
    const { events } = await reviewApi.list();

    expect(events.some((item) => item.id === 'e3')).toBe(false);
    // The list is the one query on coordinator_id: it does not go back through assignment history.
    expect(reads.queries.filter((name) => name === 'events')).toHaveLength(1);
    expect(reads.queries).not.toContain('coordinator_assignments');
    expect(reads.paths).not.toContain('events/e3');
  });

  test.each([
    ['assigned to another coordinator', 'e2'],
    ['one this coordinator held before it was reassigned', 'e3'],
    ['not assigned to anyone yet', 'e4'],
    ['an id that does not exist', 'no-such-event']
  ])('K5-TC3 AC3 opening an event by id that is %s is refused with the same not-authorised response', async (_label, eventId) => {
    await expect(reviewApi.detail(eventId)).rejects.toThrow('You are not authorised to view this event.');
  });

  test('K5-TC4 AC3 the refusal reveals nothing about the event: no name, no description, and no further reads', async () => {
    const error = await reviewApi.detail('e2').catch((failure) => failure);

    expect(error).toBeInstanceOf(Error);
    ['Rival Gala', 'Secret seating plan', 'e2', 'Alex'].forEach((leak) => expect(error.message).not.toContain(leak));
    expect(reads.queries).toEqual([]);
  });

  test('K5-TC5 AC3 the adapter refuses on its own, too: an event that is not theirs is never returned even if a read slipped through', async () => {
    looseEventRule = true;

    await expect(reviewApi.detail('e2')).rejects.toThrow('You are not authorised to view this event.');
    await expect(reviewApi.detail('e4')).rejects.toThrow('You are not authorised to view this event.');
    expect(reads.queries).toEqual([]);
  });

  test('K5-TC6 AC3 the coordinator an event is assigned to can still open it', async () => {
    const detail = await reviewApi.detail('e1');

    expect(detail.event).toMatchObject({ id: 'e1', name: 'Partner Summit', editable: true });
  });

  test("K5-TC7 AC3 the organiser still opens their own event: the check is on coordinators, not on everyone using the loader", async () => {
    auth.currentUser = { uid: 'org1' };
    firestore.getDoc.mockImplementation(async (ref) => {
      const [collectionName, id] = ref.path.split('/');
      if (collectionName === 'users') return snapshot(id, stored[ref.path]);
      if (collectionName === 'events') return snapshot(id, stored[ref.path]);
      return snapshot(id, stored[ref.path]);
    });

    const detail = await reviewApi.detail('e2');

    expect(detail.event).toMatchObject({ id: 'e2', name: 'Rival Gala' });
  });
});

describe('D1 SCRUM-111 / D2 SCRUM-112 saving an Edit event form', () => {
  let stored;
  let writes;
  let impactCalls;
  const organiser = { name: 'Nadia Organiser', email: 'nadia@smu.edu.sg', phone: null };
  const planning = {
    organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', purpose: 'Partners', description: 'Annual summit', status: 'PLANNING',
    expected_attendance: 100, event_date: '2026-11-04', start_time: '09:00', end_time: '17:00'
  };
  // The whole form as it opens: ordinary values (contact from the profile) plus the significant ones.
  const formFor = (event) => ({ ...ordinaryEventValues(event, organiser), ...significantEventValues(event) });
  const noImpact = { venueBookings: [], equipmentReservations: [], registrationsCount: 0 };

  beforeEach(() => {
    stored = { ...planning };
    writes = { updates: [], sets: [], deletes: [] };
    impactCalls = 0;
    firestore.getDocs.mockResolvedValue({ docs: [], size: 0 });
    let historyCount = 0;
    firestore.doc.mockImplementation((first, name, id) => {
      if (name) return { path: `${name}/${id}`, id };
      historyCount += 1;
      return { path: `${first.name}/h${historyCount}`, id: `h${historyCount}` };
    });
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
      if (ref.path === 'events/e1') { impactCalls += 1; return snapshot('e1', stored); }
      return snapshot(ref.id, null);
    });
    firestore.runTransaction.mockImplementation(async (db, work) => work({
      get: async (ref) => (ref.path === 'events/e1' ? snapshot('e1', stored) : snapshot(ref.id, null)),
      update: (ref, data) => writes.updates.push([ref.path, data]),
      set: (ref, data) => writes.sets.push([ref.path, data]),
      delete: (ref) => writes.deletes.push(ref.path)
    }));
  });

  test('TC-456 D1 AC1/AC2 only the changed event fields are written, with one history row per field', async () => {
    const result = await reviewApi.saveEventEdit({
      eventId: 'e1', before: planning, organiser,
      values: { ...formFor(planning), name: 'Partner Summit 2026', internal_notes: 'Keynote TBC' }
    });

    expect(result).toEqual({ ok: true, changed: 2 });
    // AC1 — one write, to the event document only: no booking, reservation or requirement row.
    expect(writes.updates).toEqual([['events/e1', {
      name: 'Partner Summit 2026', internal_notes: 'Keynote TBC', last_detail_change_id: 'h1', updated_at: 'TS'
    }]]);
    expect(impactCalls).toBe(0);
    // AC2 — field, old value, new value, actor and timestamp on each row.
    expect(writes.sets.map(([path]) => path)).toEqual(['event_history/h1', 'event_history/h2']);
    expect(writes.sets[0][1]).toMatchObject({ event_id: 'e1', actor_id: 'c1', action_type: 'EVENT_DETAILS_UPDATED', field_name: 'name', old_value: 'Partner Summit', new_value: 'Partner Summit 2026', created_at: 'TS' });
    expect(writes.sets[1][1]).toMatchObject({ field_name: 'internal_notes', old_value: '', new_value: 'Keynote TBC' });
  });

  test('TC-457 D1 AC3 a terminal event is refused and nothing is written', async () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'REJECTED']) {
      stored = { ...planning, status };
      await expect(reviewApi.saveEventEdit({ eventId: 'e1', before: stored, organiser, values: { ...formFor(stored), name: 'New' } }))
        .rejects.toThrow(/Approved, Planning or Confirmed/);
    }
    expect(writes.updates).toHaveLength(0);
    expect(writes.sets).toHaveLength(0);
  });

  test('TC-458 D1 AC4 repeated edits are each saved and recorded', async () => {
    for (const name of ['Summit A', 'Summit B', 'Summit C']) {
      await reviewApi.saveEventEdit({ eventId: 'e1', before: stored, organiser, values: { ...formFor(stored), name } });
      stored = { ...stored, name };
    }
    expect(writes.updates).toHaveLength(3);
    expect(writes.sets.map(([, data]) => data.new_value)).toEqual(['Summit A', 'Summit B', 'Summit C']);
  });

  test('TC-459 D1 an edit made meanwhile by someone else is not overwritten', async () => {
    const opened = { ...planning };
    stored = { ...planning, name: 'Renamed elsewhere' };
    await expect(reviewApi.saveEventEdit({ eventId: 'e1', before: opened, organiser, values: { ...formFor(opened), purpose: 'New purpose' } }))
      .rejects.toThrow(/changed while you were editing/);
    expect(writes.updates).toHaveLength(0);
  });

  test('TC-460 D2 a significant change without acknowledgement is refused and nothing is written', async () => {
    await expect(reviewApi.saveEventEdit({ eventId: 'e1', before: planning, organiser, impact: noImpact, values: { ...formFor(planning), expected_attendance: 125 } }))
      .rejects.toThrow(/Acknowledge the impact warning/);
    expect(writes.updates).toHaveLength(0);
  });

  test('TC-461 D1+D2 one save carrying both kinds of change commits once, with both kinds of history', async () => {
    await reviewApi.saveEventEdit({
      eventId: 'e1', before: planning, organiser, impact: noImpact, acknowledged: true,
      values: { ...formFor(planning), name: 'Partner Summit 2026', expected_attendance: 125 }
    });

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0][1]).toMatchObject({
      name: 'Partner Summit 2026', expected_attendance: 125,
      last_detail_change_id: 'h1', last_significant_change_id: 'h2', updated_at: 'TS'
    });
    const history = writes.sets.filter(([path]) => path.startsWith('event_history/')).map(([, data]) => data);
    expect(history).toEqual([
      expect.objectContaining({ action_type: 'EVENT_DETAILS_UPDATED', field_name: 'name' }),
      expect.objectContaining({
        action_type: 'SIGNIFICANT_EVENT_DETAILS_CHANGED', warning_acknowledged: true,
        old_value: { expected_attendance: 100 }, new_value: { expected_attendance: 125 }
      })
    ]);
  });
  test('TC-462 D2 a significant change is refused when the arrangements changed after the warning was shown', async () => {
    const shown = { venueBookings: [{ id: 'b1', label: 'Main Hall', status: 'APPROVED' }], equipmentReservations: [], registrationsCount: 0 };
    await expect(reviewApi.saveEventEdit({
      eventId: 'e1', before: planning, organiser, impact: shown, acknowledged: true,
      values: { ...formFor(planning), expected_attendance: 125 }
    })).rejects.toThrow(/existing arrangements changed/);
    expect(writes.updates).toHaveLength(0);
    expect(writes.sets).toHaveLength(0);
  });

  test('TC-463 D2 a significant change is refused while a clarification is open; an ordinary one is not', async () => {
    stored = { ...planning, open_clarification_id: 'q1' };
    await expect(reviewApi.saveEventEdit({
      eventId: 'e1', before: stored, organiser, impact: noImpact, acknowledged: true,
      values: { ...formFor(stored), expected_attendance: 125 }
    })).rejects.toThrow(/clarification is open/);
    expect(writes.updates).toHaveLength(0);

    await reviewApi.saveEventEdit({ eventId: 'e1', before: stored, organiser, values: { ...formFor(stored), name: 'Renamed' } });
    expect(writes.updates).toHaveLength(1);
  });

  test('TC-464 D2 a venue-requirement change rewrites the requirement, facility and accessibility rows with the acknowledged record', async () => {
    const withNeeds = { ...planning, facilities_required: true, facilities: ['WIFI'], accessibility_needed: false };
    const rows = {
      'event_facilities/e1_WIFI': { event_id: 'e1', facility_id: 'WIFI' },
      'event_venue_requirements/e1': { event_id: 'e1', preferred_location: 'CENTRAL', required_layout: 'THEATRE', facilities_required: true, accessibility_needed: false }
    };
    firestore.getDocs.mockImplementation(async (q) => {
      if (q.name === 'event_facilities') return { size: 1, docs: [{ ref: { path: 'event_facilities/e1_WIFI', id: 'e1_WIFI' }, data: () => rows['event_facilities/e1_WIFI'] }] };
      return { docs: [], size: 0 };
    });
    firestore.runTransaction.mockImplementation(async (db, work) => work({
      get: async (ref) => (ref.path === 'events/e1' ? snapshot('e1', stored) : { ...snapshot(ref.id, rows[ref.path] || null), ref }),
      update: (ref, data) => writes.updates.push([ref.path, data]),
      set: (ref, data) => writes.sets.push([ref.path, data]),
      delete: (ref) => writes.deletes.push(ref.path)
    }));
    const before = { ...withNeeds, preferred_location: 'CENTRAL', required_layout: 'THEATRE' };

    await reviewApi.saveEventEdit({
      eventId: 'e1', before, organiser, impact: noImpact, acknowledged: true,
      values: { ...formFor(before), required_layout: 'BANQUET', facilities: ['STAGE'] }
    });

    expect(writes.deletes).toEqual(['event_facilities/e1_WIFI']);
    const paths = writes.sets.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining(['event_venue_requirements/e1', 'event_facilities/e1_STAGE']));
    expect(writes.sets.find(([path]) => path === 'event_venue_requirements/e1')[1]).toMatchObject({ required_layout: 'BANQUET' });
    const record = writes.sets.find(([, data]) => data.action_type === 'SIGNIFICANT_EVENT_DETAILS_CHANGED')[1];
    expect(record).toMatchObject({
      warning_acknowledged: true, affected_arrangements: noImpact,
      old_value: { required_layout: 'THEATRE', facilities: ['WIFI'] }, new_value: { required_layout: 'BANQUET', facilities: ['STAGE'] }
    });
    expect(writes.updates[0][1]).toMatchObject({ last_significant_change_id: record.history_id });
  });

});

describe('the coordinator event detail carries its equipment arrangements', () => {
  const planning = { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', status: 'PLANNING' };
  const timestamp = (iso) => ({ toDate: () => new Date(iso) });

  beforeEach(() => {
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
      if (ref.path === 'events/e1') return snapshot('e1', planning);
      if (ref.path === 'equipment_requests/e1') return snapshot('e1', {
        status: 'PENDING',
        lines: [{ equipment_type: 'AUDIO_SYSTEM', quantity: 2, fulfillment_status: 'RESERVED', reservation_id: 'r1', fulfilled_at: timestamp('2026-10-05T02:00:00.000Z') }]
      });
      return snapshot(ref.id, null);
    });
    firestore.getDocs.mockImplementation(async (q) => {
      if (q.name === 'equipment_reservations') return docs([['r1', { reservation_id: 'r1', event_id: 'e1', status: 'RESERVED', start_datetime: timestamp('2026-11-04T01:00:00.000Z'), end_datetime: timestamp('2026-11-04T09:00:00.000Z') }]]);
      if (q.name === 'equipment_request_history') return docs([['q1', { event_id: 'e1', action: 'LINE_RESERVED', actor_id: 'tech1', equipment_type: 'AUDIO_SYSTEM', quantity: 2, created_at: timestamp('2026-10-05T02:00:00.000Z') }]]);
      if (q.name === 'event_history') return docs([['h1', { event_id: 'e1', action_type: 'EVENT_APPROVED', actor_id: 'c1', created_at: timestamp('2026-10-01T02:00:00.000Z') }]]);
      return docs([]);
    });
  });

  test('TC-483 G4 reserved lines read Approved with their window, and the reservation is in the activity history', async () => {
    const detail = await reviewApi.detail('e1');

    expect(detail.equipmentArrangements.lines).toEqual([expect.objectContaining({
      label: 'Audio system × 2', status: { label: 'Approved', tone: 'positive' },
      reservedFrom: '2026-11-04T01:00:00.000Z', reservedTo: '2026-11-04T09:00:00.000Z', decidedAt: '2026-10-05T02:00:00.000Z'
    })]);
    expect(detail.history.map((item) => item.action_type)).toEqual(['EVENT_APPROVED', 'EQUIPMENT_RESERVED']);
  });

  test('TC-484 G4 an equipment read that fails leaves the section empty instead of failing the detail', async () => {
    const getDoc = firestore.getDoc.getMockImplementation();
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'equipment_requests/e1') throw permissionDenied();
      return getDoc(ref);
    });
    const detail = await reviewApi.detail('e1');
    expect(detail.equipmentArrangements).toBeNull();
    expect(detail.event).toMatchObject({ id: 'e1' });
  });
  test('TC-485 the Activity tab names each actor it may read, and leaves the rest for the role fallback', async () => {
    const getDoc = firestore.getDoc.getMockImplementation();
    firestore.getDocs.mockImplementation(async (q) => {
      if (q.name === 'event_history') return docs([
        ['h1', { event_id: 'e1', action_type: 'EVENT_APPROVED', actor_id: 'c1', created_at: timestamp('2026-10-01T02:00:00.000Z') }],
        ['h2', { event_id: 'e1', action_type: 'VENUE_BOOKING_APPROVED', actor_id: 'vs1', created_at: timestamp('2026-10-02T02:00:00.000Z') }]
      ]);
      return docs([]);
    });
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'users/vs1') throw permissionDenied();
      return getDoc(ref);
    });

    const detail = await reviewApi.detail('e1');
    expect(detail.actorNames).toEqual({ c1: 'Joshua Chua' });
  });

  test('D6 resolves actor display names from supported profile name fields', async () => {
    const getDoc = firestore.getDoc.getMockImplementation();
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', full_name: 'Joshua Chua' });
      return getDoc(ref);
    });

    const detail = await reviewApi.detail('e1');

    expect(detail.actorNames).toEqual({ c1: 'Joshua Chua' });
  });
});

describe('D4 cancel an assigned event', () => {
  const storedEvent = {
    organiser_id: 'org1',
    coordinator_id: 'c1',
    name: 'Partner Summit',
    reference_no: 'EVT-100234',
    status: 'PLANNING'
  };
  let writes;

  beforeEach(() => {
    auth.currentUser = { uid: 'c1' };
    writes = { updates: [], sets: [] };
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'events/e4') return snapshot('e4', storedEvent);
      return snapshot(ref.id, null);
    });
    firestore.getDocs.mockImplementation(async (q) => {
      if (q.name === 'registrations') return docs([
        ['reg1', { event_id: 'e4', user_id: 'attendee-1', status: 'REGISTERED' }],
        ['reg2', { event_id: 'e4', user_id: 'waitlisted-1', status: 'WAITLISTED' }],
        ['reg3', { event_id: 'e4', attendee_id: 'attendee-2', status: 'REGISTERED' }]
      ]);
      return docs([]);
    });
    firestore.runTransaction.mockImplementation(async (db, work) => work({
      get: async (ref) => snapshot(ref.id, ref.path === 'events/e4' ? storedEvent : null),
      update: (ref, data) => writes.updates.push([ref.path, data]),
      set: (ref, data) => writes.sets.push([ref.path, data])
    }));
  });

  test('D4 requires a reason and atomically cancels, records history and notifies the organiser', async () => {
    await expect(reviewApi.cancel('e4', '  ')).rejects.toThrow('Cancellation reason is required.');
    expect(firestore.runTransaction).not.toHaveBeenCalled();

    const outcome = await reviewApi.cancel('e4', 'Speaker unavailable');

    expect(outcome).toMatchObject({
      eventId: 'e4',
      eventName: 'Partner Summit',
      reason: 'Speaker unavailable',
      attendees: [
        { registrationId: 'reg1', userId: 'attendee-1' },
        { registrationId: 'reg3', userId: 'attendee-2' }
      ]
    });
    expect(writes.updates).toEqual([['events/e4', {
      status: 'CANCELLED',
      cancellation_reason: 'Speaker unavailable',
      cancelled_at: 'TS',
      last_cancellation_id: 'auto',
      updated_at: 'TS'
    }]]);
    expect(writes.sets).toEqual(expect.arrayContaining([
      [expect.stringMatching(/^event_history\//), expect.objectContaining({
        event_id: 'e4', actor_id: 'c1', action_type: 'EVENT_CANCELLED',
        old_value: 'PLANNING', new_value: 'CANCELLED',
        description: 'Speaker unavailable', created_at: 'TS'
      })],
      [expect.stringMatching(/^notifications\//), expect.objectContaining({
        user_id: 'org1', event_id: 'e4', type: 'EVENT_CANCELLED',
        message: 'Partner Summit was cancelled — Speaker unavailable',
        created_at: 'TS'
      })]
    ]));
  });

  test('D4 sends cancellation notices to registered attendees only', async () => {
    const committed = {
      eventId: 'e4',
      eventName: 'Partner Summit',
      reason: 'Speaker unavailable',
      attendees: [
        { registrationId: 'reg1', userId: 'attendee-1' },
        { registrationId: 'reg3', userId: 'attendee-2' }
      ]
    };
    const batch = { writes: [], set(ref, data) { this.writes.push([ref.path, data]); }, commit: jest.fn() };
    firestore.writeBatch.mockReturnValue(batch);

    await expect(reviewApi.notifyCancelledAttendees(committed)).resolves.toEqual({ notified: 2 });
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(batch.writes.map(([, notification]) => notification.user_id)).toEqual(['attendee-1', 'attendee-2']);
    expect(batch.writes.map(([, notification]) => notification.registration_id)).toEqual(['reg1', 'reg3']);
    expect(batch.writes.every(([, notification]) => notification.type === 'EVENT_CANCELLED')).toBe(true);
  });
});

// F12 / SCRUM-177 AC5 — TC-507 in docs/test-cases.md.
describe('F12 SCRUM-177 the event detail carries every venue booking', () => {
  test("TC-507 AC5 each booking comes back with its label, venue, window, status, attendance and layout", async () => {
    const booking = (id, data) => [id, {
      event_id: 'e1', status: 'PENDING',
      start_datetime: '2026-11-20T01:00:00.000Z', end_datetime: '2026-11-20T09:00:00.000Z', ...data
    }];
    firestore.getDoc.mockImplementation(async (ref) => {
      if (ref.path === 'users/c1') return snapshot('c1', { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true });
      if (ref.path === 'events/e1') return snapshot('e1', event);
      if (ref.path === 'venues/VEN-MAIN') return snapshot('VEN-MAIN', { name: 'Main Hall' });
      if (ref.path === 'venues/VEN-SEM') return snapshot('VEN-SEM', { name: 'Seminar Room' });
      return snapshot(ref.id, null);
    });
    firestore.getDocs.mockImplementation(async (q) => {
      if (q.name === 'venue_bookings') return docs([
        booking('BK-1', { venue_id: 'VEN-MAIN', booking_label: 'Main programme', status: 'APPROVED', expected_attendance: 300, layout_snapshot: 'THEATRE' }),
        booking('BK-2', { venue_id: 'VEN-SEM', booking_label: 'Breakout 1', expected_attendance: 50, layout_snapshot: 'CLASSROOM' })
      ]);
      return docs([]);
    });

    const { venueBookings } = await reviewApi.detail('e1');

    expect(venueBookings).toEqual([
      expect.objectContaining({
        booking_id: 'BK-1', booking_label: 'Main programme', venue_name: 'Main Hall', status: 'APPROVED',
        start_datetime: '2026-11-20T01:00:00.000Z', end_datetime: '2026-11-20T09:00:00.000Z',
        expected_attendance: 300, layout: 'THEATRE'
      }),
      expect.objectContaining({
        booking_id: 'BK-2', booking_label: 'Breakout 1', venue_name: 'Seminar Room', status: 'PENDING',
        expected_attendance: 50, layout: 'CLASSROOM'
      })
    ]);
  });
});

// J2 / SCRUM-151 — what a coordinator's decision writes, and what the organiser is told.
// A fake transaction records the writes, as in K3 above. AC1: approval and rejection each
// notify the organiser in the same transaction as the status change. AC2: the notice names
// the event and the change. AC3: both carry the decision reason, and neither can be made
// without one.
describe('J2 SCRUM-151 the organiser is told how a decision went', () => {
  const stored = {
    'users/c1': { role: 'EVENT_COORDINATOR', name: 'Joshua Chua', is_active: true },
    'events/e3': { organiser_id: 'org1', coordinator_id: 'c1', name: 'Partner Summit', reference_no: 'EVT-100234', status: 'UNDER_REVIEW' }
  };
  let writes;

  beforeEach(() => {
    auth.currentUser = { uid: 'c1' };
    writes = { updates: [], sets: [] };
    firestore.runTransaction.mockImplementation(async (db, work) => work({
      get: async (ref) => snapshot(ref.id, stored[ref.path]),
      update: (ref, data) => writes.updates.push([ref.path, data]),
      set: (ref, data) => writes.sets.push([ref.path, data])
    }));
  });

  const setsAt = (prefix) => writes.sets.filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);

  test('J2-TC10 AC1 AC3 approving records the reason in the history entry instead of a fixed sentence', async () => {
    await reviewApi.approve('e3', ' Venue and equipment are confirmed. ');

    expect(writes.updates).toEqual([['events/e3', { status: 'APPROVED', updated_at: 'TS' }]]);
    expect(setsAt('event_history')).toHaveLength(1);
    expect(setsAt('event_history')[0]).toMatchObject({
      event_id: 'e3', action_type: 'EVENT_APPROVED', actor_id: 'c1', new_value: 'APPROVED',
      description: 'Venue and equipment are confirmed.'
    });
  });

  test('J2-TC11 AC1 AC2 AC3 approving tells the organiser, once, naming the event, the change and the reason', async () => {
    await reviewApi.approve('e3', 'Venue and equipment are confirmed.');

    const notices = setsAt('notifications');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      user_id: 'org1', event_id: 'e3', type: 'EVENT_APPROVED', is_read: false, created_at: 'TS',
      message: 'Partner Summit was approved — Venue and equipment are confirmed.'
    });
    expect(notices[0].notification_id).toBe('auto');
  });

  test.each([[''], ['   '], [undefined]])('J2-TC12 AC3 approving with the reason %p is refused and writes nothing', async (reason) => {
    await expect(reviewApi.approve('e3', reason)).rejects.toThrow('Approval reason is required.');

    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(writes).toEqual({ updates: [], sets: [] });
  });

  test('J2-TC13 AC1 AC2 AC3 rejecting still tells the organiser, with the event, the change and the reason', async () => {
    await reviewApi.reject('e3', 'No suitable venue can be secured.');

    expect(writes.updates).toEqual([['events/e3', { status: 'REJECTED', updated_at: 'TS' }]]);
    expect(setsAt('event_history')[0]).toMatchObject({ action_type: 'EVENT_REJECTED', description: 'No suitable venue can be secured.' });
    const notices = setsAt('notifications');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      user_id: 'org1', event_id: 'e3', type: 'EVENT_REJECTED',
      message: 'Partner Summit was rejected — No suitable venue can be secured.'
    });
  });

  test('J2-TC14 AC3 rejecting without a reason is refused and writes nothing', async () => {
    await expect(reviewApi.reject('e3', '   ')).rejects.toThrow('Rejection reason is required.');

    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  test('J2-TC15 AC1 AC2 returning a request for clarification tells the organiser what was asked', async () => {
    await reviewApi.clarify('e3', 'Please confirm attendance.');

    const notices = setsAt('notifications');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      user_id: 'org1', event_id: 'e3', type: 'CLARIFICATION_REQUESTED',
      message: 'Partner Summit: clarification requested — Please confirm attendance.'
    });
  });

  test('J2-TC16 AC1 an event with no name is still named, by its reference', async () => {
    stored['events/e4'] = { organiser_id: 'org1', coordinator_id: 'c1', reference_no: 'EVT-100999', status: 'UNDER_REVIEW' };

    await reviewApi.approve('e4', 'Fine.');

    expect(setsAt('notifications')[0].message).toBe('EVT-100999 was approved — Fine.');
    delete stored['events/e4'];
  });
});
