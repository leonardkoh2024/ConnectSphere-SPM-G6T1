import { confirmationReadiness, formatSgt, outstandingArrangements } from "./eventConfirmation";

const approved = { booking_id: "b1", venue_name: "Hall A", status: "APPROVED" };
const arranged = { key: "0-AUDIO", label: "Audio × 2", arranged: true };
const pending = { key: "1-LIGHTING", label: "Lighting × 1", arranged: false };

test("TC-0499 D3 AC1 an approved venue booking and arranged equipment leave nothing outstanding", () => {
  expect(outstandingArrangements({ venueBookings: [approved], equipmentLines: [arranged] })).toEqual([]);
});

test("TC-0500 D3 AC2 an event that asked for no equipment satisfies the technical condition", () => {
  expect(outstandingArrangements({ venueBookings: [approved], equipmentLines: [] })).toEqual([]);
});

test("TC-0501 D3 AC3 a missing venue booking or an unarranged line is named", () => {
  expect(outstandingArrangements({ venueBookings: [], equipmentLines: [] })).toEqual(["an approved venue booking"]);
  expect(outstandingArrangements({ venueBookings: [{ ...approved, status: "Pending" }], equipmentLines: [] })).toEqual(["Hall A"]);
  expect(outstandingArrangements({ venueBookings: [approved], equipmentLines: [arranged, pending] })).toEqual(["Lighting × 1"]);
});

test("TC-0502 D3 AC1 AC3 confirmation is offered only in Approved or Planning, and only when ready", () => {
  const ready = { venueBookings: [approved], equipmentLines: [arranged] };
  expect(confirmationReadiness({ event: { status: "PLANNING" }, ...ready })).toMatchObject({ applicable: true, ready: true });
  expect(confirmationReadiness({ event: { status: "PLANNING" }, venueBookings: [], equipmentLines: [] }).ready).toBe(false);
  expect(confirmationReadiness({ event: { status: "CONFIRMED" }, ...ready }).applicable).toBe(false);
});

test("TC-0503 D3 AC4 the confirmation time is shown in Singapore time", () => {
  expect(formatSgt("2026-11-03T16:30:00Z")).toMatch(/4 Nov 2026.*00:30 SGT/);
  expect(formatSgt(null)).toBe("Not recorded");
});

test("TC-2427 [boundary] L1 / D3 with nothing passed in, a venue booking is outstanding and nothing is sendable", () => {
  expect(outstandingArrangements()).toEqual(["an approved venue booking"]);
  expect(confirmationReadiness()).toEqual({ applicable: false, ready: false, outstanding: ["an approved venue booking"] });
  expect(confirmationReadiness({ event: { status: "APPROVED" }, venueBookings: [approved] })).toMatchObject({ applicable: true, ready: true });
});

test("TC-2428 [conflict] L1 an event already in Safety Review cannot be sent again", () => {
  expect(confirmationReadiness({ event: { status: "SAFETY_REVIEW" }, venueBookings: [approved] }).applicable).toBe(false);
});

test("TC-0504 [failure] D3 AC4 an unreadable confirmation time reads Not recorded", () => {
  expect(formatSgt("not a date")).toBe("Not recorded");
});
