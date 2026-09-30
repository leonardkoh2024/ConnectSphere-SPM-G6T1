// C1 / SCRUM-102 — coordinator auto-assignment: circular rotation by
// coordinator_seq. See docs/adr/0001-coordinator-auto-assignment.md.
//
// No React, no Firebase — this is the one place the rotation rule is decided,
// so it can be unit-tested with plain values and called unchanged from the
// backend service that owns the actual write.

// coordinators: [{ id, coordinator_seq }, ...], any order, all seeded and
// always eligible (no active/inactive flag — Q16).
// lastAssignedSeq: the coordinator_seq last handed an event, or null/undefined
// before any assignment has ever happened.
//
// Picks the next coordinator whose seq is strictly greater than lastAssignedSeq;
// wraps to the lowest seq once none is greater. A single coordinator is handed
// every event (AC5 — no cap, never "busy").
export function pickNextCoordinator(coordinators, lastAssignedSeq) {
  if (!Array.isArray(coordinators) || coordinators.length === 0) {
    throw new Error("pickNextCoordinator: at least one coordinator must be seeded");
  }

  const sorted = [...coordinators].sort((a, b) => a.coordinator_seq - b.coordinator_seq);

  if (lastAssignedSeq == null) return sorted[0];

  const next = sorted.find((coordinator) => coordinator.coordinator_seq > lastAssignedSeq);
  return next || sorted[0];
}