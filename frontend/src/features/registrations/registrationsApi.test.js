// H2 / SCRUM-140 — the attendee's browser asks the registration service for the
// open events; it never reads the events collection itself (AC3).

import { auth } from "../../lib/firebase";
import { loadOpenEvents } from "./registrationsApi";

jest.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "attendee-1", getIdToken: jest.fn() } },
  db: {}
}));

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  auth.currentUser = { uid: "attendee-1", getIdToken: jest.fn().mockResolvedValue("id-token") };
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

test("TC-564 the open events come from the registration service, sent with the attendee's ID token", async () => {
  const events = [{ id: "e1", name: "Harbour Tech Forum", remaining_places: 4 }];
  global.fetch.mockResolvedValue(reply(200, { events }));

  await expect(loadOpenEvents()).resolves.toEqual(events);
  expect(global.fetch).toHaveBeenCalledWith("/api/registrations/open-events", {
    headers: { Authorization: "Bearer id-token" }
  });
});

test("TC-565 the service's own refusal is passed on", async () => {
  global.fetch.mockResolvedValue(reply(403, { error: "Only attendees can browse events open for registration." }));
  await expect(loadOpenEvents()).rejects.toThrow("Only attendees can browse events open for registration.");
});

test("TC-565 a backend that is not running is named as the problem", async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new SyntaxError("Proxy error"); } });
  await expect(loadOpenEvents()).rejects.toThrow(/registration service is not responding/i);
});

test("TC-565 a signed-out browser is not sent to the service", async () => {
  auth.currentUser = null;
  await expect(loadOpenEvents()).rejects.toThrow(/sign in/i);
  expect(global.fetch).not.toHaveBeenCalled();
});
