import {
  ALL_STATUSES,
  ACTIVE_EVENTS,
  assignedRow,
  buildAssignedView,
  filterByStatus,
  onlyForCoordinator,
  sortByProposedDate,
  statusOptions,
  timeSince
} from './assignedEvents';

// A fixed "now" so the time-since labels are deterministic.
const NOW = new Date('2026-10-08T12:00:00Z').getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();

const event = (changes = {}) => ({
  id: 'e1',
  name: 'Partner Summit',
  organiser_id: 'u1',
  organiser_name: 'Nadia Organiser',
  coordinator_id: 'c1',
  event_date: '2026-11-04',
  status: 'UNDER_REVIEW',
  updated_at: ago(2 * 60 * 1000),
  ...changes
});

describe('C2 / SCRUM-103 see the events I am responsible for', () => {
  describe('AC1 only events assigned to the signed-in coordinator', () => {
    test('TC-0313 onlyForCoordinator keeps this coordinator and drops the rest', () => {
      const events = [
        event({ id: 'mine-1', coordinator_id: 'c1' }),
        event({ id: 'theirs', coordinator_id: 'c2' }),
        event({ id: 'mine-2', coordinator_id: 'c1' })
      ];
      expect(onlyForCoordinator(events, 'c1').map((e) => e.id)).toEqual(['mine-1', 'mine-2']);
    });

    test('TC-0314 buildAssignedView with a coordinatorId returns only that coordinator rows', () => {
      const events = [event({ id: 'mine', coordinator_id: 'c1' }), event({ id: 'theirs', coordinator_id: 'c2' })];
      const rows = buildAssignedView(events, { coordinatorId: 'c1', now: NOW });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('mine');
    });
  });

  describe('AC2 each row shows name, organiser, proposed date, status and time since last activity', () => {
    test('TC-0315 a row exposes all five columns, with organiser falling back to id then Unknown', () => {
      const row = assignedRow(event(), NOW);
      expect(row).toMatchObject({
        name: 'Partner Summit',
        organiser: 'Nadia Organiser',
        proposedDate: '2026-11-04',
        status: 'UNDER_REVIEW'
      });
      expect(row.lastActivityLabel).toBe('2 minutes ago');

      expect(assignedRow(event({ organiser_name: undefined }), NOW).organiser).toBe('u1');
      expect(assignedRow(event({ organiser_name: undefined, organiser_id: undefined }), NOW).organiser).toBe('Unknown');
      expect(assignedRow(event({ name: undefined }), NOW).name).toBe('Untitled event');
    });

    test('TC-0316 time since last activity reads in just-now, minutes, hours and days, and copes with none', () => {
      expect(timeSince(ago(30 * 1000), NOW)).toBe('Just now');
      expect(timeSince(ago(1 * 60 * 1000), NOW)).toBe('1 minute ago');
      expect(timeSince(ago(5 * 60 * 1000), NOW)).toBe('5 minutes ago');
      expect(timeSince(ago(1 * 60 * 60 * 1000), NOW)).toBe('1 hour ago');
      expect(timeSince(ago(3 * 24 * 60 * 60 * 1000), NOW)).toBe('3 days ago');
      expect(timeSince(null, NOW)).toBe('No activity yet');
    });

    test('TC-0317 last activity falls back to created_at when the event has never been updated', () => {
      const row = assignedRow(event({ updated_at: undefined, created_at: ago(2 * 24 * 60 * 60 * 1000) }), NOW);
      expect(row.lastActivityLabel).toBe('2 days ago');
    });
  });

  describe('AC3 the list can be filtered by status and sorted by proposed date', () => {
    const rows = [
      assignedRow(event({ id: 'a', status: 'SUBMITTED', event_date: '2026-11-10' }), NOW),
      assignedRow(event({ id: 'b', status: 'APPROVED', event_date: '2026-11-02' }), NOW),
      assignedRow(event({ id: 'c', status: 'SUBMITTED', event_date: '2026-11-20' }), NOW)
    ];

    test('TC-0318 filtering by a status keeps only that status, and ALL keeps everything', () => {
      expect(filterByStatus(rows, 'SUBMITTED').map((r) => r.id)).toEqual(['a', 'c']);
      expect(filterByStatus(rows, ALL_STATUSES)).toHaveLength(3);
      expect(filterByStatus(rows, '')).toHaveLength(3);
    });

    test('TC-0319 sorting by proposed date orders ascending and descending', () => {
      expect(sortByProposedDate(rows, 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
      expect(sortByProposedDate(rows, 'desc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    });

    test('TC-0320 a row with no proposed date sorts last in both directions', () => {
      const withUndated = [...rows, assignedRow(event({ id: 'd', event_date: null }), NOW)];
      expect(sortByProposedDate(withUndated, 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
      expect(sortByProposedDate(withUndated, 'desc').map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
    });

    test('TC-0321 statusOptions lists ALL first then the distinct statuses present', () => {
      const events = [event({ status: 'SUBMITTED' }), event({ status: 'APPROVED' }), event({ status: 'SUBMITTED' })];
      expect(statusOptions(events)).toEqual([ALL_STATUSES, 'APPROVED', 'SUBMITTED']);
    });
  });

  test('TC-0322 buildAssignedView scopes, filters and sorts together', () => {
    const events = [
      event({ id: 'mine-late', coordinator_id: 'c1', status: 'SUBMITTED', event_date: '2026-12-01' }),
      event({ id: 'mine-early', coordinator_id: 'c1', status: 'SUBMITTED', event_date: '2026-11-01' }),
      event({ id: 'mine-approved', coordinator_id: 'c1', status: 'APPROVED', event_date: '2026-11-15' }),
      event({ id: 'theirs', coordinator_id: 'c2', status: 'SUBMITTED', event_date: '2026-10-20' })
    ];
    const rows = buildAssignedView(events, { coordinatorId: 'c1', status: 'SUBMITTED', sort: 'asc', now: NOW });
    expect(rows.map((r) => r.id)).toEqual(['mine-early', 'mine-late']);
  });

  test('TC-0542 D5 AC2 completed events leave the active list but remain available in all statuses', () => {
    const events = [
      event({ id: 'active', status: 'CONFIRMED' }),
      event({ id: 'completed', status: 'COMPLETED' })
    ];

    expect(buildAssignedView(events, { status: ACTIVE_EVENTS, now: NOW }).map((row) => row.id)).toEqual(['active']);
    expect(buildAssignedView(events, { status: ALL_STATUSES, now: NOW }).map((row) => row.id)).toEqual(['active', 'completed']);
    expect(buildAssignedView(events, { status: 'COMPLETED', now: NOW }).map((row) => row.id)).toEqual(['completed']);
  });
});

// C2 — edges the rows and helpers meet with missing or unusual data.
describe('C2 / SCRUM-103 assigned list edges', () => {
  test('TC-0323 [boundary] C2 AC1 AC3 every helper treats a missing list as empty, and skips empty slots', () => {
    expect(onlyForCoordinator()).toEqual([]);
    expect(onlyForCoordinator([null, event()], 'c1')).toHaveLength(1);
    expect(filterByStatus()).toEqual([]);
    expect(filterByStatus([{ status: 'PLANNING' }], '')).toHaveLength(1);
    expect(sortByProposedDate()).toEqual([]);
    expect(statusOptions()).toEqual([ALL_STATUSES]);
    expect(statusOptions([null, { status: 'PLANNING' }])).toEqual([ALL_STATUSES, 'PLANNING']);
    expect(buildAssignedView()).toEqual([]);
  });

  test('TC-0324 [boundary] C2 AC2 the clock defaults to now; plural hours and a single day read correctly; an unreadable time is no activity', () => {
    expect(timeSince(new Date(Date.now() - 2 * 60 * 1000).toISOString())).toBe('2 minutes ago');
    expect(timeSince(ago(2 * 60 * 60 * 1000), NOW)).toBe('2 hours ago');
    expect(timeSince(ago(24 * 60 * 60 * 1000), NOW)).toBe('1 day ago');
    expect(timeSince('not a date', NOW)).toBe('No activity yet');
    // A time a little in the future (clock skew) reads as just now.
    expect(timeSince(new Date(NOW + 60000).toISOString(), NOW)).toBe('Just now');
  });

  test('TC-0325 [boundary] C2 AC2 / F11 a bare row is named, flagged and dated with fallbacks, using the real clock by default', () => {
    expect(assignedRow()).toMatchObject({
      id: undefined, name: 'Untitled event', organiser: 'Unknown', proposedDate: null, status: null,
      lastActivityAt: null, lastActivityLabel: 'No activity yet', editable: true, replacementNeeded: false
    });
    expect(assignedRow({ editable: false, replacement_needed: true })).toMatchObject({ editable: false, replacementNeeded: true });
  });

  test('TC-0326 [boundary] C2 AC3 rows on the same date keep their order, in either direction', () => {
    const rows = [{ id: 'a', proposedDate: '2026-11-04' }, { id: 'b', proposedDate: '2026-11-04' }];
    expect(sortByProposedDate(rows).map((row) => row.id)).toEqual(['a', 'b']);
    expect(sortByProposedDate(rows, 'desc').map((row) => row.id)).toEqual(['a', 'b']);    const mixed = [{ id: 'none1' }, { id: 'dated', proposedDate: '2026-11-04' }, { id: 'none2' }];
    expect(sortByProposedDate(mixed).map((row) => row.id)).toEqual(['dated', 'none1', 'none2']);
    expect(sortByProposedDate([...mixed].reverse(), 'desc').map((row) => row.id)).toEqual(['dated', 'none2', 'none1']);
  });
});
