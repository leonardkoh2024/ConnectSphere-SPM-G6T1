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

import { getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth } from "../../lib/firebase";
import {
  amendEquipmentRequestLine,
  amendEquipmentReservation,
  keepEquipmentReservation,
  listPendingEquipmentRequests,
  loadEquipmentCatalogue,
  markEquipmentLineUnableToFulfill,
  recheckEquipmentReassessment,
  releaseEquipmentReservation,
  releaseCancelledEventReservations,
  reserveEquipmentForEvent,
  submitEquipmentRequest
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

test("D4 cancellation releases equipment through the coordinator-authenticated service", async () => {
  mockGetDoc.mockResolvedValue(snapshot({ role: "EVENT_COORDINATOR" }));
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ released: 2 }) });

  await expect(releaseCancelledEventReservations({
    eventId: "event-1",
    reason: "Speaker unavailable"
  })).resolves.toEqual({ released: 2 });

  expect(mockFetch).toHaveBeenCalledWith(
    "/api/equipment/events/event-1/cancel-reservations",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ reason: "Speaker unavailable" })
    })
  );
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
// unreachable instead of showing the JSON parse error. TC-402 in
// docs/test-cases.md.
test.each([
  ["reserving", () => reserveEquipmentForEvent({ eventId: "event-1", equipmentType: "AUDIO", quantity: 1 })],
  ["releasing", () => releaseEquipmentReservation({ reservationId: "reservation-1" })],
  ["amending", () => amendEquipmentRequestLine({ eventId: "event-1", lineIndex: 0, equipmentType: "AUDIO", quantity: 1, note: "x" })],
  ["marking unable to fulfil", () => markEquipmentLineUnableToFulfill({ eventId: "event-1", lineIndex: 0, reason: "x" })]
])("TC-402 %s reports an unreachable equipment service rather than a JSON error", async (_name, run) => {
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
// TC-407 in docs/test-cases.md.
test("TC-407 the catalogue is read from the equipment service with the caller's token, and carries the caller's id", async () => {
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

test("TC-407 a refused catalogue read shows the service's reason, a fallback without one, and an unreachable service plainly", async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Only Technical Support Staff can manage equipment reservations." }) });
  await expect(loadEquipmentCatalogue()).rejects.toThrow("Only Technical Support Staff can manage equipment reservations.");

  mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  await expect(loadEquipmentCatalogue()).rejects.toThrow("The equipment catalogue could not be loaded.");

  mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(loadEquipmentCatalogue()).rejects.toThrow(/equipment service is not responding/);
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

// J5 / SCRUM-154 — what the coordinator's browser saves, and how it asks the equipment
// service to tell Technical Support. The request is saved here (G1, unchanged); the
// service compares it with what Technical Support were last told and speaks only if it
// differs, so a failed ask never loses the request and a repeated ask never repeats.
describe("J5 SCRUM-154 saving an equipment request and telling Technical Support", () => {
  const submitted = {
    eventId: "event-1",
    lines: [{ equipment_type: "AUDIO", quantity: "2", technical_requirements: "Wireless" }]
  };

  const asCoordinator = ({ event = { coordinator_id: "tech-1", name: "Partner Summit", reference_no: "EVT-001", status: "APPROVED" } } = {}) => {
    const writes = [];
    mockGetDoc.mockResolvedValue(snapshot({ role: "EVENT_COORDINATOR" }));
    serverTimestamp.mockReturnValue("now");
    runTransaction.mockImplementation(async (_database, callback) => callback({
      get: async (reference) => reference.path === "events/event-1"
        ? { exists: () => true, data: () => event }
        : { exists: () => false, data: () => undefined },
      set: (reference, data) => writes.push([reference.path, data])
    }));
    return writes;
  };

  test("J5-TC22 AC2 the request records that on-site support is needed, with its details trimmed", async () => {
    const writes = asCoordinator();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sent: 2 }) });
    await submitEquipmentRequest({ ...submitted, onSiteSupport: true, onSiteSupportDetails: "  Two technicians for setup  " });

    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("equipment_requests/event-1");
    expect(writes[0][1]).toMatchObject({ on_site_support: true, on_site_support_details: "Two technicians for setup" });
  });

  test("J5-TC23 AC2 a request that does not need on-site support stores false and no details, even if some were typed", async () => {
    const writes = asCoordinator();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sent: 2 }) });
    await submitEquipmentRequest({ ...submitted, onSiteSupport: false, onSiteSupportDetails: "typed, then unticked" });
    expect(writes[0][1]).toMatchObject({ on_site_support: false, on_site_support_details: "" });

    writes.length = 0;
    await submitEquipmentRequest(submitted);
    expect(writes[0][1]).toMatchObject({ on_site_support: false, on_site_support_details: "" });
  });

  test("J5-TC24 AC1 AC3 once saved, the browser asks the equipment service to tell Technical Support", async () => {
    asCoordinator();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ eventId: "event-1", sent: 2 }) });

    await expect(submitEquipmentRequest(submitted)).resolves.toEqual({ ok: true, status: "PENDING", notified: true, rerequested: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/equipment/requests/event-1/notify-technical-support", expect.any(Object));
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toMatch(/^Bearer /);
    // Asked after the save, never before: the service reads the saved request.
    expect(runTransaction.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[0]);
  });

  test("J5-TC25 AC1 when the service cannot be reached the request stays saved, and the coordinator is told it was not announced", async () => {
    const writes = asCoordinator();
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(submitEquipmentRequest(submitted)).resolves.toEqual({ ok: true, status: "PENDING", notified: false, rerequested: false });
    expect(writes).toHaveLength(1);

    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Only the event's coordinator can do this." }) });
    await expect(submitEquipmentRequest(submitted)).resolves.toEqual({ ok: true, status: "PENDING", notified: false, rerequested: false });
  });

  test("J5-TC26 AC2 on-site support without details is refused before anything is saved or announced", async () => {
    const writes = asCoordinator();
    for (const onSiteSupportDetails of ["", "   ", undefined]) {
      await expect(submitEquipmentRequest({ ...submitted, onSiteSupport: true, onSiteSupportDetails }))
        .rejects.toThrow("Describe the on-site support needed.");
    }
    expect(runTransaction).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("J5-TC27 AC1 a request that could not be saved is never announced", async () => {
    asCoordinator({ event: { coordinator_id: "someone-else", status: "APPROVED" } });
    await expect(submitEquipmentRequest(submitted)).rejects.toThrow(/only the assigned event coordinator/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // I3 SCRUM-149 — a saved equipment request is also a change to the event's equipment
  // arrangements, so the browser asks the arrangements service to re-request after it.
  const rerequestCalls = () => mockFetch.mock.calls.filter(([path]) => path === "/api/events/event-1/rerequest-arrangements");

  test("I3-TC95 AC1 AC2 once the request is saved and Technical Support told, the arrangements service is asked to re-request", async () => {
    asCoordinator();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ applied: true, status: "PLANNING" }) });

    await submitEquipmentRequest(submitted);

    expect(rerequestCalls()).toHaveLength(1);
    const [, options] = rerequestCalls()[0];
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(options.body)).toEqual({ source: "EQUIPMENT" });
    expect(runTransaction.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[1]);
    expect(mockFetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/equipment/requests/event-1/notify-technical-support",
      "/api/events/event-1/rerequest-arrangements"
    ]);
  });

  test("I3-TC96 AC1 when only the re-request fails the request stays saved, Technical Support is still told, and the result says it was not re-requested", async () => {
    const writes = asCoordinator();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sent: 2 }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Only the event's coordinator can do this." }) });

    await expect(submitEquipmentRequest(submitted)).resolves.toEqual({ ok: true, status: "PENDING", notified: true, rerequested: false });
    expect(writes).toHaveLength(1);
  });

  test("I3-TC97 AC1 a failed Technical Support notice does not stop the re-request being asked for", async () => {
    asCoordinator();
    mockFetch
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ applied: false }) });

    await expect(submitEquipmentRequest(submitted)).resolves.toEqual({ ok: true, status: "PENDING", notified: false, rerequested: true });
    expect(rerequestCalls()).toHaveLength(1);
  });

  test("I3-TC98 a request that could not be saved asks for no re-request", async () => {
    asCoordinator({ event: { coordinator_id: "someone-else", status: "APPROVED" } });
    await expect(submitEquipmentRequest(submitted)).rejects.toThrow(/only the assigned event coordinator/i);
    expect(rerequestCalls()).toHaveLength(0);
  });
});

// G6 / SCRUM-138 AC3 — the browser side of reassessing a flagged reservation. Re-checking, keeping
// and amending go through the equipment service; releasing is the existing release (TC-305).
describe("G6 SCRUM-138 reassessing a flagged reservation", () => {
  test("G6-TC21 AC3 re-checking asks the service about the event's new window with the caller's token", async () => {
    const body = { windowStart: "2026-11-12T00:30:00.000Z", windowEnd: "2026-11-12T10:00:00.000Z", lines: [] };
    mockFetch.mockResolvedValue({ ok: true, json: async () => body });

    await expect(recheckEquipmentReassessment({ eventId: "event-1" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/equipment/events/event-1/recheck-availability", expect.any(Object));
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toMatch(/^Bearer /);
  });

  test("G6-TC22 AC3 keeping and amending send the reservation, the note and the new quantity", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ reservationId: "res/1", status: "RESERVED" }) });

    await keepEquipmentReservation({ reservationId: "res/1", note: "Still fits" });
    expect(mockFetch).toHaveBeenLastCalledWith("/api/equipment/reservations/res%2F1/keep", expect.any(Object));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ note: "Still fits" });

    await amendEquipmentReservation({ reservationId: "res/1", quantity: 4, note: "Larger crowd" });
    expect(mockFetch).toHaveBeenLastCalledWith("/api/equipment/reservations/res%2F1/amend", expect.any(Object));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ quantity: 4, note: "Larger crowd" });
    mockFetch.mock.calls.forEach(([, options]) => expect(options.headers.Authorization).toMatch(/^Bearer /));
  });

  test("G6-TC23 AC3 only Technical Support Staff can reassess, and nothing is sent for anyone else or without a choice", async () => {
    mockGetDoc.mockResolvedValue(snapshot({ role: "EVENT_COORDINATOR" }));
    await expect(recheckEquipmentReassessment({ eventId: "event-1" })).rejects.toThrow("Only Technical Support Staff can reassess equipment reservations.");
    await expect(keepEquipmentReservation({ reservationId: "res-1" })).rejects.toThrow("Only Technical Support Staff can reassess equipment reservations.");
    await expect(amendEquipmentReservation({ reservationId: "res-1", quantity: 2, note: "x" })).rejects.toThrow("Only Technical Support Staff can reassess equipment reservations.");

    mockGetDoc.mockResolvedValue(snapshot({ role: "TECHNICAL_SUPPORT_STAFF" }));
    await expect(recheckEquipmentReassessment({ eventId: "" })).rejects.toThrow("Choose an event to re-check.");
    await expect(keepEquipmentReservation({ reservationId: "" })).rejects.toThrow("Choose an equipment reservation to keep.");
    await expect(amendEquipmentReservation({ reservationId: "" , quantity: 2, note: "x" })).rejects.toThrow("Choose an equipment reservation to amend.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("G6-TC24 AC3 a refusal shows the service's reason, a fallback without one, and an unreachable service plainly", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Requested quantity unavailable for the required time period: 1 free, 1 more needed." }) });
    await expect(keepEquipmentReservation({ reservationId: "res-1" })).rejects.toThrow(/1 free, 1 more needed/);

    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(recheckEquipmentReassessment({ eventId: "event-1" })).rejects.toThrow("The availability could not be re-checked.");
    await expect(keepEquipmentReservation({ reservationId: "res-1" })).rejects.toThrow("The reservation could not be kept.");
    await expect(amendEquipmentReservation({ reservationId: "res-1", quantity: 2, note: "x" })).rejects.toThrow("The reservation could not be amended.");

    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(keepEquipmentReservation({ reservationId: "res-1" })).rejects.toThrow(/equipment service is not responding/);
  });
});
