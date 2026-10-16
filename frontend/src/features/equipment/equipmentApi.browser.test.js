const mockGetDoc = jest.fn();
const mockFetch = jest.fn();

jest.mock("firebase/firestore", () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (_database, collectionName, id) => ({ path: `${collectionName}/${id}`, id }),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: jest.fn(),
  query: (reference) => reference,
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(),
  where: (...parts) => parts
}));

jest.mock("../../lib/firebase", () => ({
  auth: { currentUser: { uid: "tech-1", getIdToken: jest.fn().mockResolvedValue("test-id-token") } },
  db: { name: "test-firestore" }
}));

import { getDocs } from "firebase/firestore";
import { auth } from "../../lib/firebase";
import {
  amendEquipmentRequestLine,
  listPendingEquipmentRequests,
  loadEquipmentCatalogue,
  markEquipmentLineUnableToFulfill,
  releaseEquipmentReservation,
  reserveEquipmentForEvent
} from "./equipmentApi";

const originalFetch = global.fetch;
const snapshot = (data) => ({ exists: () => true, data: () => data });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockGetDoc.mockResolvedValue(snapshot({ role: "TECHNICAL_SUPPORT_STAFF" }));
});

afterAll(() => {
  global.fetch = originalFetch;
});

test("TC-303 the browser sends the authenticated reservation request to the equipment service", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      reservation: {
        id: "reservation-1",
        event_id: "event-1",
        equipment_type: "AUDIO",
        quantity: 3,
        start_datetime: "2026-11-04T00:30:00.000Z",
        end_datetime: "2026-11-04T09:30:00.000Z",
        status: "RESERVED"
      }
    })
  });

  await expect(reserveEquipmentForEvent({
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 3
  })).resolves.toMatchObject({
    id: "reservation-1",
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 3,
    status: "RESERVED"
  });
  expect(mockFetch).toHaveBeenCalledWith("/api/equipment/reservations", expect.any(Object));
  const [, options] = mockFetch.mock.calls[0];
  expect(options).toMatchObject({
    method: "POST",
    body: JSON.stringify({ event_id: "event-1", equipment_type: "AUDIO", quantity: 3 })
  });
  expect(options.headers["Content-Type"]).toBe("application/json");
  expect(options.headers.Authorization).toMatch(/^Bearer /);
});

test("TC-301 the browser displays the service's reason when stock or time is unavailable", async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Requested quantity unavailable for the required time period: 1 free, 1 more needed." })
  });
  await expect(reserveEquipmentForEvent({
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 2
  })).rejects.toThrow(/1 free, 1 more needed/i);
});

test("TC-305 releasing a reservation uses the authenticated equipment service endpoint", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ reservationId: "reservation-1", status: "RELEASED" })
  });
  await expect(releaseEquipmentReservation({ reservationId: "reservation-1" }))
    .resolves.toEqual({ reservationId: "reservation-1", status: "RELEASED" });
  expect(mockFetch).toHaveBeenCalledWith("/api/equipment/reservations/reservation-1/release", expect.any(Object));
  const [, options] = mockFetch.mock.calls[0];
  expect(options).toMatchObject({
    method: "POST",
    body: JSON.stringify({ reason: "No longer required" })
  });
  expect(options.headers["Content-Type"]).toBe("application/json");
  expect(options.headers.Authorization).toMatch(/^Bearer /);
});

test("TC-307 amendment calls the authenticated equipment service with the note and changed values", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ eventId: "event-1", lineIndex: 0 }) });
  await expect(amendEquipmentRequestLine({
    eventId: "event-1",
    lineIndex: 0,
    equipmentType: "VISUAL",
    quantity: 3,
    note: "Substitute visual equipment."
  })).resolves.toMatchObject({ lineIndex: 0 });
  expect(mockFetch).toHaveBeenCalledWith("/api/equipment/requests/event-1/lines/0", expect.any(Object));
  const [, options] = mockFetch.mock.calls[0];
  expect(JSON.parse(options.body)).toEqual({
    equipment_type: "VISUAL",
    quantity: 3,
    note: "Substitute visual equipment."
  });
});

test("TC-309 unable-to-fulfil resolution calls the authenticated service with its reason", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: "ARRANGED" }) });
  await expect(markEquipmentLineUnableToFulfill({
    eventId: "event-1",
    lineIndex: 1,
    reason: "No compatible unit is available."
  })).resolves.toEqual({ status: "ARRANGED" });
  expect(mockFetch).toHaveBeenCalledWith(
    "/api/equipment/requests/event-1/lines/1/unable-to-fulfill",
    expect.any(Object)
  );
  const [, options] = mockFetch.mock.calls[0];
  expect(JSON.parse(options.body)).toEqual({ reason: "No compatible unit is available." });
});

// When the backend is not running, CRA's dev proxy answers with a plain-text
// "Proxy error: ..." page, not JSON. Each equipment action says the service is
// unreachable instead of showing the JSON parse error. TC-392 in
// docs/test-cases.md.
test.each([
  ["reserving", () => reserveEquipmentForEvent({ eventId: "event-1", equipmentType: "AUDIO", quantity: 1 })],
  ["releasing", () => releaseEquipmentReservation({ reservationId: "reservation-1" })],
  ["amending", () => amendEquipmentRequestLine({ eventId: "event-1", lineIndex: 0, equipmentType: "AUDIO", quantity: 1, note: "x" })],
  ["marking unable to fulfil", () => markEquipmentLineUnableToFulfill({ eventId: "event-1", lineIndex: 0, reason: "x" })]
])("TC-392 %s reports an unreachable equipment service rather than a JSON error", async (_name, run) => {
  const proxyError = "Proxy error: Could not proxy request /api/equipment/reservations from localhost:3000 to http://localhost:4000/ (ECONNREFUSED).";
  mockFetch.mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => JSON.parse(proxyError),
    text: async () => proxyError
  });
  await expect(run()).rejects.toThrow(
    "The equipment service is not responding. Check that the backend is running (npm start), then try again."
  );

  // A reply that is not JSON from the service itself still gives a readable error.
  mockFetch.mockResolvedValue({ ok: false, status: 502, json: async () => JSON.parse("<html>"), text: async () => "<html>" });
  await expect(run()).rejects.toThrow(/not responding/);

  // A network failure (no proxy in front) is reported the same way.
  mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(run()).rejects.toThrow(/not responding/);
});

// The catalogue comes from the equipment service, which can join each
// reservation to its event after the request has left the Pending queue.
// TC-397 in docs/test-cases.md.
test("TC-397 the catalogue is read from the equipment service with the caller's token, and carries the caller's id", async () => {
  auth.currentUser.getIdToken.mockResolvedValue("test-id-token");
  const body = { inventory: [{ equipment_type: "AUDIO", total_quantity: 10 }], reservations: [], unavailability: [] };
  mockFetch.mockResolvedValue({ ok: true, json: async () => body });
  await expect(loadEquipmentCatalogue()).resolves.toEqual({ ...body, userId: "tech-1" });
  expect(mockFetch).toHaveBeenCalledWith("/api/equipment/catalogue", expect.any(Object));
  const [, options] = mockFetch.mock.calls[0];
  expect(options.method).toBe("GET");
  expect(options.body).toBeUndefined();
  expect(options.headers.Authorization).toBe("Bearer test-id-token");

  mockGetDoc.mockResolvedValue(snapshot({ role: "EVENT_COORDINATOR" }));
  mockFetch.mockClear();
  await expect(loadEquipmentCatalogue()).rejects.toThrow("Only Technical Support Staff can view the equipment catalogue.");
  expect(mockFetch).not.toHaveBeenCalled();
});

// Technical Support see who coordinates each event in their queue. The request
// carries the coordinator who submitted it; their name comes from their profile,
// which firestore.rules lets any signed-in user read for an active coordinator.
// TC-389 in docs/test-cases.md.
test("TC-389 pending requests carry their coordinator's name, and a profile that cannot be read leaves it blank", async () => {
  const docs = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
  getDocs.mockImplementation((reference) => Promise.resolve(reference.path === "equipment_requests"
    ? docs([
      ["event-1", { event_id: "event-1", event_date: "2026-11-04", coordinator_id: "coord-1", status: "PENDING", lines: [] }],
      ["event-2", { event_id: "event-2", event_date: "2026-11-05", coordinator_id: "coord-1", status: "PENDING", lines: [] }],
      ["event-3", { event_id: "event-3", event_date: "2026-11-06", coordinator_id: "coord-gone", status: "PENDING", lines: [] }],
      ["event-4", { event_id: "event-4", event_date: "2026-11-07", status: "PENDING", lines: [] }]
    ])
    : docs([])));
  mockGetDoc.mockImplementation((reference) => {
    if (reference.path === "users/tech-1") return Promise.resolve(snapshot({ role: "TECHNICAL_SUPPORT_STAFF" }));
    if (reference.path === "users/coord-1") return Promise.resolve(snapshot({ role: "EVENT_COORDINATOR", name: "Sam Tan", is_active: true }));
    return Promise.reject(new Error("Missing or insufficient permissions."));
  });

  const requests = await listPendingEquipmentRequests();

  expect(requests.map((request) => [request.event_id, request.coordinator_name])).toEqual([
    ["event-1", "Sam Tan"], ["event-2", "Sam Tan"], ["event-3", null], ["event-4", null]
  ]);
  // One profile read per coordinator, however many events they hold.
  expect(mockGetDoc.mock.calls.map(([reference]) => reference.path).filter((path) => path !== "users/tech-1"))
    .toEqual(["users/coord-1", "users/coord-gone"]);
});
