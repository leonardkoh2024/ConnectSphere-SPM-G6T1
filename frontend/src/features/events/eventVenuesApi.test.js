// B10 / SCRUM-101 — the organiser's event venues come from the event service, signed with
// their ID token.

import { auth } from '../../lib/firebase';
import { loadEventVenueNames } from './eventVenuesApi';

jest.mock('../../lib/firebase', () => ({ auth: { currentUser: null }, db: {} }));

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  auth.currentUser = { getIdToken: jest.fn().mockResolvedValue('id-token') };
  global.fetch = jest.fn();
});

afterEach(() => { delete global.fetch; });

test('TC-0291 the venue names are fetched with the ID token, and a refusal is passed on', async () => {
  global.fetch.mockResolvedValue(reply(200, { venue_names: ['Harbour Hall'] }));
  await expect(loadEventVenueNames('e 1')).resolves.toEqual(['Harbour Hall']);
  expect(global.fetch).toHaveBeenCalledWith('/api/events/e%201/venues', { headers: { Authorization: 'Bearer id-token' } });

  global.fetch.mockResolvedValue(reply(403, { error: 'You are not authorised to view this event.' }));
  await expect(loadEventVenueNames('e1')).rejects.toThrow('You are not authorised to view this event.');
});

describe('B10 SCRUM-101 loadEventVenueNames edges', () => {
  test('TC-0292 [boundary] an event with no approved venue comes back as an empty list, never undefined', async () => {
    global.fetch.mockResolvedValue(reply(200, {}));
    await expect(loadEventVenueNames('e1')).resolves.toEqual([]);
  });

  test('TC-0293 [failure] a refusal with no message of its own is worded by the adapter', async () => {
    global.fetch.mockResolvedValue(reply(500, null));
    await expect(loadEventVenueNames('e1')).rejects.toThrow("The event's venues could not be loaded.");
  });

  test('TC-0294 [failure] with nobody signed in nothing is sent', async () => {
    auth.currentUser = null;
    await expect(loadEventVenueNames('e1')).rejects.toThrow('Please sign in again.');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
