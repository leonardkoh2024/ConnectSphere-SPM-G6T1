# ADR 0001 — Coordinator auto-assignment: circular rotation by coordinator ID

- **Status:** Accepted (interim for Release 1) — supersedes the earlier least-recently-assigned (LRA) proposal
- **Date:** 2026-09-18
- **Deciders:** Shi Han
- **Story:** C1 / SCRUM-102 — *Have submitted events assigned to a coordinator automatically*

## Context

C1 requires every submitted event to be picked up by exactly one Event Coordinator automatically, so a request never sits unclaimed. The mechanism has to be simple to implement, deterministic to test, and consistent with what the customer has told us.

What the source documents constrain:

- **Auto-assigned, one coordinator per event.** (Customer Q&A Session 1, Q10)
- **No limit on how many events a coordinator handles concurrently.** (Session 2, Q12)
- **Coordinators are never "busy."** No requirement gives a coordinator a workload or schedule dimension. The Week 4 project instructions (*Coordinator Assignment*) say events "can be assigned to an Event Coordinator… and may subsequently be **reassigned when staff responsibilities or availability change**" — so the only eligibility axis is a binary **active / inactive** availability status, which also triggers reassignment. It is *not* a load or time-window calculation.
- Session 1 (Q16) initially said unavailability handling was not required; the Week 4 core features and backlog story C9 reinstate reassignment, still as a status change.

We previously explored **LRA** (assign to the active coordinator whose most recent assignment is oldest; never-assigned counts as oldest). For Release 1 we are simplifying.

## Decision

Use **circular rotation by coordinator ID**:

1. On each assignment, choose the active coordinator with the **smallest ID greater than the last-assigned coordinator's ID**; if none is greater, **wrap** to the smallest active ID.
2. **Inactive coordinators are skipped.** The first ever assignment (no last-assigned) starts at the lowest active ID.
3. **Exactly one** coordinator per event; **no cap** on events per coordinator.
4. **Coordinators are never busy** — while active, a coordinator is always eligible regardless of current load. "Inactive" means the availability status is off (e.g. on leave), not overloaded.
5. **No active coordinator** → the event stays in a visible **unassigned queue** and is auto-assigned as soon as a coordinator becomes active (queued events processed in submission order).
6. A coordinator going **inactive** → their events are reassigned by rotation, or returned to the queue if none are active.
7. All assignment timestamps are stored in **SGT**.

**State persisted:** the last-assigned coordinator ID (the rotation cursor). Each event carries `coordinator_id`, `assigned_at` (SGT) and `status`.

## Alternatives considered

- **Least-recently-assigned (LRA).** Fairer: it catches up a newly activated or returning coordinator (never-assigned = oldest → picked first) and rebalances after periods of inactivity. **Rejected for Release 1** as more state and complexity than the demo needs. Revisit if fairness across uneven coordinator activity becomes a real requirement.
- **Load-aware / schedule-aware assignment** (assign only to a coordinator free during the event's window). **Rejected** — it directly contradicts the customer's "no limit" answer (Session 2, Q12): excluding a coordinator for having an overlapping event is a de-facto cap of one per window. It also has no basis in the requirements and would need capacity and event-window definitions. Out of scope; would require customer sign-off at Session 3.

## Consequences

- **Positive:** trivial to implement and to test; fully deterministic; robust to coordinators being added, removed, or (de)activated with no manual cursor repositioning.
- **Negative:** rotation ignores assignment history, so a coordinator who was inactive for many events is **not** "caught up" when they return, and distribution can skew if coordinators toggle active frequently. Acceptable for a Release 1 demo; noted here as the cost of the simpler rule.
- **Traceability:** satisfies C1 AC1–AC5; exercised by test cases **TC-072 – TC-085** in `docs/test-cases.md`.

## Open / to confirm (Session 3)

- What sets a coordinator's **active flag** on and off, given there is no account/staff management in Release 1. Current assumption: a **seeded field on the coordinator record, defaulting to on**.
- Whether LRA (or another fairness rule) is wanted for a later release.