# Requirements artefacts

Copies of the artefacts release 1 is built against, kept in the repo so everyone on the team has them and so
`CLAUDE.md` can point at real paths.

These are **copies**. The originals live in the `Project G6 T1/` folder outside this repo, which is not
version-controlled. If you update one there, copy it here in the same PR, or the two will drift.

## Precedence

When two artefacts disagree:

1. Later customer Q&A beats earlier customer Q&A.
2. The Week 4 Project Instructions beat any Week 1 / Week 2 artefact.
3. The backlog is an interpretation, not an authority.

Only our own section's customer answers count — other sections were given different answers to the same
questions.

## What is here

| File | What it is |
| --- | --- |
| `week4-project-instructions.docx` | **The scope authority.** Names the 20 core features release 1 must implement. |
| `customer-qa-session1-answers.md` | Q&A Session 1, 25 Aug 2026. |
| `customer-qa-session2-answers.md` | Q&A Session 2, 9 Sep 2026. |
| `final-product-backlog.csv` | 70 stories across epics A–J with acceptance criteria and estimates. |

Deliberately not copied here, but available in `Project G6 T1/`: the Week 1 customer briefing (superseded on
most specifics), the `week4-backlog-pool` working files including the open-items table, and `schema/` with the
ERDs and schema table.

## Known staleness

`final-product-backlog.csv` was written on the morning of 9 Sep 2026, **before** Q&A Session 2 that evening.
It has not been reconciled since. Known conflicts:

- Stories **A1** and **A2** are self-registration, which Session 2 removed from release 1 entirely.
- The equipment stories in epic **G** were written against Session 1's "assume equipment is always available",
  which Session 2 reversed.

Read `customer-qa-session2-answers.md` alongside any story before building it.
