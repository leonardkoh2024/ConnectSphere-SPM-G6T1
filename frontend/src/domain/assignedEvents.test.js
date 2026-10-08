import {
  ALL_STATUSES,
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
    test('TC-118 onlyForCoordinator keeps this coordinator and drops the rest', () => {
      const events = [
        event({ id: 'mine-1', coordinator_id: 'c1' }),
        event({ id: 'theirs', coordinator_id: 'c2' }),
        event({ id: 'mine-2', coordinator_id: 'c1' })
      ];
      expect(onlyForCoordinator(events, 'c1').map((e) => e.id)).toEqual(['mine-1', 'mine-2']);
    });

    test('TC-118 buildAssignedView with a coordinatorId returns only that coordinator rows', () => {
      const events = [event({ id: 'mine', coordinator_id: 'c1' }), event({ id: 'theirs', coordinator_id: 'c2' })];
      const rows = buildAssignedView(events, { coordinatorId: 'c1', now: NOW });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('mine');
    });
  });

  describe('AC2 each row shows name, organiser, proposed date, status and time since last activity', () => {
    test('TC-119 a row exposes all five columns, with organiser falling back to id then Unknown', () => {
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

    test('TC-120 time since last activity reads in just-now, minutes, hours and days, and copes with none', () => {
      expect(timeSince(ago(30 * 1000), NOW)).toBe('Just now');
      expect(timeSince(ago(1 * 60 * 1000), NOW)).toBe('1 minute ago');
      expect(timeSince(ago(5 * 60 * 1000), NOW)).toBe('5 minutes ago');
      expect(timeSince(ago(1 * 60 * 60 * 1000), NOW)).toBe('1 hour ago');
      expect(timeSince(ago(3 * 24 * 60 * 60 * 1000), NOW)).toBe('3 days ago');
      expect(timeSince(null, NOW)).toBe('No activity yet');
    });

    test('TC-120 last activity falls back to created_at when the event has never been updated', () => {
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

    test('TC-121 filtering by a status keeps only that status, and ALL keeps everything', () => {
      expect(filterByStatus(rows, 'SUBMITTED').map((r) => r.id)).toEqual(['a', 'c']);
      expect(filterByStatus(rows, ALL_STATUSES)).toHaveLength(3);
      expect(filterByStatus(rows, '')).toHaveLength(3);
    });

    test('TC-122 sorting by proposed date orders ascending and descending', () => {
      expect(sortByProposedDate(rows, 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
      expect(sortByProposedDate(rows, 'desc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    });

    test('TC-123 a row with no proposed date sorts last in both directions', () => {
      const withUndated = [...rows, assignedRow(event({ id: 'd', event_date: null }), NOW)];
      expect(sortByProposedDate(withUndated, 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c', 'd']);
      expect(sortByProposedDate(withUndated, 'desc').map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
    });

    test('TC-124 statusOptions lists ALL first then the distinct statuses present', () => {
      const events = [event({ status: 'SUBMITTED' }), event({ status: 'APPROVED' }), event({ status: 'SUBMITTED' })];
      expect(statusOptions(events)).toEqual([ALL_STATUSES, 'APPROVED', 'SUBMITTED']);
    });
  });

  test('TC-125 buildAssignedView scopes, filters and sorts together', () => {
    const events = [
      event({ id: 'mine-late', coordinator_id: 'c1', status: 'SUBMITTED', event_date: '2026-12-01' }),
      event({ id: 'mine-early', coordinator_id: 'c1', status: 'SUBMITTED', event_date: '2026-11-01' }),
      event({ id: 'mine-approved', coordinator_id: 'c1', status: 'APPROVED', event_date: '2026-11-15' }),
      event({ id: 'theirs', coordinator_id: 'c2', status: 'SUBMITTED', event_date: '2026-10-20' })
    ];
    const rows = buildAssignedView(events, { coordinatorId: 'c1', status: 'SUBMITTED', sort: 'asc', now: NOW });
    expect(rows.map((r) => r.id)).toEqual(['mine-early', 'mine-late']);
  });
});
