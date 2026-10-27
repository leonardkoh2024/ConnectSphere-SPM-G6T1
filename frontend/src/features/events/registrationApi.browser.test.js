// H1 / SCRUM-139 — the browser's adapter to the registration service: it signs the
// request with the organiser's ID token, sends and reads the settings in the shapes the
// Registration tab uses, and carries the service's refusals (with their field messages)
// to the screen. Same style as equipmentApi.browser.test.js.

const mockFetch = jest.fn();

jest.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "org-1", getIdToken: jest.fn().mockResolvedValue("test-id-token") } },
  db: { name: "test-firestore" }
}));

import { auth } from "../../lib/firebase";
import { registrationApi } from "./registrationApi";

const originalFetch = global.fetch;

const serviceSettings = {
  settings: {
    registration_capacity: 80,
    registration_open_date: "2026-11-10",
    registration_open_time: "09:00",
    registration_close_date: "2026-12-01",
    registration_close_time: "17:00"
  },
  venue_capacity: 140,
  registered_count: 12,
  phase: "SCHEDULED",
  editable: true,
  refusal: null
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.currentUser.getIdToken.mockResolvedValue("test-id-token");
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

test("H1-TC49 AC2 AC3 AC5 load asks the registration service for the event, signed with the organiser's token, and returns form values", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => serviceSettings });

  await expect(registrationApi.load("e1")).resolves.toEqual({
    settings: {
      registrationCapacity: "80",
      registrationOpenDate: "2026-11-10",
      registrationOpenTime: "09:00",
      registrationCloseDate: "2026-12-01",
      registrationCloseTime: "17:00"
    },
    venueCapacity: 140,
    registeredCount: 12,
    phase: "SCHEDULED",
    editable: true,
    refusal: null
  });

  const [url, options] = mockFetch.mock.calls[0];
  expect(url).toBe("/api/registrations/events/e1/settings");
  expect(options.headers.Authorization).toBe("Bearer test-id-token");
});

test("H1-TC50 AC2 AC3 save PUTs the form values to the service as the stored fields and returns the refreshed settings", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ...serviceSettings, phase: "OPEN" }) });

  const saved = await registrationApi.save("e1", {
    registrationCapacity: "120",
    registrationOpenDate: "2026-11-12",
    registrationOpenTime: "10:00",
    registrationCloseDate: "2026-12-02",
    registrationCloseTime: "18:00"
  });

  const [url, options] = mockFetch.mock.calls[0];
  expect(url).toBe("/api/registrations/events/e1/settings");
  expect(options.method).toBe("PUT");
  expect(options.headers.Authorization).toBe("Bearer test-id-token");
  expect(JSON.parse(options.body)).toEqual({
    registration_capacity: 120,
    registration_open_date: "2026-11-12",
    registration_open_time: "10:00",
    registration_close_date: "2026-12-02",
    registration_close_time: "18:00"
  });
  expect(saved.phase).toBe("OPEN");
});

test("H1-TC51 AC3 a refusal from the service reaches the screen with its message and its per-field messages", async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 422,
    json: async () => ({ error: "Check the registration settings.", fields: { registrationCapacity: "Registration capacity cannot exceed the venue capacity of 140." } })
  });

  await expect(registrationApi.save("e1", { registrationCapacity: "500" })).rejects.toMatchObject({
    message: "Check the registration settings.",
    fields: { registrationCapacity: "Registration capacity cannot exceed the venue capacity of 140." }
  });
});

test("H1-TC52 AC1 with nobody signed in nothing is sent", async () => {
  auth.currentUser = null;
  await expect(registrationApi.load("e1")).rejects.toThrow(/sign in/i);
  expect(mockFetch).not.toHaveBeenCalled();
  auth.currentUser = { uid: "org-1", getIdToken: jest.fn().mockResolvedValue("test-id-token") };
});

// H8 / SCRUM-146 — the organiser's registration list. Same adapter, same signed request; the
// service speaks snake_case and the screen gets camelCase.

const serviceList = {
  event_id: "e1",
  counts: { registered: 2, waitlisted: 3, withdrawn: 1 },
  attendees: [
    { registration_id: "r1", attendee_id: "a1", name: "Alicia Tan", email: "alicia@example.com", mobile_number: "91234567", registered_at: "2026-11-03T01:00:00.000Z" },
    { registration_id: "r2", attendee_id: "a2", name: null, email: null, mobile_number: null, registered_at: null }
  ]
};

test("H8-TC19 AC1 AC2 loadAttendees asks the service for this event's list, signed with the organiser's token, and returns screen values", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => serviceList });

  await expect(registrationApi.loadAttendees("e1")).resolves.toEqual({
    counts: { registered: 2, waitlisted: 3, withdrawn: 1 },
    attendees: [
      { id: "r1", attendeeId: "a1", name: "Alicia Tan", email: "alicia@example.com", mobileNumber: "91234567", registeredAt: "2026-11-03T01:00:00.000Z" },
      { id: "r2", attendeeId: "a2", name: null, email: null, mobileNumber: null, registeredAt: null }
    ]
  });

  const [url, options] = mockFetch.mock.calls[0];
  expect(url).toBe("/api/registrations/events/e1/attendees");
  expect(options.method).toBe("GET");
  expect(options.headers.Authorization).toBe("Bearer test-id-token");
});

test("H8-TC20 AC1 the event id is encoded into the path, so it cannot be used to reach another route", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ counts: {}, attendees: [] }) });
  await registrationApi.loadAttendees("e1/../settings");
  expect(mockFetch.mock.calls[0][0]).toBe("/api/registrations/events/e1%2F..%2Fsettings/attendees");
});

test("H8-TC21 AC2 a list with nothing in it comes back as zero counts and no attendees, never as undefined", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ event_id: "e1" }) });
  await expect(registrationApi.loadAttendees("e1")).resolves.toEqual({
    counts: { registered: 0, waitlisted: 0, withdrawn: 0 },
    attendees: []
  });
});

test("H8-TC22 AC3 a refusal from the service reaches the screen with its own message", async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "You can view the registration list for your own events only." }) });
  await expect(registrationApi.loadAttendees("e2")).rejects.toThrow("You can view the registration list for your own events only.");
});

test("H8-TC23 a service that cannot be reached is said so, not shown as an empty list", async () => {
  mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(registrationApi.loadAttendees("e1")).rejects.toThrow(/registration service is not responding/i);
});

test("H8-TC24 AC3 with nobody signed in nothing is sent", async () => {
  auth.currentUser = null;
  await expect(registrationApi.loadAttendees("e1")).rejects.toThrow(/sign in/i);
  expect(mockFetch).not.toHaveBeenCalled();
  auth.currentUser = { uid: "org-1", getIdToken: jest.fn().mockResolvedValue("test-id-token") };
});
