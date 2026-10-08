# ConnectSphere — IS212 G6 T1

Event Planning and Venue Booking System built for a mock customer, "ConnectSphere Event Services",
as the IS212 (AY2026/27 T1) team project. Release 1 is due Week 12. The module grades **scrum process,
requirements traceability, software quality and documentation** at least as heavily as the running product —
so traceability to a story ID matters more here than it would on a normal project.

## Source of truth, and what wins

Requirements artefacts are in [`docs/`](docs/) — the Week 4 instructions (the 20 core features), the Week 7
customer changes, the final backlog, and both customer Q&A sessions. `docs/README.md` indexes them. These are
copies of originals that live outside the repo in `Project G6 T1/`; if you change one there, copy it across in
the same PR. The Week 1 briefing, the backlog working files (including the open-items table) and the ERDs
stay in that folder only.

Precedence when two artefacts disagree:

1. **Week 7 Customer Changes** (`docs/Week 7 Customer Changes.pdf`) beat everything earlier, including the
   Week 4 instructions and both Q&A sessions. The customer expects no further changes for release 1.
2. **Later customer Q&A** beats earlier customer Q&A.
3. **Week 4 Project Instructions** (the 20 core features) beat any Week 1/Week 2 artefact.
4. **The backlog** (`docs/Final Product Backlog.csv`) is an interpretation, not an authority. It was written
   9 Sep 2026, *before* Q&A Session 2, and on 6 Oct 2026 gained 22 Week 7 stories (A6–A7, E9–E11, F9–F16,
   K1–K5, L1–L4). The older stories were not edited: where a Week 7 story says it replaces part of an earlier
   one (K1 → C1, K3 → C9 AC5, L1 → D3, E11 → E3 AC3), the Week 7 story wins. Where the backlog conflicts with
   the rules below, the rules win.

Only our own section's customer answers count. Other sections were given different answers.

## Domain rules that constrain code

**Roles** — exactly seven, no admin role exists: Event Organiser (external), Event Coordinator (internal),
Event Coordinator Lead (internal), Venue Staff (internal), Technical Support Staff (internal),
Safety Officer (internal), Attendee (external). The Lead and the Safety Officer were added by Week 7 changes
5 and 6 (stories A6, A7); like every other role they are seeded, never self-registered.
In code the canonical list is `ROLES` / `ROLE_META` in `frontend/src/domain/roles.js`, which still holds only the
original five — add the two new roles there, and nowhere else. Do not introduce an eighth role or a parallel
string literal.

**Event status — exactly these ten**: the nine from core feature F6, plus **Safety Review**, which story L1
adds between Planning and Confirmed for Week 7 change 6:

```
Draft · Submitted · Under Review · Approved · Planning · Safety Review · Confirmed · Completed · Cancelled · Rejected
```

There is no `Returned`. A request waiting on its organiser stays **Under Review** with an open clarification
request against it. Booking states such as *Held*, *Expired*, *Replaced*, *Venue unavailable – replacement
needed* and *Clash – review required* belong to a venue booking, not to the event.

**Workflow invariants**

- Coordinator assignment is **not** automatic (Week 7 change 5, K1). A submitted event enters an unassigned
  queue that only the Event Coordinator Lead can see; the Lead assigns exactly one coordinator (K2) and is the
  one who reassigns (K3). No limit on how many events a coordinator holds. A coordinator may act only on
  events currently assigned to them, refused server-side otherwise (K5). ADR 0001 and the
  `coordinatorAssignment` service implement the old automatic rotation and are superseded.
- A coordinator cannot Confirm directly any more. Once **every** active venue booking is approved and all
  requested technical arrangements are confirmed, they *send the event for its safety check* (L1, status →
  Safety Review). The Safety Officer approves (→ Confirmed), rejects, or requests changes; the last two return
  the event to Planning with the affected arrangements flagged for review (L3, L4). An event needs a passed
  check made after its most recent return to Planning. In `firestore.rules` the Safety Officer can reach an
  event only while it is in Safety Review. Each outcome is a write-once `safety_reviews` record, and the event
  moves only together with a matching record (`last_safety_review_id`).
- A booking occupies its venue from *start − setup time* to *end + turnaround time*, using that venue's
  values (E9, F9). Windows that only touch do not conflict. When the values change, bookings that now clash
  are flagged, never cancelled or moved (F10).
- An event may book **several venues at once** (F12). Each booking is checked on its own for suitability,
  availability and conflicts (F13); releasing one leaves the others untouched (F14).
- Venue Staff may mark a venue unavailable even over approved bookings (E11). The event is never cancelled:
  its bookings are flagged, its coordinator notified, and a Confirmed event goes back to Planning until a
  replacement venue is approved (F11).
- A tentative hold must carry an expiry; it lapses on time even if nobody opens the system, and an active or
  expired hold never counts as an approved booking (F15, F16).
- A *significant change* is a change to number of pax, venue, or duration — no numeric threshold.
  It notifies, then re-requests the affected arrangement. The system never auto-revokes an arrangement.
- Venue contention is first-come-first-served. A Venue Staff rejection **cannot** be overridden.
- Cancellation is automatically approved — no coordinator decision step.
- Waiting list is FCFS and members are *invited to apply* for a freed place, not auto-promoted.

## Release 1 boundaries — do not build these

- **No account creation, for any role.** All users — organisers, internal staff, attendees — are assumed to
  already have accounts. Seed them. (Session 2 reversed this; the repo's existing registration screens and
  backlog stories A1/A2 predate that answer — see Open questions.)
- No multi-session or multi-day events. One event = one time window — though since Week 7 it may use
  several venues during that window.
- No deployment. Running locally plus an architecture diagram is what gets submitted.
- No pricing, invoicing or payment.
- No file attachments or document storage. (Firebase Storage is initialised in `frontend/src/lib/firebase.js` but is
  unusable on the free tier — do not build on it.)
- No equipment transfer between venues, no spare-equipment inventory. (Tentative holds and their expiry
  *are* in scope since Week 7.)
- No Google Calendar / M365 integration, no change deadlines or penalties.

**Equipment counts are in scope.** Session 1 said to assume equipment is always available; Session 2 reversed
that. Availability must be checked against real counts.

Venues, equipment and room layouts are **our own mock data** — the customer supplies no list.

## Repo conventions

Create React App (`react-scripts` 5) + React 19, Firebase Auth + Firestore, plain CSS, React Testing Library.
Icons come from `react-icons` (Lucide set, `react-icons/lu`) and are mapped to a name in `frontend/src/app/Icon.js` —
import the glyph there rather than `react-icons/*` in a screen, so the imports stay tree-shakeable and the set stays consistent.

The repo is an **npm workspace**. Install and run from the repo root, never from inside a workspace —
dependencies hoist to the root `node_modules` and there is a single root `package-lock.json`.

```
npm install          # installs both workspaces
npm start            # backend on :4000 AND frontend on :3000, via concurrently
npm run start:backend / start:frontend    # one at a time
npm test             # RTL, delegates to the frontend workspace
npm run build        # production build into frontend/build/
```

- **`frontend/` (:3000)** — the Create React App client. In development it proxies `/api/*` to the backend
  (`proxy` in `frontend/package.json`), so frontend code calls relative paths and needs no base URL.
- **`backend/` (:4000)** — the Express service layer. Each service mounts itself into the app through
  `backend/src/services/index.js`; add a row there and nothing else needs to change. A service owns its own
  path prefix and its own Firestore collections, and never reads or writes another service's collections.
- `firebase.json`, `firestore.rules` and `docs/` stay at the root.

**Do not add `react-app/jest` back to `frontend`'s `eslintConfig`.** The `jest/globals` env it pulls in comes
from `eslint-plugin-jest`, which ESLint cannot resolve once dependencies hoist to the workspace root — it
fails the production build with `Environment key "jest/globals" is unknown`. The config uses ESLint's
built-in `jest` env instead, which needs no plugin. Linting is otherwise unchanged and still fails the build
on real problems.

- Firebase config comes from `REACT_APP_FIREBASE_*` env vars via `frontend/src/lib/firebase.js`. There is **one
  `.env`, at the repo root**, serving both workspaces; the root scripts load it with `dotenv-cli` before
  handing off, so a workspace started directly gets no config at all. `.env` is gitignored and `.env.example`
  is the committed template — add every new key there, with no value. Never commit credentials, never paste
  them into a chat or an issue. The backend reads `BACKEND_PORT`, not `PORT`: CRA reads `PORT` for its dev
  server, so a shared `PORT` would put both on the same one.
- Navigation is hash-based (`#/{role}/{screen}`) handled in `frontend/src/app/routes.js`. There is no router library;
  do not add one without the team agreeing.
- Firestore field names are `snake_case` (`organiser_id`, `event_date`, `reference_no`); React code is
  `camelCase`. Keep that split.
- **Never touch the shared Firebase project on your own initiative.** One Firebase project backs the whole
  team, so a stray write is everyone's bug. Do not seed, edit, delete or migrate Firestore documents, and do
  not change `firestore.rules`, indexes or project settings, as a side-effect of some other task — only when
  that is the task you were asked to do. Say what will be written, and to which collection, before doing it.
  Prefer test/emulator data or a throwaway document over editing live records.
- **`firestore.rules` is part of the feature.** Any new collection, or any change to who may read or write an
  existing one, must land in the same commit as the code that uses it. Authorisation is enforced there, not
  only in the UI — story A4 ("see only what my role permits") is graded on the server-side rule, and a screen
  that merely hides a button does not satisfy it.
- **`frontend/src/` is organised by feature, not by file type.** One folder per epic under `features/`,
  each holding its own page components plus a `components/` subfolder for its pieces. Add `features/venues/`,
  `features/equipment/` and so on as those epics are picked up — do not let `Workspace.js` accumulate screens
  inline, and do not create a global `pages/` bucket.

  ```
  frontend/src/
    app/        App.js (auth gate) · Workspace.js (role shell) · routes.js (hash format) · Icon.js · App.css
    domain/     roles · portals · accounts · events — no React, no Firebase
    features/   auth/ · events/ — one folder per epic, each with its own components/
    lib/        firebase.js — the only module that imports firebase/*
    sandbox/    unimported spike screens, safe to delete
  ```

- **`domain/` holds the rules, not the UI.** Roles, portals, account rules and catalogue values live there as
  plain functions and constants. Nothing in `domain/` may import React or Firebase — that is what lets it move
  into `backend/` unchanged when the service layer is built, and it is why those rules are cheap to unit test.
- Shared UI used by more than one feature goes in `frontend/src/components/`; until a second feature needs it,
  a component stays inside the feature that owns it.
- **The visual language is fixed by [`docs/design-system.md`](docs/design-system.md)** — palette, type scale,
  radii, elevation and density, modelled on Fresha and implemented as `--cs-*` tokens in `App.css`. Read it
  before writing CSS. Use a token; never put a hex value in a rule. If the scale lacks what you need, add it
  to `:root` and to that doc in the same commit.
- **`backend/` is the service layer and is deliberately empty.** Services get added as the stories needing
  them are picked up — one folder per service, each owning its own Firestore collections, no two services
  writing the same collection. See `backend/README.md`. Whether they end up as build-time modules or separate
  HTTP processes is not yet decided, so keep each service's public surface free of React imports.

## Working agreement

- **Commit straight to `main`.** No feature branches, no PRs. Pull before starting and before pushing.
  The per-person branches on the remote are from the earlier convention and are not used any more.
- Keep commits small and self-contained — direct-to-main means someone else pulls your work immediately,
  so a half-finished change on `main` blocks the whole team rather than sitting in a branch.
- **Start every commit message with the backlog ID and the Jira ticket ID** —
  `B4; SCRUM-95; state the equipment my event needs`. The backlog IDs are `A1`–`L4` (from
  `docs/Final Product Backlog.csv`); the Jira IDs are `SCRUM-nn`. Both, separated by semicolons, then the
  summary. With no PRs, the commit message is the only record of story-to-code traceability, and that
  traceability is marked. People write these by hand, so small deviations in spacing or punctuation are fine —
  what must not be missing is either ID.
- One story per commit where you can. If a commit genuinely covers several, list each `backlog; jira; summary`
  triple on its own line in the body rather than running them together in the subject.
- Acceptance criteria in `docs/Final Product Backlog.csv` are the definition of done. Read the story's criteria
  before starting, and cover them in tests where the criterion is testable.
- If the customer has not answered something, do not invent an answer in code — add it to the Session 3
  question list instead.

## Open questions (do not silently resolve)

- Registration screens are already built and merged, but Session 2 says release 1 needs no account creation.
  Decide: keep them as a convenience, or replace with seeded accounts. Backlog A1/A2 need rewording either way.
- Hold length: F15's summary says a hold lasts 3 working days and F16 AC1 repeats it, but F15 AC1–2 have
  Venue Staff enter an expiry date/time. Decide whether 3 working days is a default, a fixed rule, or dropped.
- ADR 0001 / `coordinatorAssignment` (automatic rotation) are superseded by K1. Decide whether to retire the
  service and its `coordinators` / `assignment_cursor` collections or repurpose them for the Lead's queue,
  and mark the ADR superseded.
- Equipment data model: pooled quantity vs individually tracked units.
- Who may edit an event after submission (Q9 and the Week 1 briefing disagree).
- The Session 2 security question was left blank. Current assumption: role-correct access plus password
  hashing is the whole requirement.
- Product name is ours to choose and has not been chosen. "ConnectSphere" is the *company*.
- Backlog stories J3, J4 and J5 all share the summary "Be told when work arrives for me".
- B9 AC2 requires accessibility needs to be *answered* before submission, but not what counts as answered for
  a request that has none. Each of those sections now opens with a Yes/No question (`domain/eventRequest.js`,
  `SECTION_QUESTIONS`): an explicit No is an answer, an untouched question is not. Confirm in Session 3; the
  rule is one line to change.
