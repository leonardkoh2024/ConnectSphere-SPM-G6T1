# Customer Q&A — Session 1 answers

Project G6 T1 · IS212 AY2026/27 T1
**Session 1: 25 August 2026, 7pm, SCIS1 SR 2-1**

Answers as given by our section's customer. Only these count — other sections' answers do not apply.

| # | Question | Answer |
|---|---|---|
| 1 | Can Coordinators override a Venue Staff rejection? If yes, who is accountable if that override causes a conflict? | Should not be any overrides. |
| 2 | Does the request get rejected, or sit pending indefinitely, if the event remains incomplete or unfulfilled (e.g. no venue found)? | Rejected. |
| 3 | How long can a tentative hold exist before it expires or must be confirmed? | Doesn't matter for now. |
| 4 | When an Organiser requests a change post-confirmation, is it auto-flagged for re-review, or must the Coordinator notice manually? | Send notification. |
| 5 | Business rule on sudden changes — penalty system, or cutoff before the event? | Can raise at any point in time. |
| 6 | Which arrangements are mandatory before a Coordinator may confirm an event? | Venue and technical. |
| 7 | What changes count as affecting confirmed arrangements ("ordinary edit" vs not)? | Change in number of pax → big change → re-request. |
| 8 | What systems does ConnectSphere use today, and does the new system replace or integrate with them? | A mix. Yes — it replaces them completely. |
| 9 | Who can edit event details? Is there a limit on the number of changes? | Event Coordinator can change. No limit on number of changes. |
| 10 | How is a Coordinator assigned? Can an event have more than one? | Auto-assigned. No more than one. |
| 11 | What numerical threshold makes an attendance change "significant"? | No threshold — the significant changes are number of pax, venue, duration. |
| 12 | Logistical constraints / transit time when equipment sits at another venue? | None. |
| 13 | How are external Organisers onboarded, and do they belong to predefined client organisations? | No onboarding, no predefined list. |
| 14 | Does an Attendee need an account, or is guest registration permitted? | They need to sign up. |
| 15 | Is pricing, quotation, invoicing or payment in scope? | No. |
| 16 | Workflow and permissions if an assigned Coordinator becomes unavailable? | You do not need to consider this. |
| 17 | Is venue/equipment contention first-come-first-served? Who is prioritised? | First come first served for venue. |
| 18 | How is the waiting list resolved when a registered Attendee withdraws? | First-come-first-served priority; notify when there's a slot. |
| 19 | Expectations for UI/UX deliverables (e.g. high-fidelity Figma prototypes)? | No. |
| 20 | Constraints on the technical stack (Vue.js, AWS/Azure)? | *(no answer given)* |
| 21 | What happens to attendee registrations when an event is rescheduled or cancelled? | They are notified that the event is cancelled. |
| 22 | Auditability — internal or external audits? Any standards? | Internal audits. No standards — just make sure data does not disappear when the event ends. |
| 23 | On withdrawal, is the first waitlister auto-registered or invited to apply? Lead time? | Not automatic — invited to apply. Lead time is ours to decide. |
| 24 | Will test data be provided? | No. |
| 25 | Do Technical Support Staff keep a spare/buffer inventory, or does damage immediately invalidate arrangements? | Not important. |
| 26 | Who defines the length of the registration period? | The Organiser. |
| 27 | Is there a standard form for the Organiser to supply information to the Coordinator? | No standardisation. |

---

## What this cuts from scope

Confirmed out of release 1 by the answers above:

- Pricing, quotation, invoicing, payment (Q15)
- Coordinator reassignment and handover (Q16)
- Equipment transfer between venues, transit time (Q12)
- Client organisation management — no predefined client list (Q13)
- Integration with Google / M365 / existing calendars and forms — full replacement, not integration (Q8)
- Spare/buffer equipment inventory rules (Q25)
- Tentative hold expiry rules (Q3 — "doesn't matter for now")
- High-fidelity Figma prototypes as a deliverable (Q19)

## What this pins down

- **Confirmation gate:** venue **and** technical arrangements must both be in place before a Coordinator can confirm (Q6).
- **Significant change** = number of pax, venue, or duration. A significant change means the affected arrangement is **re-requested**, not silently kept (Q7, Q11).
- **Change handling** is notification-driven, not an automatic re-review workflow (Q4). Changes may be raised at any time, unlimited (Q5, Q9).
- **Coordinator assignment** is automatic, exactly one per event (Q10).
- **Venue contention** is first-come-first-served (Q17). No coordinator override of a Venue Staff rejection (Q1).
- **Dead ends are rejected**, not left pending (Q2).
- **Attendees need accounts** (Q14). **Organisers self-serve** with no onboarding step (Q13).
- **Waiting list**: FCFS order, notify on a free slot, the person is *invited to apply* within a lead time we define (Q18, Q23).
- **Audit**: internal only, no standard to comply with; the real requirement is that event data survives event completion (Q22).

## Contradictions to resolve at Session 2

These answers conflict with the written briefing. Do not build against either version until it is settled.

1. **Q9 says the Event Coordinator edits event details.** The briefing has Organisers creating and saving *draft* requests (§4, Step 1) and recording the programme. Most likely reading: Organisers own the request until submission, Coordinators own it after. Confirm that, because it decides who owns a large slice of the intake epic.
2. **Q13 removes client organisations**, but §8b of the briefing says "an Event Organiser should not normally be able to view events belonging to unrelated clients". With no client organisations, that rule collapses to "an Organiser sees only their own events". Confirm which.
3. **Q2 says incomplete requests are rejected**, but Step 4 of the briefing has the Coordinator *returning* a request for clarification. Are "returned for amendment" and "rejected" both statuses, and can a returned request be resubmitted?
4. **Q17 answered venue only.** The question also asked about equipment. Equipment contention is still unresolved.

## Still unanswered — take to Session 2

| Topic | Why it matters |
|---|---|
| **Setup and turnaround time** between consecutive bookings | Named in the briefing as a feature *and* a current pain point. Interacts directly with FCFS venue conflict detection: does the next booking clash with the event, or with the event plus its turnaround? Nothing can be built on venue availability until this is answered. |
| Equipment: individual tracked units vs pooled quantity per type | Determines the equipment data model. The briefing implies both. |
| Equipment contention priority | Q17 covered venue only. |
| Multi-venue events; per-session vs whole-event booking | Decides whether a booking hangs off the event or off each session. |
| How auto-assignment picks a Coordinator (round-robin, load, availability) | "Auto-assigned" is not yet testable. |
| Rough data volumes over three years | The scalability requirement is untestable without figures. |
| Technical stack constraints | Asked, not answered (Q20). |
| Waiting-list lead time | Ours to choose — but state the number and have them confirm it. |
