import { equipmentActivity, equipmentArrangements, equipmentLineStatus, equipmentRequestStatus, equipmentUpdateText } from './eventEquipment';
import { activityEntries } from './ordinaryEventChanges';

const request = {
  status: 'PENDING',
  lines: [
    { equipment_type: 'AUDIO_SYSTEM', quantity: 2, fulfillment_status: 'RESERVED', reservation_id: 'r1', fulfilled_at: '2026-10-05T02:00:00.000Z' },
    { equipment_type: 'PROJECTOR', quantity: 1, fulfillment_status: 'PENDING' },
    { equipment_type: 'STAGE_LIGHTING', quantity: 4, fulfillment_status: 'RESOLVED', resolution: 'UNABLE_TO_FULFILL', resolution_reason: 'None free that day', resolved_at: '2026-10-06T02:00:00.000Z' }
  ]
};
const reservations = [{ id: 'r1', reservation_id: 'r1', start_datetime: '2026-11-04T01:00:00.000Z', end_datetime: '2026-11-04T09:00:00.000Z', status: 'RESERVED' }];

describe('equipment arrangements on the coordinator event page', () => {
  test('TC-477 G4 a reserved line reads Approved, like an approved venue booking; others read Pending or Unable to fulfil', () => {
    expect(equipmentLineStatus({ fulfillment_status: 'RESERVED' })).toEqual({ label: 'Approved', tone: 'positive' });
    expect(equipmentLineStatus({ fulfillment_status: 'PENDING' })).toEqual({ label: 'Pending', tone: 'warning' });
    expect(equipmentLineStatus({ fulfillment_status: 'RESOLVED' })).toEqual({ label: 'Unable to fulfil', tone: 'danger' });
    expect(equipmentLineStatus({ fulfillment_status: 'RELEASED' })).toEqual({ label: 'Released', tone: 'neutral' });
  });

  test('TC-478 G4 each request line carries its status, and an approved line its reservation window', () => {
    const view = equipmentArrangements(request, reservations);
    expect(view.status.label).toBe('Pending');
    expect(view.lines.map((line) => [line.label, line.status.label])).toEqual([
      ['Audio system × 2', 'Approved'], ['Projector × 1', 'Pending'], ['Stage lighting × 4', 'Unable to fulfil']
    ]);
    expect(view.lines[0]).toMatchObject({ reservedFrom: '2026-11-04T01:00:00.000Z', reservedTo: '2026-11-04T09:00:00.000Z', decidedAt: '2026-10-05T02:00:00.000Z' });
    expect(view.lines[2]).toMatchObject({ reservedFrom: null, reason: 'None free that day' });
    expect(equipmentArrangements({ ...request, status: 'ARRANGED' }, reservations).status.label).toBe('Partly reserved');
    expect(equipmentArrangements(null)).toBeNull();
  });

  test('TC-479 G4 Technical Support decisions become Activity entries credited to Technical Support', () => {
    const rows = equipmentActivity([
      { id: 'q1', action: 'LINE_RESERVED', actor_id: 'tech1', created_at: '2026-10-05T02:00:00.000Z', equipment_type: 'AUDIO_SYSTEM', quantity: 2 },
      { id: 'q2', action: 'LINE_UNABLE_TO_FULFILL', actor_id: 'tech1', created_at: '2026-10-06T02:00:00.000Z', equipment_type: 'STAGE_LIGHTING', quantity: 4, reason: 'None free that day' },
      { id: 'q3', action: 'SOMETHING_ELSE', actor_id: 'tech1', created_at: '2026-10-07T02:00:00.000Z' }
    ]);
    expect(rows).toHaveLength(2);

    const [unable, reserved] = activityEntries(rows, {});
    expect(reserved).toMatchObject({
      action: 'Approved an equipment reservation', actor: 'Technical Support', at: '2026-10-05T02:00:00.000Z',
      changes: [{ label: 'Equipment', oldValue: 'Audio system × 2 — Pending', newValue: 'Audio system × 2 — Approved' }]
    });
    expect(unable).toMatchObject({ action: 'Marked equipment unable to fulfil', reason: 'None free that day' });
  });

  test('TC-480 a venue booking approval with no readable Venue Staff name is credited to Venue Staff', () => {
    const [entry] = activityEntries([{ id: 'h1', action_type: 'VENUE_BOOKING_APPROVED', actor_id: 'vs1', created_at: '2026-10-05T02:00:00.000Z' }], {});
    expect(entry.actor).toBe('Venue Staff');
  });
});

describe('the coordinator equipment requests screen wording', () => {
  const lines = (...statuses) => statuses.map((fulfillment_status) => ({ equipment_type: 'AUDIO', quantity: 1, fulfillment_status }));

  test('TC-481 G4 a finished request reads Reserved, Partly reserved or Unable to fulfil, never Arranged', () => {
    expect(equipmentRequestStatus(null).label).toBe('Not submitted');
    expect(equipmentRequestStatus({ status: 'PENDING', lines: lines('RESERVED', 'PENDING') }).label).toBe('Pending');
    expect(equipmentRequestStatus({ status: 'ARRANGED', lines: lines('RESERVED', 'RESERVED') })).toEqual({ label: 'Reserved', tone: 'positive' });
    expect(equipmentRequestStatus({ status: 'ARRANGED', lines: lines('RESERVED', 'RESOLVED') }).label).toBe('Partly reserved');
    expect(equipmentRequestStatus({ status: 'ARRANGED', lines: lines('RESOLVED') })).toEqual({ label: 'Unable to fulfil', tone: 'danger' });
    expect(equipmentRequestStatus({ status: 'CANCELLED', lines: lines('RELEASED') })).toEqual({ label: 'Cancelled', tone: 'neutral' });
  });

  test('TC-482 G4 each Technical Support decision reads as a plain sentence', () => {
    expect(equipmentUpdateText({ action: 'LINE_RESERVED', equipment_type: 'STAGING', quantity: 1 })).toBe('Reserved 1 × staging');
    expect(equipmentUpdateText({ action: 'LINE_UNABLE_TO_FULFILL', equipment_type: 'VISUAL', quantity: 3, reason: 'None free' })).toBe('Unable to fulfil 3 × visual: None free');
    expect(equipmentUpdateText({ action: 'LINE_RESERVATION_RELEASED', equipment_type: 'AUDIO', quantity: 2, reason: 'Not needed' })).toBe('Released 2 × audio: Not needed');
    expect(equipmentUpdateText({
      action: 'LINE_AMENDED', old_values: { equipment_type: 'AUDIO', quantity: 2 }, new_values: { equipment_type: 'VISUAL', quantity: 3 }, note: 'Substitute'
    })).toBe('Amended 2 × audio → 3 × visual: Substitute');
  });
});
