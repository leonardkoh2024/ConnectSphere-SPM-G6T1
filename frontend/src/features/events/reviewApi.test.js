// C2 / C3 — the organiser's name (C2 AC2) and contact (C3 AC2) are looked up from
// the organiser's user profile. A coordinator is not always allowed to read that
// profile, and one unreadable profile must never blank the whole screen: the list
// and the event detail still load, with the organiser shown by the fallback.
import { reviewApi } from './reviewApi';
import * as firestore from 'firebase/firestore';
import { auth } from '../../lib/firebase';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'c1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), query: jest.fn(), where: jest.fn(),
  getDoc: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn()
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
