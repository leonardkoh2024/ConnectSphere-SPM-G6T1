// A7 / SCRUM-170 — every Firestore read the Safety Officer's code makes, checked
// against what firestore.rules will actually let it do. TC-388 in
// docs/test-cases.md.
//
// The other tests mock Firestore, so they pass whether or not a real read would
// be allowed. Three failures on the shared project got through that way: a
// direct read of a venue requirements document that was never written, a read
// of a collection with no Safety Officer clause, and (for Venue Staff) a list
// query the rule could not prove. Firestore does not filter a query by the
// rules — it refuses the whole query unless the query's own filters guarantee
// every result is allowed. So:
//   - each collection read has a read clause open to the Safety Officer;
//   - when that clause looks at a field of the document, every query on that
//     collection filters on that field with == (and on the same value, when the
//     clause names one);
//   - a document read by id is refused outright when it does not exist and its
//     clause looks at its fields, so direct reads go only where the clause does
//     not, or to documents that are known to exist (the event under review,
//     which the queue has just listed, and the user's own profile).

import fs from 'fs';
import path from 'path';
import { listSafetyQueue, recordSafetyOutcome, safetyReviewDetail } from './safetyApi';

const mockReads = [];
const mockTransactionSet = jest.fn();
const mockTransactionUpdate = jest.fn();

const mockSnapshot = (id, data) => ({ id, exists: () => data !== undefined, data: () => data });
const EVENT = {
  name: 'Partner Summit', status: 'SAFETY_REVIEW', expected_attendance: 150, organiser_id: 'ORG-1',
  coordinator_id: 'COORD-1', approved_venue_booking_id: 'VB-1', updated_at: '2026-10-14T09:00:00.000Z'
};
const mockDocument = (pathName) => ({
  'events/e1': EVENT,
  'users/SO-1': { role: 'SAFETY_OFFICER' },
  'venues/V-1': { name: 'Harbour Hall', max_capacity: 200 }
}[pathName]);
// Every collection answers with one row, so each loader runs to its end and
// makes every read it would make for a real event.
const mockRows = (collection) => ({
  docs: [mockSnapshot(`${collection}-1`, {
    event_id: 'e1', venue_id: 'V-1', status: collection === 'equipment_reservations' ? 'RESERVED' : 'APPROVED',
    ...(collection === 'events' ? EVENT : {})
  })]
});

jest.mock('firebase/firestore', () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (...args) => {
    if (args.length === 1) return { path: `${args[0].path}/${args[0].path}-auto`, id: `${args[0].path}-auto`, generated: true };
    const [, collectionName, id] = args;
    return { path: `${collectionName}/${id}`, id };
  },
  getDoc: async (reference) => {
    mockReads.push({ kind: 'get', path: reference.path });
    return mockSnapshot(reference.id, mockDocument(reference.path));
  },
  getDocs: async (reference) => {
    mockReads.push({ kind: 'query', collection: reference.path, constraints: reference.constraints || [] });
    return mockRows(reference.path);
  },
  query: (reference, ...constraints) => ({ ...reference, constraints }),
  runTransaction: async (_database, operation) => operation({
    get: async (reference) => {
      mockReads.push({ kind: 'get', path: reference.path });
      return mockSnapshot(reference.id, mockDocument(reference.path));
    },
    set: mockTransactionSet,
    update: mockTransactionUpdate
  }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  where: (...parts) => parts
}));
jest.mock('../../lib/firebase', () => ({ auth: { currentUser: { uid: 'SO-1' } }, db: {} }));

const RULES = fs.readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8').replace(/\s+/g, ' ');

// The read rule of one collection, as the clauses joined by || at its top level.
const readClauses = (collection) => {
  const start = RULES.indexOf(`match /${collection}/{`);
  if (start === -1) return [];
  const body = RULES.slice(start);
  const rule = body.match(/allow (?:get, list|read|list, get): if (.*?);/);
  if (!rule) return [];
  const clauses = [];
  let depth = 0;
  let current = '';
  const text = rule[1];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && text.startsWith('||', index)) { clauses.push(current.trim()); current = ''; index += 1; continue; }
    current += character;
  }
  clauses.push(current.trim());
  return clauses;
};

// The clauses that can admit the Safety Officer: one naming the role, or one
// through safetyReviewing(), which does. Each with the document fields it reads.
const safetyOfficerClauses = (collection) => readClauses(collection)
  .filter((clause) => clause.includes("hasRole('SAFETY_OFFICER')") || clause.includes('safetyReviewing('))
  .map((clause) => ({
    clause,
    fields: [...clause.matchAll(/resource\.data\.([a-z_]+)(?:\s*==\s*'([A-Z_]+)')?/g)]
      .map(([, field, value]) => ({ field, value }))
  }));

const KNOWN_TO_EXIST = ['events/e1', 'users/SO-1'];

const allowed = (read) => {
  if (read.kind === 'get') {
    if (KNOWN_TO_EXIST.includes(read.path)) return true;
    const collection = read.path.split('/')[0];
    return safetyOfficerClauses(collection).some(({ fields }) => fields.length === 0);
  }
  return safetyOfficerClauses(read.collection).some(({ fields }) => fields.every(({ field, value }) =>
    read.constraints.some(([name, operator, filterValue]) => name === field && operator === '=='
      && (value === undefined || filterValue === value))));
};

beforeEach(() => {
  mockReads.length = 0;
  mockTransactionSet.mockClear();
  mockTransactionUpdate.mockClear();
});

const describeRead = (read) => (read.kind === 'get'
  ? `get ${read.path}`
  : `query ${read.collection} where ${JSON.stringify(read.constraints)}`);

test.each([
  ['the queue', () => listSafetyQueue()],
  ['a review', () => safetyReviewDetail('e1')],
  ['an approval', () => recordSafetyOutcome({ eventId: 'e1', outcome: 'APPROVE' })]
])('TC-388 every read %s makes is one firestore.rules lets the Safety Officer make', async (_name, run) => {
  await run();
  expect(mockReads.length).toBeGreaterThan(0);
  const refused = mockReads.filter((read) => !allowed(read)).map(describeRead);
  expect(refused).toEqual([]);
});

// The check itself, against the three shapes that failed on the shared project.
test('TC-388 the check refuses an unfiltered query, a direct read of a guarded document, and a collection with no clause', () => {
  expect(allowed({ kind: 'query', collection: 'venue_bookings', constraints: [] })).toBe(false);
  expect(allowed({ kind: 'query', collection: 'venue_bookings', constraints: [['event_id', '==', 'e1']] })).toBe(true);
  expect(allowed({ kind: 'get', path: 'event_venue_requirements/e1' })).toBe(false);
  expect(allowed({ kind: 'query', collection: 'event_venue_requirements', constraints: [['event_id', '==', 'e1']] })).toBe(true);
  expect(allowed({ kind: 'query', collection: 'events', constraints: [['status', '==', 'PLANNING']] })).toBe(false);
  expect(allowed({ kind: 'query', collection: 'events', constraints: [['status', '==', 'SAFETY_REVIEW']] })).toBe(true);
  expect(allowed({ kind: 'query', collection: 'venue_operating_hours', constraints: [] })).toBe(false);
  expect(allowed({ kind: 'get', path: 'venues/V-1' })).toBe(true);
});
