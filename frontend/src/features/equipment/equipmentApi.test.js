// G1 / G2 / G3 — the Firestore reads and the transaction behind the coordinator's
// equipment request and Technical Support's availability check. The service calls
// (reserve, release, amend, notify) are in equipmentApi.browser.test.js; this file
// covers the reads, the save transaction and who each action refuses.

const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockRunTransaction = jest.fn();
const mockFetch = jest.fn();

jest.mock("firebase/firestore", () => ({
  collection: (_database, name) => ({ path: name }),
  doc: (_database, collectionName, id) => ({ path: `${collectionName}/${id}`, id }),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  query: (reference, ...filters) => ({ path: reference.path, filters }),
  runTransaction: (...args) => mockRunTransaction(...args),
  serverTimestamp: () => "SERVER_NOW",
  where: (field, operator, value) => ({ field, operator, value })
}));

jest.mock("../../lib/firebase", () => ({
  auth: { currentUser: null },
  db: { name: "test-firestore" }
}));

import { auth } from "../../lib/firebase";
import {
  amendEquipmentRequestLine,
  callEquipmentService,
  checkEquipmentAvailability,
  listCoordinatorEquipmentEvents,
  listPendingEquipmentRequests,
  loadCoordinatorEquipmentEditor,
  loadEquipmentCatalogue,
  markEquipmentLineUnableToFulfill,
  releaseCancelledEventReservations,
  releaseEquipmentReservation,
  reserveEquipmentForEvent,
  submitEquipmentRequest
} from "./equipmentApi";

const user = { uid: "user-1", getIdToken: jest.fn().mockResolvedValue("token-1") };
const found = (id, data) => ({ id, exists: () => true, data: () => data });
const missing = (id) => ({ id, exists: () => false, data: () => undefined });

// A tiny in-memory Firestore: documents by path, and collections whose rows a
// query filters by its equality clauses.
let documents;
let collections;
const setRole = (role) => { documents["users/user-1"] = { role }; };
const rows = (name, filters = []) => (collections[name] || [])
  .filter(([, data]) => filters.every(({ field, value }) => data[field] === value))
  .map(([id, data]) => ({ id, data: () => data }));

beforeEach(() => {
  jest.clearAllMocks();
  auth.currentUser = user;
  documents = {};
  collections = {};
  global.fetch = mockFetch;
  mockGetDoc.mockImplementation(async (reference) => (
    documents[reference.path] === undefined ? missing(reference.id) : found(reference.id, documents[reference.path])
  ));
  mockGetDocs.mockImplementation(async (reference) => ({ docs: rows(reference.path, reference.filters) }));
});

const lines = [{ equipment_type: "AUDIO", quantity: "2", technical_requirements: " Wireless " }];

describe("G1 the coordinator's equipment events", () => {
  describe("normal", () => {
    test("TC-1157 the coordinator's open events come date order, each with its request and support history", async () => {
      setRole("EVENT_COORDINATOR");
      collections.events = [
        ["e-late", { coordinator_id: "user-1", status: "PLANNING", event_date: "2026-12-01", name: "Late" }],
        ["e-early", { coordinator_id: "user-1", status: "APPROVED", event_date: "2026-11-01", name: "Early" }],
        ["e-done", { coordinator_id: "user-1", status: "COMPLETED", event_date: "2026-10-01" }],
        ["e-other", { coordinator_id: "someone-else", status: "PLANNING", event_date: "2026-11-15" }]
      ];
      documents["equipment_requests/e-early"] = { status: "PENDING", lines: [] };
      collections.equipment_request_history = [
        ["h1", { event_id: "e-early", note: "Asked for spares" }],
        ["h2", { event_id: "e-late", note: "Not this request" }]
      ];

      const events = await listCoordinatorEquipmentEvents();

      expect(events.map((event) => event.id)).toEqual(["e-early", "e-late"]);
      expect(events[0].equipment_request).toEqual({
        id: "e-early", status: "PENDING", lines: [], support_history: [{ id: "h1", event_id: "e-early", note: "Asked for spares" }]
      });
      expect(events[1].equipment_request).toBeNull();
    });
  });

  describe("boundary", () => {
    test("TC-1158 an event without a date sorts first, and a coordinator with no events gets an empty list", async () => {
      setRole("EVENT_COORDINATOR");
      expect(await listCoordinatorEquipmentEvents()).toEqual([]);
      collections.events = [
        ["e-dated", { coordinator_id: "user-1", status: "PLANNING", event_date: "2026-11-01" }],
        ["e-undated", { coordinator_id: "user-1", status: "PLANNING" }],
        ["e-dated-2", { coordinator_id: "user-1", status: "PLANNING", event_date: "2026-10-31" }],
        ["e-undated-2", { coordinator_id: "user-1", status: "PLANNING" }]
      ];
      expect((await listCoordinatorEquipmentEvents()).map((event) => event.id)).toEqual(["e-undated", "e-undated-2", "e-dated-2", "e-dated"]);
    });
  });

  describe("failure", () => {
    test("TC-1159 a signed-out user, a missing profile and a non-coordinator are each refused", async () => {
      auth.currentUser = null;
      await expect(listCoordinatorEquipmentEvents()).rejects.toThrow("Please sign in again.");
      auth.currentUser = user;
      await expect(listCoordinatorEquipmentEvents()).rejects.toThrow("Your user profile could not be found.");
      setRole("TECHNICAL_SUPPORT_STAFF");
      await expect(listCoordinatorEquipmentEvents()).rejects.toThrow("Only an Event Coordinator can manage equipment requests.");
      expect(mockGetDocs).not.toHaveBeenCalled();
    });
  });
});

describe("G1 loading the equipment request editor", () => {
  beforeEach(() => setRole("EVENT_COORDINATOR"));

  test("TC-1160 [normal] a saved request opens with its own lines", async () => {
    documents["events/e1"] = { coordinator_id: "user-1", status: "PLANNING" };
    documents["equipment_requests/e1"] = { status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 2, technical_requirements: "Mics" }] };
    await expect(loadCoordinatorEquipmentEditor("e1")).resolves.toEqual({
      event: { id: "e1", coordinator_id: "user-1", status: "PLANNING" },
      request: { id: "e1", status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 2, technical_requirements: "Mics" }] },
      lines: [{ equipment_type: "AUDIO", quantity: "2", technical_requirements: "Mics" }]
    });
  });

  test("TC-1161 [normal] with no saved request the editor starts from what the organiser asked for", async () => {
    documents["events/e1"] = { coordinator_id: "user-1", status: "APPROVED" };
    collections.event_equipment = [
      ["x1", { event_id: "e1", equipment_type: "VISUAL", quantity: 1, technical_note: "Projector" }],
      ["x2", { event_id: "e2", equipment_type: "AUDIO", quantity: 9 }]
    ];
    await expect(loadCoordinatorEquipmentEditor("e1")).resolves.toMatchObject({
      request: null,
      lines: [{ equipment_type: "VISUAL", quantity: "1", technical_requirements: "Projector" }]
    });
  });

  test("TC-1162 [boundary] an event whose organiser asked for no equipment opens with no lines", async () => {
    documents["events/e1"] = { coordinator_id: "user-1", status: "APPROVED" };
    await expect(loadCoordinatorEquipmentEditor("e1")).resolves.toMatchObject({ request: null, lines: [] });
  });

  test("TC-1163 [conflict] another coordinator's event, or a closed one, cannot be edited", async () => {
    documents["events/e1"] = { coordinator_id: "someone-else", status: "PLANNING" };
    await expect(loadCoordinatorEquipmentEditor("e1")).rejects.toThrow("Only the assigned Event Coordinator can edit this request.");
    for (const status of ["COMPLETED", "CANCELLED", "REJECTED"]) {
      documents["events/e1"] = { coordinator_id: "user-1", status };
      await expect(loadCoordinatorEquipmentEditor("e1"))
        .rejects.toThrow("Equipment requests cannot be changed for a completed, cancelled or rejected event.");
    }
  });

  test("TC-1164 [failure] no event chosen, a missing event, or a non-coordinator is refused", async () => {
    await expect(loadCoordinatorEquipmentEditor("")).rejects.toThrow("Choose an event before editing its equipment request.");
    await expect(loadCoordinatorEquipmentEditor("e404")).rejects.toThrow("Event not found.");
    setRole("VENUE_STAFF");
    await expect(loadCoordinatorEquipmentEditor("e1")).rejects.toThrow("Only an Event Coordinator can manage equipment requests.");
  });
});

describe("G1 saving the equipment request", () => {
  // One transaction: reads the event and any saved request, then writes the request.
  const transactionWith = ({ event, existing } = {}) => {
    const writes = [];
    mockRunTransaction.mockImplementation(async (_database, callback) => callback({
      get: async (reference) => {
        if (reference.path === "events/e1") return event ? found("e1", event) : missing("e1");
        return existing ? found("e1", existing) : missing("e1");
      },
      set: (reference, data) => writes.push([reference.path, data])
    }));
    return writes;
  };

  beforeEach(() => {
    setRole("EVENT_COORDINATOR");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  test("TC-1165 [normal] a first save records the event's details, the cleaned lines and the time", async () => {
    const writes = transactionWith({ event: {
      coordinator_id: "user-1", status: "PLANNING", name: "Summit", reference_no: "EVT-1",
      event_date: "2026-11-20", start_time: "09:00", end_time: "17:00", expected_attendance: 80
    } });
    await expect(submitEquipmentRequest({ eventId: "e1", lines })).resolves.toEqual({ ok: true, status: "PENDING", notified: true, rerequested: true });
    expect(writes).toEqual([["equipment_requests/e1", {
      request_id: "e1", event_id: "e1", coordinator_id: "user-1", event_name: "Summit", reference_no: "EVT-1",
      event_date: "2026-11-20", start_time: "09:00", end_time: "17:00", expected_attendance: 80,
      lines: [{ equipment_type: "AUDIO", quantity: 2, technical_requirements: "Wireless" }],
      on_site_support: false, on_site_support_details: "", status: "PENDING",
      submitted_at: "SERVER_NOW", updated_at: "SERVER_NOW", created_at: "SERVER_NOW"
    }]]);
  });

  test("TC-1166 [boundary] an event with no details recorded saves with placeholders, and an amendment keeps its first times", async () => {
    const bare = transactionWith({ event: { coordinator_id: "user-1", status: "APPROVED" } });
    await submitEquipmentRequest({ eventId: "e1", lines });
    expect(bare[0][1]).toMatchObject({
      event_name: "Untitled event", reference_no: "e1", event_date: null, start_time: null, end_time: null, expected_attendance: null
    });

    const amended = transactionWith({
      event: { coordinator_id: "user-1", status: "APPROVED", expected_attendance: 0 },
      existing: { status: "PENDING", submitted_at: "FIRST", created_at: "CREATED" }
    });
    await submitEquipmentRequest({ eventId: "e1", lines });
    expect(amended[0][1]).toMatchObject({ expected_attendance: 0, submitted_at: "FIRST", created_at: "CREATED", updated_at: "SERVER_NOW" });

    const noSubmitTime = transactionWith({
      event: { coordinator_id: "user-1", status: "APPROVED" },
      existing: { status: "PENDING", has_support_decisions: false, created_at: "CREATED" }
    });
    await submitEquipmentRequest({ eventId: "e1", lines });
    expect(noSubmitTime[0][1]).toMatchObject({ submitted_at: "SERVER_NOW", created_at: "CREATED" });
  });

  test("TC-1167 [conflict] a request Technical Support have started on cannot be amended", async () => {
    const event = { coordinator_id: "user-1", status: "PLANNING" };
    for (const existing of [{ status: "ARRANGED" }, { status: "PENDING", has_support_decisions: true }]) {
      const writes = transactionWith({ event, existing });
      await expect(submitEquipmentRequest({ eventId: "e1", lines }))
        .rejects.toThrow("This equipment request is already being handled by Technical Support and cannot be amended.");
      expect(writes).toEqual([]);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("TC-1168 [conflict] a closed event takes no equipment request", async () => {
    for (const status of ["COMPLETED", "CANCELLED", "REJECTED"]) {
      transactionWith({ event: { coordinator_id: "user-1", status } });
      await expect(submitEquipmentRequest({ eventId: "e1", lines }))
        .rejects.toThrow("Equipment requests cannot be submitted for a completed, cancelled or rejected event.");
    }
  });

  test("TC-1169 [failure] no event, no lines, a bad quantity, a missing event or a non-coordinator is refused", async () => {
    await expect(submitEquipmentRequest({ eventId: "", lines })).rejects.toThrow("Choose an event before submitting an equipment request.");
    await expect(submitEquipmentRequest({ eventId: "e1", lines: [] })).rejects.toThrow("Add at least one equipment line before submitting.");
    await expect(submitEquipmentRequest({ eventId: "e1", lines: [{ equipment_type: "AUDIO", quantity: "0" }] }))
      .rejects.toThrow("Quantity for line 1 must be a whole number greater than zero.");
    await expect(submitEquipmentRequest({ eventId: "e1", lines: [{ equipment_type: "LASERS", quantity: "1" }] }))
      .rejects.toThrow("Choose an equipment type for line 1.");
    expect(mockRunTransaction).not.toHaveBeenCalled();
    transactionWith({});
    await expect(submitEquipmentRequest({ eventId: "e1", lines })).rejects.toThrow("Event not found.");
    setRole("TECHNICAL_SUPPORT_STAFF");
    await expect(submitEquipmentRequest({ eventId: "e1", lines })).rejects.toThrow("Only an Event Coordinator can submit an equipment request.");
  });
});

describe("G3 Technical Support's pending queue", () => {
  test("TC-1258 [boundary] a coordinator is named by name, else email, else left blank; undated requests sort first", async () => {
    setRole("TECHNICAL_SUPPORT_STAFF");
    collections.equipment_requests = [
      ["r1", { event_id: "e1", status: "PENDING", event_date: "2026-11-02", coordinator_id: "c-email" }],
      ["r2", { event_id: "e2", status: "PENDING", coordinator_id: "c-none" }],
      ["r3", { event_id: "e3", status: "ARRANGED", coordinator_id: "c-email" }],
      ["r4", { event_id: "e4", status: "PENDING", event_date: "2026-11-01", coordinator_id: "c-blank" }]
    ];
    collections.equipment_reservations = [["res-1", { event_id: "e1", quantity: 2 }]];
    documents["users/c-email"] = { email: "c@example.com" };
    documents["users/c-blank"] = {};

    const queue = await listPendingEquipmentRequests();

    expect(queue.map((item) => [item.id, item.coordinator_name])).toEqual([["r2", null], ["r4", null], ["r1", "c@example.com"]]);
    expect(queue[2].reservations).toEqual([{ id: "res-1", event_id: "e1", quantity: 2 }]);
  });

  test("TC-1259 [failure] only Technical Support may see the queue", async () => {
    setRole("EVENT_COORDINATOR");
    await expect(listPendingEquipmentRequests()).rejects.toThrow("Only Technical Support Staff can view the equipment queue.");
  });
});

describe("G2 checking equipment availability", () => {
  const window = { windowStart: "2026-11-04T09:00:00+08:00", windowEnd: "2026-11-04T17:00:00+08:00" };
  beforeEach(() => {
    setRole("TECHNICAL_SUPPORT_STAFF");
    documents["equipment_inventory/AUDIO"] = { total_quantity: 10 };
  });

  test("TC-1223 [normal] the free count is held stock less overlapping reservations and unavailable units", async () => {
    collections.equipment_reservations = [
      ["a", { equipment_type: "AUDIO", status: "RESERVED", quantity: 4, start_datetime: "2026-11-04T08:00:00+08:00", end_datetime: "2026-11-04T12:00:00+08:00" }]
    ];
    collections.equipment_unavailability = [
      ["u", { equipment_type: "AUDIO", quantity: 1, start_datetime: "2026-11-04T10:00:00+08:00", end_datetime: "2026-11-04T11:00:00+08:00" }]
    ];
    await expect(checkEquipmentAvailability({ equipmentType: "AUDIO", ...window, requestedQuantity: 5 })).resolves.toMatchObject({
      heldQuantity: 10, reservedQuantity: 4, unavailableQuantity: 1, freeQuantity: 5, shortfall: 0, available: true
    });
  });

  test("TC-1224 [normal] for a chosen event the window comes from its approved venue bookings, and its own reservation is not counted", async () => {
    collections.venue_bookings = [
      ["b1", { event_id: "e1", status: "APPROVED", occupied_start: "2026-11-04T08:00:00+08:00", occupied_end: "2026-11-04T18:00:00+08:00" }],
      ["b2", { event_id: "e1", status: "PENDING", occupied_start: "2026-11-03T08:00:00+08:00", occupied_end: "2026-11-05T18:00:00+08:00" }]
    ];
    collections.equipment_reservations = [
      ["own", { equipment_type: "AUDIO", event_id: "e1", status: "RESERVED", quantity: 6, start_datetime: "2026-11-04T08:00:00+08:00", end_datetime: "2026-11-04T18:00:00+08:00" }],
      ["other", { equipment_type: "AUDIO", event_id: "e2", status: "RESERVED", quantity: 3, start_datetime: "2026-11-04T17:30:00+08:00", end_datetime: "2026-11-04T19:00:00+08:00" }]
    ];
    await expect(checkEquipmentAvailability({ equipmentType: "AUDIO", requestedQuantity: 8, eventId: "e1" })).resolves.toMatchObject({
      reservedQuantity: 3, freeQuantity: 7, shortfall: 1, available: false
    });
  });

  test("TC-1225 [conflict] asking for more than is free states the shortfall as a number", async () => {
    collections.equipment_reservations = [
      ["a", { equipment_type: "AUDIO", status: "RESERVED", quantity: 10, start_datetime: window.windowStart, end_datetime: window.windowEnd }]
    ];
    await expect(checkEquipmentAvailability({ equipmentType: "AUDIO", ...window, requestedQuantity: 2 }))
      .resolves.toMatchObject({ freeQuantity: 0, shortfall: 2, available: false });
  });

  test("TC-1226 [failure] an unsupported type, missing stock, an event with no approved booking, or the wrong role is refused", async () => {
    await expect(checkEquipmentAvailability({ equipmentType: "LASERS", ...window, requestedQuantity: 1 }))
      .rejects.toThrow("Choose a supported equipment type.");
    await expect(checkEquipmentAvailability({ equipmentType: "OTHERS", ...window, requestedQuantity: 1 }))
      .rejects.toThrow("No held inventory is recorded for OTHERS.");
    await expect(checkEquipmentAvailability({ equipmentType: "AUDIO", requestedQuantity: 1, eventId: "e-nobooking" }))
      .rejects.toThrow(/approved venue booking is required/);
    setRole("EVENT_COORDINATOR");
    await expect(checkEquipmentAvailability({ equipmentType: "AUDIO", ...window, requestedQuantity: 1 }))
      .rejects.toThrow("Only Technical Support Staff can check equipment availability.");
  });
});

describe("equipment service actions", () => {
  test("TC-1170 [failure] each Technical Support action refuses a coordinator before calling the service", async () => {
    setRole("EVENT_COORDINATOR");
    await expect(reserveEquipmentForEvent({ eventId: "e1", equipmentType: "AUDIO", quantity: 1 }))
      .rejects.toThrow("Only Technical Support Staff can reserve equipment.");
    await expect(amendEquipmentRequestLine({ eventId: "e1", lineIndex: 0 }))
      .rejects.toThrow("Only Technical Support Staff can amend equipment requests.");
    await expect(markEquipmentLineUnableToFulfill({ eventId: "e1", lineIndex: 0, reason: "x" }))
      .rejects.toThrow("Only Technical Support Staff can resolve equipment requests.");
    await expect(releaseEquipmentReservation({ reservationId: "r1" }))
      .rejects.toThrow("Only Technical Support Staff can release equipment reservations.");
    await expect(loadEquipmentCatalogue()).rejects.toThrow("Only Technical Support Staff can view the equipment catalogue.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("TC-1171 [failure] releasing a cancelled event's equipment is the coordinator's, and Technical Support are refused", async () => {
    setRole("TECHNICAL_SUPPORT_STAFF");
    await expect(releaseCancelledEventReservations({ eventId: "e1", reason: "Cancelled" }))
      .rejects.toThrow("Only an Event Coordinator can release equipment for a cancelled event.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("TC-1172 [failure] an unsupported type or no reservation chosen is refused before any call", async () => {
    setRole("TECHNICAL_SUPPORT_STAFF");
    await expect(reserveEquipmentForEvent({ eventId: "e1", equipmentType: "LASERS", quantity: 1 }))
      .rejects.toThrow("Choose a supported equipment type.");
    await expect(releaseEquipmentReservation({ reservationId: "" })).rejects.toThrow("Choose an equipment reservation to release.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("TC-1173 [boundary] a release sends the reason given, and ids are escaped in the path", async () => {
    setRole("TECHNICAL_SUPPORT_STAFF");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: "RELEASED" }) });
    await releaseEquipmentReservation({ reservationId: "r/1", reason: "Event moved" });
    expect(mockFetch).toHaveBeenCalledWith("/api/equipment/reservations/r%2F1/release", expect.objectContaining({
      body: JSON.stringify({ reason: "Event moved" })
    }));
  });

  test("TC-1174 [failure] a refusal with an empty body falls back to the caller's message", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => null });
    await expect(callEquipmentService(user, "/api/x", "POST", {}, "Fallback message.")).rejects.toThrow("Fallback message.");
  });
});
