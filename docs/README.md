# Requirements artefacts

Copies of the artefacts release 1 is built against, kept in the repo so everyone on the team has them and so
`CLAUDE.md` can point at real paths.

These are **copies**. The originals live in the `Project G6 T1/` folder outside this repo, which is not
version-controlled. If you update one there, copy it here in the same PR, or the two will drift.

## Precedence

When two artefacts disagree:

1. The Week 7 Customer Changes beat every earlier artefact — Week 4 instructions and both Q&A sessions
   included. The customer says no further changes are expected for release 1.
2. Later customer Q&A beats earlier customer Q&A.
3. The Week 4 Project Instructions beat any Week 1 / Week 2 artefact.
4. The backlog is an interpretation, not an authority.

Only our own section's customer answers count — other sections were given different answers to the same
questions.

## What is here

| File | What it is |
| --- | --- |
| `week4-project-instructions.docx` | **The scope authority.** Names the 20 core features release 1 must implement. |
| `customer-qa-session1-answers.md` | Q&A Session 1, 25 Aug 2026. |
| `customer-qa-session2-answers.md` | Q&A Session 2, 9 Sep 2026. |
| `Week 7 Customer Changes.pdf` | **The latest customer artefact.** Six changes release 1 must implement: venue setup and turnaround time, venues becoming unavailable after booking, multiple venues per event, tentative holds that expire, the Event Coordinator Lead role, and the Safety Officer's Operational Safety Check. |
| `Final Product Backlog.csv` | 92 stories across epics A–L with acceptance criteria and estimates. Renamed from `final-product-backlog.csv` when the Week 7 stories were added. |
| `design-system.md` | **Ours, not the customer's.** The visual language the UI is built to. Not a requirements artefact and not subject to the precedence rules above. |
| `test-cases.md` | **Ours, not the customer's.** Every test case in the repo, with the story and Jira ticket it traces to, and the open defects the tests found. Not subject to the precedence rules above. |

Deliberately not copied here, but available in `Project G6 T1/`: the Week 1 customer briefing (superseded on
most specifics), the `week4-backlog-pool` working files including the open-items table, and `schema/` with the
ERDs and schema table.

## Known staleness

`Final Product Backlog.csv` was first written on the morning of 9 Sep 2026, **before** Q&A Session 2 that
evening. On 6 Oct 2026 it gained 22 stories for the Week 7 changes:

| Week 7 change | Stories |
| --- | --- |
| 1 · Setup and turnaround time | E9, F9, F10 |
| 2 · Venue unavailable after booking | E11, F11 |
| 3 · Multiple venues for one event | F12, F13, F14 |
| 4 · Tentative holds expire | F15, F16 |
| 5 · Event Coordinator Lead | A6, K1–K5 |
| 6 · Operational Safety Check | A7, E10, L1–L4 |

The earlier stories were **not edited** to match. Where a Week 7 story says it replaces part of an earlier
one, the Week 7 story wins:

- **K1** replaces C1's automatic assignment — submitted events go to an unassigned queue for the Lead.
- **K3** replaces C9 criterion 5 — the Lead reassigns, not the coordinator in charge.
- **L1** replaces D3's Confirm action — the coordinator sends the event for its safety check, and the Safety
  Officer's approval (L3) is what makes it Confirmed.
- **E11** replaces E3 criterion 3 — unavailability may now overlap approved bookings.

Conflicts with Session 2 that are still unreconciled:

- Stories **A1** and **A2** are self-registration, which Session 2 removed from release 1 entirely.
- The equipment stories in epic **G** were written against Session 1's "assume equipment is always available",
  which Session 2 reversed.

Read `Week 7 Customer Changes.pdf` and `customer-qa-session2-answers.md` alongside any story before building it.
