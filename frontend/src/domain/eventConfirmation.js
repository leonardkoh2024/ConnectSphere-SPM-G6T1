// D3 — an event is confirmed only when its arrangements are secured.
// Week 7 story L1 replaced the coordinator's Confirm with the safety check, so the
// gate is "may be sent for its safety check" and Confirmed follows the Safety
// Officer's approval. No React, no Firebase.

import { outstandingForSafetyCheck } from "./safetyAndNotices";

const SENDABLE_STATUSES = ["APPROVED", "PLANNING"];

// AC1–AC3 — what is still missing, by name. An approved venue booking is always
// needed; the technical condition holds when no equipment was requested (AC2) and
// otherwise needs every requested line arranged by Technical Support.
export const outstandingArrangements = ({ venueBookings = [], equipmentLines = [] } = {}) =>
  outstandingForSafetyCheck({
    bookings: venueBookings,
    technicalArrangements: equipmentLines.map((line) => ({
      arrangement_id: line.key,
      label: line.label,
      requested: true,
      status: line.arranged ? "CONFIRMED" : "PENDING"
    }))
  });

export const confirmationReadiness = ({ event, venueBookings, equipmentLines } = {}) => {
  const outstanding = outstandingArrangements({ venueBookings, equipmentLines });
  return {
    applicable: Boolean(event) && SENDABLE_STATUSES.includes(event.status),
    ready: outstanding.length === 0,
    outstanding
  };
};

// AC4 — the confirmation moment, shown in Singapore time.
export const formatSgt = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return `${new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short", hour12: false
  }).format(date)} SGT`;
};
