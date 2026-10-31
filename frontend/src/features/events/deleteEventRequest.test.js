// B8 / SCRUM-99 — deleting a draft removes the event and every record hanging off it,
// children first, so the child rules can still find the parent to prove ownership.
import * as firestore from 'firebase/firestore';
import { deleteEventRequest } from './eventRequestApi';

jest.mock('../../lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), deleteDoc: jest.fn(), doc: jest.fn(), getDocs: jest.fn(), query: jest.fn(), where: jest.fn()
}));

let deleted;

beforeEach(() => {
  deleted = [];
  firestore.collection.mockImplementation((db, name) => ({ name }));
  firestore.where.mockImplementation((field, op, value) => ({ field, op, value }));
  firestore.query.mockImplementation((source, constraint) => ({ name: source.name, constraint }));
  firestore.doc.mockImplementation((db, name, id) => ({ path: `${name}/${id}` }));
  firestore.getDocs.mockImplementation(async (q) => ({
    docs: q.name === 'event_facilities'
      ? [{ ref: { path: 'event_facilities/f1' } }, { ref: { path: 'event_facilities/f2' } }]
      : q.name === 'event_history' ? [{ ref: { path: 'event_history/h1' } }] : []
  }));
  firestore.deleteDoc.mockImplementation(async (ref) => { deleted.push(ref.path); });
});

describe('B8 SCRUM-99 delete a draft', () => {
  describe('normal', () => {
    test('TC-0226 B8 AC3 the event and all its requirement, facility, equipment, accessibility and history records are deleted', async () => {
      await deleteEventRequest('e1');

      expect(deleted.sort()).toEqual([
        'event_facilities/f1', 'event_facilities/f2', 'event_history/h1', 'event_venue_requirements/e1', 'events/e1'
      ]);
      const asked = firestore.getDocs.mock.calls.map(([q]) => q.name).sort();
      expect(asked).toEqual(['event_accessibility', 'event_equipment', 'event_facilities', 'event_history']);
      firestore.getDocs.mock.calls.forEach(([q]) => expect(q.constraint).toEqual({ field: 'event_id', op: '==', value: 'e1' }));
    });

    test('TC-0227 B8 the event itself goes last, after every child', async () => {
      await deleteEventRequest('e1');
      expect(deleted[deleted.length - 1]).toBe('events/e1');
    });
  });

  describe('boundary', () => {
    test('TC-0228 B8 a draft with no linked records still deletes its requirement row and the event', async () => {
      firestore.getDocs.mockResolvedValue({ docs: [] });
      await deleteEventRequest('e2');
      expect(deleted).toEqual(['event_venue_requirements/e2', 'events/e2']);
    });
  });

  describe('failure', () => {
    test('TC-0229 B8 when a child cannot be deleted the event is kept, so the draft is not half-orphaned', async () => {
      firestore.deleteDoc.mockImplementation(async (ref) => {
        if (ref.path === 'event_history/h1') throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        deleted.push(ref.path);
      });

      await expect(deleteEventRequest('e1')).rejects.toThrow('Missing or insufficient permissions.');
      expect(deleted).not.toContain('events/e1');
    });

    test('TC-0230 B8 when the linked records cannot be read nothing is deleted', async () => {
      firestore.getDocs.mockRejectedValue(new Error('unavailable'));
      await expect(deleteEventRequest('e1')).rejects.toThrow('unavailable');
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
    });
  });
});
