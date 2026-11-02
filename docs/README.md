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

## What is here

### Requirements (from the customer)

| File | What it is |
| --- | --- |
| `week4-project-instructions.docx` | **The scope authority.** Names the 20 core features release 1 must implement. |
| `customer-qa-session1-answers.md` | Q&A Session 1, 25 Aug 2026. |
| `customer-qa-session2-answers.md` | Q&A Session 2, 9 Sep 2026. |
| `Week 7 Customer Changes.pdf` | **The latest customer artefact.** Six changes release 1 implements: venue setup and turnaround time, venues becoming unavailable after booking, multiple venues per event, tentative holds that expire, the Event Coordinator Lead role, and the Safety Officer's Operational Safety Check. |
| `Final Product Backlog.csv` | 94 stories across epics A–L with acceptance criteria and estimates. |

### Ours, not the customer's

These are not requirements artefacts and are not subject to the precedence rules above.

| File | What it is |
| --- | --- |
| `design-system.md` | The visual language the UI is built to (`--cs-*` tokens). |
| `manual-test-cases.md` | 170 manual test cases covering all 94 stories, run against the emulator baseline (`npm run manual:start`). |
| `emulator-testing-guide.md` | How to run and write backend integration tests against the Firestore emulator. |
| `service.integration.TEMPLATE.js` | Template for a new `*.integration.js` test; copy it into the service's folder. |
| `adr/0001-coordinator-auto-assignment.md` | Superseded by Week 7 change 5 (K1); kept as the record of the rotation design that was removed. |
| `adr/0002-frontend-data-access.md` | Which frontend data access goes through the browser SDK and which through a backend service. |

## Reading the backlog against the later artefacts

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

The earlier stories were not edited to match. Where a Week 7 story says it replaces part of an earlier
one, the Week 7 story wins:

- **K1** replaces C1's automatic assignment — submitted events go to an unassigned queue for the Lead.
- **K3** replaces C9 criterion 5 — the Lead reassigns, not the coordinator in charge.
- **L1** replaces D3's Confirm action — the coordinator sends the event for its safety check, and the Safety
  Officer's approval (L3) is what makes it Confirmed.
- **E11** replaces E3 criterion 3 — unavailability may now overlap approved bookings.

Read `Week 7 Customer Changes.pdf` and `customer-qa-session2-answers.md` alongside any story before building it.
