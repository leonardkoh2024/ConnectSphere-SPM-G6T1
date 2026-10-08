# ADR 0001 — Coordinator auto-assignment: circular rotation by coordinator ID

ADR 0001 — Coordinator auto-assignment: circular rotation by coordinator_seq, backend-owned
Status: Accepted (Release 1) — supersedes the earlier LRA proposal and the "active coordinators + unassigned queue" draft
Date: 2026-09-19
Deciders: Shi Han
Story: C1 / SCRUM-102 — Have submitted events assigned to a coordinator automatically
Context

C1 requires every submitted event to be picked up by exactly one Event Coordinator automatically, so a request never sits unclaimed. The mechanism must be simple to implement, deterministic to test, and consistent with the customer's answers.

Constraints from the source documents:

Auto-assigned, one coordinator per event (Customer Q&A Session 1, Q10).
No limit on concurrent events per coordinator (Session 2, Q12) — a coordinator is never "busy"; load never disqualifies them.
Coordinator unavailability is out of scope (Session 1, Q16) — no active/inactive handling and no reassignment as part of C1.
No account/staff management in Release 1 (Session 2) — coordinators are seeded.
The Week 4 instructions describe assignment as "submitted events can be assigned to a coordinator… reassigned when responsibilities or availability change"; the reassignment half lives in C9, not C1.

Note: the C1 acceptance criteria in docs/Final Product Backlog.csv are stale (they still say "round-robin across active coordinators" and an "unassigned queue"). The finalised ACs are agreed but not yet committed to the repo (they land next sprint). Until then, docs/test-cases.md (TC-072–TC-080) is the authoritative C1 spec.

Decision
Circular rotation by coordinator_seq. Each coordinator carries an integer coordinator_seq (1, 2, 3, …). On assignment, pick the coordinator whose seq is the next one greater than the last-assigned seq; if none is greater, wrap to the lowest. All seeded coordinators participate.
Exactly one coordinator, assigned once. Assignment runs only when coordinator_id is empty (first submission) and is never re-run; coordinator_id is immutable once set.
No active/inactive flag, no unassigned queue, no reassignment in C1 (Q16; manual reassignment is C9 if pursued).
Assignment runs in the backend (Option B) via the Firebase Admin SDK. The rotation cursor (last-assigned coordinator_seq) lives server-side and is advanced atomically (transaction / single writer), so concurrent submissions cannot double-assign or skip.
Integrity enforced in firestore.rules: clients may not write or change coordinator_id or assigned_at; only the backend service account may. The rules change ships in the same commit as the feature (A4 is graded on server-side rules).
Status unchanged by assignment — the event stays Submitted. Timestamps in SGT. No cap on events per coordinator.

State persisted: the rotation cursor (last-assigned coordinator_seq). Each event carries coordinator_id, assigned_at (SGT), status.

Alternatives considered
Least-recently-assigned (LRA). Fairer — catches up idle/returning coordinators. Rejected for R1 as more state than needed; revisit if fairness across uneven activity is ever required.
Load- / schedule-aware assignment. Rejected — contradicts "no limit" (Session 2, Q12) and has no basis in the requirements; would need customer sign-off.
Client-side assignment (Option A). No backend; a Firestore transaction gives race-safety. Rejected because the rules cannot validate the rotation pick, so a client could forge coordinator_id. Option B gives real, server-enforced integrity (A4). Option A remains the documented fallback if backend work slips — with the integrity gap stated.
Consequences
Positive: simple, deterministic, easy to test; a single trusted writer; robust to coordinators being added/removed; strong server-side integrity.
Negative: rotation ignores assignment history, so a coordinator idle for a stretch is not "caught up." Acceptable for a Release 1 demo.
Traceability: satisfies C1 AC1, AC2, AC3, AC5, AC6, AC7 (finalised set); exercised by TC-072 – TC-080 in docs/test-cases.md.
Requirements this creates
Each seeded coordinator must carry an integer coordinator_seq.
A server-side rotation-cursor document.
firestore.rules making coordinator_id / assigned_at client-unwritable and immutable once set.