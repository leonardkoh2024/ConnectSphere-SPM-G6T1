import { approveVenueBooking, loadVenueBookingQueue, loadVenueBookings, prepareClashReplacement, releaseVenueBooking, requestVenueBooking } from "./venuesApi";

const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockTransactionGet = jest.fn();
const mockDocuments = new Map();

jest.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ path: name }),
  doc: (...args) => args.length === 1
    ? { path: `${args[0].path}/auto`, id: "auto" }
    : { path: `${args[1]}/${args[2]}`, id: args[2] },
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  query: (reference, ...constraints) => ({ ...reference, constraints }),
  runTransaction: async (_db, operation) => operation({
    get: (...args) => mockTransactionGet(...args),
    set: mockSet,
    update: mockUpdate
  }),
  serverTimestamp: () => "STAMP",
  updateDoc: jest.fn(),
  where: (...parts) => parts
}));
jest.mock("../../lib/firebase", () => ({ db: {} }));

const snap = (id, data, collectionName) => ({
  id, ref: { id, path: `${collectionName}/${id}` }, exists: () => true, data: () => data
});

beforeEach(() => {
  mockGetDoc.mockReset(); mockGetDocs.mockReset(); mockSet.mockClear(); mockUpdate.mockClear(); mockDocuments.clear();
  mockTransactionGet.mockReset().mockImplementation(async (reference) =>
    mockDocuments.get(reference.path) || { exists: () => false, data: () => undefined });
});

test("TC-1047 F11 replacement request copies booking-specific requirements and links the original", async () => {
  const event = { coordinator_id: "C1", status: "PLANNING", name: "Summit", event_date: "2026-12-02", start_time: "10:00", end_time: "12:00", expected_attendance: 200 };
  const venue = { name: "New Hall", max_capacity: 100, setup_minutes: 0, turnaround_minutes: 0 };
  const original = { event_id: "E1", venue_id: "OLD", status: "APPROVED", replacement_needed: true, booking_label: "Breakout", replacement_reason: "Maintenance" };
  mockDocuments.set("events/E1", snap("E1", event, "events"));
  mockDocuments.set("venues/NEW", snap("NEW", venue, "venues"));
  mockDocuments.set("venue_staff/NEW", snap("NEW", { user_id: "VS1" }, "venue_staff"));
  mockDocuments.set("venue_bookings/OLD-B", snap("OLD-B", original, "venue_bookings"));
  mockGetDocs.mockResolvedValueOnce({ docs: [snap("OLD-B", original, "venue_bookings")] }).mockResolvedValueOnce({ docs: [] });

  await requestVenueBooking({
    user: { uid: "C1" }, event_id: "E1", venue_id: "NEW", booking_label: "Breakout replacement",
    expected_attendance: 60, required_layout: "CLASSROOM", required_facilities: ["WIFI"],
    replacement_for_booking_id: "OLD-B", acknowledgement: { acknowledged: false, criteria: [] }
  });

  const written = mockSet.mock.calls.find(([reference]) => reference.path === "venue_bookings/auto")[1];
  expect(written).toMatchObject({
    status: "PENDING", replacement_for_booking_id: "OLD-B", replacement_original_venue_id: "OLD",
    expected_attendance: 60, layout_snapshot: "CLASSROOM", required_facilities_snapshot: ["WIFI"]
  });
});

test("TC-1048 F11 replacement request refuses the original unavailable venue", async () => {
  const event = { coordinator_id: "C1", status: "PLANNING", event_date: "2026-12-02", start_time: "10:00", end_time: "12:00", expected_attendance: 100 };
  const original = { event_id: "E1", venue_id: "OLD", status: "APPROVED", replacement_needed: true };
  mockDocuments.set("events/E1", snap("E1", event, "events"));
  mockDocuments.set("venues/OLD", snap("OLD", { max_capacity: 100 }, "venues"));
  mockDocuments.set("venue_staff/OLD", snap("OLD", {}, "venue_staff"));
  mockDocuments.set("venue_bookings/B1", snap("B1", original, "venue_bookings"));
  mockGetDocs.mockResolvedValueOnce({ docs: [snap("B1", original, "venue_bookings")] }).mockResolvedValueOnce({ docs: [] });
  await expect(requestVenueBooking({
    user: { uid: "C1" }, event_id: "E1", venue_id: "OLD", booking_label: "Replacement",
    expected_attendance: 50, required_layout: "THEATRE", required_facilities: [],
    replacement_for_booking_id: "B1", acknowledgement: { acknowledged: false, criteria: [] }
  })).rejects.toThrow("Choose a different venue");
});

test("TC-1049 F11 approving a linked replacement retires the original booking atomically", async () => {
  const original = {
    event_id: "E1", venue_id: "OLD", status: "APPROVED", replacement_needed: true,
    booking_label: "Original hall"
  };
  const replacement = {
    event_id: "E1", venue_id: "NEW", status: "PENDING", booking_label: "Replacement hall",
    replacement_for_booking_id: "OLD-B", replacement_original_venue_id: "OLD",
    replacement_original_label: "Original hall", replacement_reason: "Schedule clash",
    start_datetime: "2099-06-10T09:00:00Z", end_datetime: "2099-06-10T11:00:00Z",
    requested_by: "C1"
  };
  const replacementSnap = snap("NEW-B", replacement, "venue_bookings");
  const assignmentSnap = snap("NEW", { venue_id: "NEW", user_id: "VS1" }, "venue_staff");
  mockGetDoc.mockResolvedValue(replacementSnap);
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === "venue_staff") return Promise.resolve({ docs: [assignmentSnap] });
    if (reference.path === "venue_bookings") return Promise.resolve({ docs: [replacementSnap] });
    return Promise.resolve({ docs: [] });
  });
  mockDocuments.set("venue_bookings/NEW-B", replacementSnap);
  mockDocuments.set("venue_bookings/OLD-B", snap("OLD-B", original, "venue_bookings"));
  mockDocuments.set("venues/NEW", snap("NEW", { name: "New Hall", setup_minutes: 0, turnaround_minutes: 0 }, "venues"));
  mockDocuments.set("venue_staff/NEW", assignmentSnap);
  mockDocuments.set("events/E1", snap("E1", { coordinator_id: "C1", status: "PLANNING" }, "events"));

  await approveVenueBooking({ user: { uid: "VS1" }, bookingId: "NEW-B", now: new Date("2098-01-01T00:00:00Z") });

  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "venue_bookings/NEW-B" }), expect.objectContaining({ status: "APPROVED" }));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "venue_bookings/OLD-B" }), expect.objectContaining({
    status: "REPLACED", replacement_needed: false, requires_re_request: false, replaced_by_booking_id: "NEW-B"
  }));
  expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ path: "event_history/auto" }), expect.objectContaining({
    action_type: "VENUE_REPLACED", booking_id: "OLD-B", new_booking_id: "NEW-B"
  }));
});

test("TC-1050 F13 approving a replacement resolves the rejected room requirement", async () => {
  const original = {
    event_id: "E1", venue_id: "OLD", status: "REJECTED", requires_re_request: true,
    booking_label: "Workshop"
  };
  const replacement = {
    event_id: "E1", venue_id: "NEW", status: "PENDING", booking_label: "Workshop replacement",
    replacement_for_booking_id: "OLD-B", replacement_original_venue_id: "OLD",
    replacement_original_label: "Workshop", replacement_original_status: "REJECTED",
    start_datetime: "2099-06-10T09:00:00Z", end_datetime: "2099-06-10T11:00:00Z",
    requested_by: "C1"
  };
  const replacementSnap = snap("NEW-B", replacement, "venue_bookings");
  const assignmentSnap = snap("NEW", { venue_id: "NEW", user_id: "VS1" }, "venue_staff");
  mockGetDoc.mockResolvedValue(replacementSnap);
  mockGetDocs.mockImplementation((reference) => {
    if (reference.path === "venue_staff") return Promise.resolve({ docs: [assignmentSnap] });
    if (reference.path === "venue_bookings") return Promise.resolve({ docs: [replacementSnap] });
    return Promise.resolve({ docs: [] });
  });
  mockDocuments.set("venue_bookings/NEW-B", replacementSnap);
  mockDocuments.set("venue_bookings/OLD-B", snap("OLD-B", original, "venue_bookings"));
  mockDocuments.set("venues/NEW", snap("NEW", { setup_minutes: 0, turnaround_minutes: 0 }, "venues"));
  mockDocuments.set("venue_staff/NEW", assignmentSnap);
  mockDocuments.set("events/E1", snap("E1", { status: "PLANNING" }, "events"));

  await approveVenueBooking({ user: { uid: "VS1" }, bookingId: "NEW-B", now: new Date("2098-01-01T00:00:00Z") });

  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "venue_bookings/OLD-B" }), expect.objectContaining({
    status: "REPLACED", requires_re_request: false, replaced_by_booking_id: "NEW-B"
  }));
  expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ path: "event_history/auto" }), expect.objectContaining({
    action_type: "VENUE_REPLACED", old_value: "REJECTED", new_value: "REPLACED"
  }));
  expect(mockTransactionGet.mock.calls.map(([reference]) => reference.path)).not.toContain("venue_bookings/OLD-B");
});

test("TC-1091 F14 releases only the selected booking, keeps the other approved venue, and records the reason", async () => {
  const selected = { event_id: "E1", venue_id: "V1", status: "APPROVED", booking_label: "Main hall" };
  const other = { event_id: "E1", venue_id: "V2", status: "APPROVED", booking_label: "Breakout" };
  const selectedSnap = snap("B1", selected, "venue_bookings");
  const otherSnap = snap("B2", other, "venue_bookings");
  mockGetDoc.mockResolvedValue(selectedSnap);
  mockGetDocs.mockResolvedValue({ docs: [selectedSnap, otherSnap] });
  mockDocuments.set("events/E1", snap("E1", { coordinator_id: "C1", status: "PLANNING", approved_venue_booking_id: "B1" }, "events"));
  mockDocuments.set("venue_bookings/B1", selectedSnap);
  mockDocuments.set("venue_bookings/B2", otherSnap);

  await releaseVenueBooking({ user: { uid: "C1" }, bookingId: "B1", reason: "Room no longer needed" });

  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "venue_bookings/B1" }), expect.objectContaining({ status: "RELEASED", release_reason: "Room no longer needed" }));
  expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ path: "venue_bookings/B2" }), expect.anything());
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "events/E1" }), expect.objectContaining({ approved_venue_booking_id: "B2" }));
  expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ path: "event_history/auto" }), expect.objectContaining({ action_type: "VENUE_BOOKING_RELEASED", description: "Main hall: Room no longer needed" }));
});

test("TC-1092 F14 requires a non-empty release reason before any Firestore read", async () => {
  await expect(releaseVenueBooking({ user: { uid: "C1" }, bookingId: "B1", reason: "  " }))
    .rejects.toThrow("A release reason is required.");
  expect(mockGetDoc).not.toHaveBeenCalled();
});

test("TC-1093 F14 releasing during safety review returns the event to Planning and invalidates the safety decision", async () => {
  const selected = { event_id: "E1", venue_id: "V1", status: "APPROVED", booking_label: "Main hall" };
  const selectedSnap = snap("B1", selected, "venue_bookings");
  mockGetDoc.mockResolvedValue(selectedSnap);
  mockGetDocs.mockResolvedValue({ docs: [selectedSnap] });
  mockDocuments.set("events/E1", snap("E1", {
    coordinator_id: "C1", status: "SAFETY_REVIEW", approved_venue_booking_id: "B1", last_safety_review_id: "S1"
  }, "events"));
  mockDocuments.set("venue_bookings/B1", selectedSnap);

  await releaseVenueBooking({ user: { uid: "C1" }, bookingId: "B1", reason: "Resolve venue clash" });

  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "events/E1" }), expect.objectContaining({
    status: "PLANNING", approved_venue_booking_id: null, last_safety_review_id: null, safety_review_required: true
  }));
});

test("TC-1094 F14 refuses release after the event is completed", async () => {
  const selected = { event_id: "E1", venue_id: "V1", status: "APPROVED" };
  const selectedSnap = snap("B1", selected, "venue_bookings");
  mockGetDoc.mockResolvedValue(selectedSnap);
  mockGetDocs.mockResolvedValue({ docs: [selectedSnap] });
  mockDocuments.set("events/E1", snap("E1", { coordinator_id: "C1", status: "COMPLETED" }, "events"));
  mockDocuments.set("venue_bookings/B1", selectedSnap);

  await expect(releaseVenueBooking({ user: { uid: "C1" }, bookingId: "B1", reason: "Too late" }))
    .rejects.toThrow("can no longer be released");
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("TC-1027 F10 coordinator explicitly prepares only their approved booking for the F11 replacement flow", async () => {
  const original = { event_id: "E1", venue_id: "V1", status: "APPROVED", booking_label: "Main hall", occupied_start: "2099-06-10T09:00:00Z", occupied_end: "2099-06-10T11:00:00Z" };
  const conflicting = { event_id: "E2", venue_id: "V1", status: "APPROVED", booking_label: "Partner Briefing", occupied_start: "2099-06-10T10:30:00Z", occupied_end: "2099-06-10T12:00:00Z" };
  const originalSnap = snap("B1", original, "venue_bookings");
  const conflictingSnap = snap("B2", conflicting, "venue_bookings");
  mockGetDoc.mockResolvedValue(originalSnap);
  mockDocuments.set("events/E1", snap("E1", { coordinator_id: "C1", status: "CONFIRMED", approved_venue_booking_id: "B1", last_safety_review_id: "S1" }, "events"));
  mockDocuments.set("venue_bookings/B1", originalSnap);
  mockDocuments.set("venue_bookings/B2", conflictingSnap);

  const result = await prepareClashReplacement({
    user: { uid: "C1" }, bookingId: "B1",
    clash: { conflict_id: "V1--B1--B2", booking_a_id: "B1", booking_b_id: "B2", event_b_name: "Partner Briefing" }
  });

  expect(result).toMatchObject({ booking_id: "B1", replacement_needed: true, replacement_source: "CLASH" });
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "venue_bookings/B1" }), expect.objectContaining({
    replacement_needed: true,
    replacement_source: "CLASH",
    replacement_conflict_id: "V1--B1--B2",
    replacement_conflicting_booking_id: "B2"
  }));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "events/E1" }), expect.objectContaining({
    status: "PLANNING", approved_venue_booking_id: null, last_safety_review_id: null
  }));
  expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ path: "event_history/auto" }), expect.objectContaining({
    action_type: "VENUE_REPLACEMENT_REQUESTED", booking_id: "B1"
  }));
});

test("TC-1028 F10 refuses replacement preparation when the reported clash is no longer active", async () => {
  const original = { event_id: "E1", venue_id: "V1", status: "APPROVED", occupied_start: "2099-06-10T09:00:00Z", occupied_end: "2099-06-10T11:00:00Z" };
  const noLongerOverlapping = { event_id: "E2", venue_id: "V1", status: "APPROVED", occupied_start: "2099-06-10T11:00:00Z", occupied_end: "2099-06-10T12:00:00Z" };
  const originalSnap = snap("B1", original, "venue_bookings");
  mockGetDoc.mockResolvedValue(originalSnap);
  mockDocuments.set("events/E1", snap("E1", { coordinator_id: "C1", status: "PLANNING" }, "events"));
  mockDocuments.set("venue_bookings/B1", originalSnap);
  mockDocuments.set("venue_bookings/B2", snap("B2", noLongerOverlapping, "venue_bookings"));

  await expect(prepareClashReplacement({
    user: { uid: "C1" }, bookingId: "B1",
    clash: { conflict_id: "V1--B1--B2", booking_a_id: "B1", booking_b_id: "B2" }
  })).rejects.toThrow("no longer active");
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
});

test("TC-1029 F10 still derives live clashes when deployed rules deny the optional conflict collection", async () => {
  const assignment = snap("V1", { venue_id: "V1", user_id: "VS1" }, "venue_staff");
  const first = snap("B1", { venue_id: "V1", event_id: "E1", event_name: "Forum", status: "APPROVED", occupied_start: "2099-06-10T09:00:00Z", occupied_end: "2099-06-10T11:00:00Z" }, "venue_bookings");
  const second = snap("B2", { venue_id: "V1", event_id: "E2", event_name: "Briefing", status: "APPROVED", occupied_start: "2099-06-10T10:30:00Z", occupied_end: "2099-06-10T12:00:00Z" }, "venue_bookings");
  mockGetDocs
    .mockResolvedValueOnce({ docs: [assignment] })
    .mockResolvedValueOnce({ docs: [first, second] })
    .mockRejectedValueOnce(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
  mockGetDoc.mockResolvedValue(snap("V1", { name: "Harbour Hall" }, "venues"));

  const rows = await loadVenueBookingQueue({ user: { uid: "VS1" } });

  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.clashes.length === 1)).toBe(true);
  expect(rows[0].clashes[0]).toMatchObject({ event_a_name: "Forum", event_b_name: "Briefing" });
});

test("TC-1150 F16 browser views treat a hold past its deadline as expired", async () => {
  const event = snap("E1", { coordinator_id: "C1", name: "Community Summit" }, "events");
  const held = snap("B1", { event_id: "E1", venue_id: "V1", status: "HELD", hold_expires_at: "2000-01-01T00:00:00Z", submitted_at: "1999-12-20T00:00:00Z" }, "venue_bookings");
  mockGetDocs.mockResolvedValueOnce({ docs: [event] }).mockResolvedValueOnce({ docs: [held] }).mockResolvedValueOnce({ docs: [held] });
  mockGetDoc.mockImplementation((reference) => Promise.resolve(reference.path === "venues/V1"
    ? snap("V1", { name: "Harbour Hall" }, "venues")
    : snap("V1", { staff_name: "Priya Nair" }, "venue_staff")));

  const rows = await loadVenueBookings({ user: { uid: "C1" } });

  expect(rows[0]).toMatchObject({ booking_id: "B1", status: "EXPIRED" });
});

