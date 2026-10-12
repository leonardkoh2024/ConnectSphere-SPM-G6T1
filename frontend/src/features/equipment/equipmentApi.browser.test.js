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

import {
  amendEquipmentRequestLine,
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
