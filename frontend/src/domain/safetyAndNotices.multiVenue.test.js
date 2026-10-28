const { outstandingForSafetyCheck, sendForSafetyCheck } = require('./safetyAndNotices');

const event = { event_id: 'E1', name: 'Conference', status: 'PLANNING' };

describe('F11/F13 multi-venue readiness for L1', () => {
  test('requires at least one active approved venue booking', () => {
    expect(outstandingForSafetyCheck({ bookings: [] }))
      .toContain('an approved venue booking');
    expect(sendForSafetyCheck({ event, bookings: [] })).toMatchObject({
      ok: false,
      reason: 'outstanding'
    });
  });

  test('a rejected booking awaiting another request remains outstanding', () => {
    const bookings = [
      { booking_label: 'Main programme', status: 'APPROVED' },
      { booking_label: 'Breakout room', status: 'REJECTED', requires_re_request: true }
    ];
    expect(outstandingForSafetyCheck({ bookings })).toContain('Breakout room');
    expect(sendForSafetyCheck({ event, bookings })).toMatchObject({ ok: false, reason: 'outstanding' });
  });

  test('an approved booking that needs replacement remains outstanding', () => {
    const bookings = [
      { booking_label: 'Main programme', status: 'APPROVED' },
      { booking_label: 'Breakout room', status: 'APPROVED', replacement_needed: true }
    ];
    expect(outstandingForSafetyCheck({ bookings }))
      .toContain('Breakout room needs a replacement');
  });

  test('released and replaced history does not block remaining approved venues', () => {
    const bookings = [
      { booking_label: 'Main programme', status: 'APPROVED' },
      { booking_label: 'Old breakout', status: 'REPLACED' },
      { booking_label: 'Released workshop', status: 'RELEASED' }
    ];
    expect(outstandingForSafetyCheck({ bookings })).toEqual([]);
  });
});
