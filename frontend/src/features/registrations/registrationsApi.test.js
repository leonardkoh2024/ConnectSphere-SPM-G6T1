// H2 / SCRUM-140 — the attendee's browser asks the registration service for the
// open events; it never reads the events collection itself (AC3).

import { auth } from "../../lib/firebase";
import { acceptInvitation, declineInvitation, joinWaitlist, loadMyRegistrations, loadOpenEvents, registerForEvent, withdrawFromEvent } from "./registrationsApi";

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

// H3 / SCRUM-141 — registering is a call to the registration service too: the browser
// has no create on `registrations`, so the place is counted and taken on the server.

test("TC-595 registering posts to the event's register route with the attendee's ID token", async () => {
  const reply201 = { registration: { registration_id: "e1_attendee-1", status: "REGISTERED" }, event: { id: "e1", remaining_places: 3 } };
  global.fetch.mockResolvedValue(reply(201, reply201));

  await expect(registerForEvent("e1")).resolves.toEqual(reply201);
  expect(global.fetch).toHaveBeenCalledWith("/api/registrations/events/e1/register", {
    method: "POST",
    headers: { Authorization: "Bearer id-token" }
  });
});

test("TC-595 an event id is escaped into the path", async () => {
  global.fetch.mockResolvedValue(reply(201, { registration: {}, event: {} }));
  await registerForEvent("a/b");
  expect(global.fetch.mock.calls[0][0]).toBe("/api/registrations/events/a%2Fb/register");
});

test("TC-596 a refusal keeps the service's message and its reason", async () => {
  global.fetch.mockResolvedValue(reply(409, { error: "This event is full.", reason: "full" }));
  await expect(registerForEvent("e1")).rejects.toMatchObject({ message: "This event is full.", reason: "full" });
});

test("TC-596 a backend that is not running is named as the problem when registering too", async () => {
  global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(registerForEvent("e1")).rejects.toThrow(/registration service is not responding/i);
});

// H4 / SCRUM-142 — the attendee's own registrations come from the service as well.

test("TC-637 the attendee's registrations are fetched with their ID token", async () => {
  const registrations = [{ registration_id: "e1_attendee-1", status: "REGISTERED" }];
  global.fetch.mockResolvedValue(reply(200, { registrations }));

  await expect(loadMyRegistrations()).resolves.toEqual(registrations);
  expect(global.fetch).toHaveBeenCalledWith("/api/registrations/mine", {
    headers: { Authorization: "Bearer id-token" }
  });
});

test("TC-637 a refusal is passed on", async () => {
  global.fetch.mockResolvedValue(reply(403, { error: "Only attendees can see their registrations." }));
  await expect(loadMyRegistrations()).rejects.toThrow("Only attendees can see their registrations.");
});

// H5 / SCRUM-143 — withdrawing is a call to the service too: no browser updates `registrations`.

test("TC-670 withdrawing posts to the event's withdraw route with the attendee's ID token", async () => {
  const replied = { registration: { registration_id: "e1_attendee-1", status: "WITHDRAWN" }, remaining_places: 4 };
  global.fetch.mockResolvedValue(reply(200, replied));

  await expect(withdrawFromEvent("e/1")).resolves.toEqual(replied);
  expect(global.fetch).toHaveBeenCalledWith("/api/registrations/events/e%2F1/withdraw", {
    method: "POST",
    headers: { Authorization: "Bearer id-token" }
  });
});

test("TC-670 a refusal keeps the service's message and reason", async () => {
  global.fetch.mockResolvedValue(reply(409, { error: "You are not registered for this event.", reason: "not_registered" }));
  await expect(withdrawFromEvent("e1")).rejects.toMatchObject({ message: "You are not registered for this event.", reason: "not_registered" });
});

// H6 / SCRUM-144 — joining the waiting list is a call to the service too.

test("TC-700 joining the waiting list posts to the event's waitlist route with the attendee's ID token", async () => {
  const replied = { registration: { registration_id: "e1_attendee-1", status: "WAITLISTED", waitlist_position: 3 } };
  global.fetch.mockResolvedValue(reply(201, replied));

  await expect(joinWaitlist("e/1")).resolves.toEqual(replied);
  expect(global.fetch).toHaveBeenCalledWith("/api/registrations/events/e%2F1/waitlist", {
    method: "POST",
    headers: { Authorization: "Bearer id-token" }
  });
});

test("TC-700 a refusal keeps the service's message and reason", async () => {
  global.fetch.mockResolvedValue(reply(409, { error: "A place is free, so register instead.", reason: "places_available" }));
  await expect(joinWaitlist("e1")).rejects.toMatchObject({ message: "A place is free, so register instead.", reason: "places_available" });
});

// H7 / SCRUM-145 — accepting or declining an offered place goes through the service.

test("TC-753 accepting and declining post to the event's invitation routes with the ID token", async () => {
  global.fetch.mockResolvedValue(reply(200, { registration: { status: "REGISTERED" } }));
  await expect(acceptInvitation("e/1")).resolves.toEqual({ registration: { status: "REGISTERED" } });
  expect(global.fetch).toHaveBeenLastCalledWith("/api/registrations/events/e%2F1/invitation/accept", { method: "POST", headers: { Authorization: "Bearer id-token" } });

  global.fetch.mockResolvedValue(reply(200, { registration: { status: "WITHDRAWN" } }));
  await declineInvitation("e1");
  expect(global.fetch).toHaveBeenLastCalledWith("/api/registrations/events/e1/invitation/decline", { method: "POST", headers: { Authorization: "Bearer id-token" } });
});

test("TC-753 a refusal keeps the service's message and reason", async () => {
  global.fetch.mockResolvedValue(reply(409, { error: "This invitation has expired.", reason: "invitation_expired" }));
  await expect(acceptInvitation("e1")).rejects.toMatchObject({ message: "This invitation has expired.", reason: "invitation_expired" });
});

