# ConnectSphere — Event Planning and Venue Booking System

IS212 Software Project Management, AY2026/27 T1 — Group 6, Team 1.

Repository: <https://github.com/leonardkoh2024/ConnectSphere-SPM-G6T1>

```bash
git clone https://github.com/leonardkoh2024/ConnectSphere-SPM-G6T1.git
```

Release 1 of an event planning and venue booking system built for "ConnectSphere Event Services".
Event organisers submit event requests; the Event Coordinator Lead assigns each one to a coordinator, who
reviews it and arranges one or more venues and technical support. A Safety Officer then runs an Operational
Safety Check, and the event is confirmed only once it passes. Attendees register for events that are open to them.

The system has seven roles and no administrator: Event Organiser, Event Coordinator, Event Coordinator Lead,
Venue Staff, Technical Support Staff, Safety Officer, Attendee. The Lead and the Safety Officer arrived with the
Week 7 customer changes; all seven are defined in `frontend/src/domain/roles.js`.

## Getting started

Requires Node 18 or newer.

The repo is an npm workspace: **install and run everything from the repo root.**

```bash
npm install        # installs frontend and backend together
npm start          # runs BOTH: backend on :4000, frontend on :3000
```

`npm start` runs the two side by side with `concurrently`, prefixed `[backend]` and `[frontend]`. To run one
on its own use `npm run start:frontend` or `npm run start:backend`.

During development the frontend proxies `/api/*` to the backend (`proxy` in `frontend/package.json`), so
frontend code calls relative paths like `/api/events` and needs no base URL.

The app needs a Firebase project. There is **one `.env`, at the repo root**, shared by both workspaces:

```bash
cp .env.example .env     # then fill in the values
```

`.env.example` lists every key with a comment on where to find it. The file is gitignored — never commit the
values or paste them into an issue or chat. Ask the team for the current project's values rather than creating
your own, or your data will not line up with everyone else's.

The root npm scripts load that file with `dotenv-cli` before handing off to a workspace, which is why
**everything must be run from the repo root**. `npm start` from inside `frontend/` skips the loader, and
Firebase then fails to initialise with every config value `undefined`.

```bash
npm test             # frontend tests (React Testing Library), watch mode
npm run test:backend # backend unit tests (node --test)
npm run lint         # ESLint over frontend/src — any warning fails it
npm run build        # production build into frontend/build/
```

All run from the repo root. CI (`.github/workflows/tests.yml`) runs the lint and every test suite on each
push to `main` and each pull request.

### Run the same checks as CI

To reproduce `.github/workflows/tests.yml` locally, run these commands in order from the repository root:

```bash
npm run lint
npm run test:coverage --workspace frontend
npm run test:coverage --workspace backend
npm run test:integration
```

The first three commands run linting and the frontend and backend unit tests with the same 100% coverage
requirements used by CI. The final command starts a temporary Firestore emulator, runs the backend integration
tests, and shuts the emulator down. It requires Java and a root `.env` file; copy `.env.example` to `.env` if
the file does not exist. Playwright end-to-end tests are separate and are not currently run by `tests.yml`.

## End-to-end tests with Playwright

Playwright tests run against local Firebase Auth and Firestore emulators, so they do not use the shared
Firebase project or its quota.

### Playwright prerequisites

The Firebase Emulator Suite requires Java 11 or newer. Java 21 is recommended:

```bash
# Windows
winget install EclipseAdoptium.Temurin.21.JDK

# macOS
brew install --cask temurin
```

After installing Java, close all terminal and VS Code windows, reopen them, and verify the installation:

```bash
java -version
```

Install the Chromium browser controlled by Playwright:

```bash
npx playwright install chromium
```

This normally only needs to be run once after cloning the repository. Before running an end-to-end test:

1. Pull the latest code and run `npm install` from the repository root.
2. Ensure Java and Playwright Chromium have been installed using the commands above.
3. Ensure the root `.env` file exists. Copy `.env.example` to `.env` if necessary; real Firebase credentials
   are not required by these emulator-backed tests.
4. Stop any existing `npm start` process so ports 3000 and 4000 are free. The test starts its own frontend
   and backend instances.

### Running Playwright tests

Run the tests for one user story in step-by-step debug mode by replacing `K2` with the assigned story ID:

```bash
npm run e2e -- K2 --debug
```

The first run can take one or two minutes while the frontend starts. Playwright opens the application in a
Chromium window and opens Playwright Inspector separately. Use **Step over** in the Inspector to execute one
action at a time, or **Resume** to let the test finish. The terminal reports the passing test count when the
run completes.

To run a particular test-case identifier directly through the emulators, use `--grep`:

```bash
npx firebase emulators:exec --only auth,firestore --project demo-connectsphere "npx playwright test --debug --grep TC-717"
```

Other useful commands are:

```bash
npm run e2e                 # run every Playwright test
npm run e2e -- K2           # run one story without the Inspector
npm run e2e:ui              # open Playwright's interactive test UI
```

The system runs locally and is not deployed; the architecture diagram is in
[`Diagrams/`](Diagrams/).

## Manual testing

Manual tests run against the local Firebase **emulators**, loaded with a fixed baseline, never against the
shared team project. Besides `npm install`, they need Java 11 or newer on your PATH (the emulators are a Java
program). No `.env` values are needed: the scripts point both workspaces at the emulators themselves.

```bash
npm run manual:start   # emulators + baseline seed + backend :4000 + frontend :3000
npm run manual:seed    # in a second terminal: reset to the baseline, with the app still running
```

1. Stop any `npm start` first; `manual:start` uses the same ports.
2. Run `npm run manual:start` and wait for the frontend to compile, then open http://localhost:3000.
3. **Before each test case**, run `npm run manual:seed`, then reload the page and sign in again. The seed wipes
   every emulator account and document and reloads the baseline, so each case starts from the same state
   whatever the last one changed.
4. Ctrl+C in the `manual:start` terminal stops everything and discards the emulator data.

The baseline is defined in [`manual-tests/seed-baseline.mjs`](manual-tests/seed-baseline.mjs):

- **Accounts:** 13, one or more per role. Organisers and staff sign in on the **Corporate** tab, attendees on
  **Individuals**. Every account uses the password `ConnectSphere#2026`.

  | Role | Email |
  | --- | --- |
  | Event Organiser | `organiser1@manual.test`, `organiser2@manual.test` |
  | Event Coordinator | `coordinator1@manual.test`, `coordinator2@manual.test` |
  | Event Coordinator Lead | `lead@manual.test` |
  | Venue Staff | `venuestaff1@manual.test`, `venuestaff2@manual.test` |
  | Technical Support Staff | `tech@manual.test` |
  | Safety Officer | `safety@manual.test` |
  | Attendee | `attendee1@manual.test` … `attendee4@manual.test` |

- **Venues and equipment:** 4 venues, each with its Venue Staff owner, setup and turnaround times and opening
  hours, plus stock for every equipment type.
- **Events:** 22 events covering every status, each set up for particular stories — for example an expired
  hold, two booking requests competing for one room, a full event with a waiting list, and a Confirmed event
  that has already ended.
- **Dates:** relative to the day you seed, in Singapore time, so the data stays valid whenever a test runs. The
  seed prints each event's date for that run.

The seed refuses to run unless it is talking to an emulator on localhost.

## Layout

```
package.json             npm workspace root — install and run from here
frontend/                the React app (:3000)
  src/
    app/                 App.js auth gate · Workspace.js role shell · routes.js hash format · Icon.js
    domain/              roles · portals · accounts · events — plain rules, no React or Firebase
    features/            one folder per epic, each owning its pages, components and *Api.js data access
      auth/  events/  venues/  equipment/  safety/  registrations/  changeRequests/  notifications/
    components/          UI shared across features
    lib/firebase.js      initialises Firebase; only *Api.js modules use what it exports
    sandbox/             early Firebase spike screens; not imported by the app
  public/
backend/                 the service layer (:4000) — see backend/README.md
  src/index.js           Express app, /api/health
  src/services/          event · venue · equipment · registration · arrangements
  scripts/               one-off seed and maintenance scripts (dry run unless given --write)
  testing/               Firestore-emulator harness and fixtures for the integration tests
e2e/                     Playwright story tests, one per backlog story — see e2e/README.md
manual-tests/            manual-test baseline seed and emulator launcher (npm run manual:start)
Diagrams/                architecture diagram, C4 diagrams, database schema
docs/                    requirements, test cases, design system, ADRs — see docs/README.md
.github/workflows/       CI (lint and every test suite)
.env                     gitignored — one file for both workspaces, ask the team for the values
.env.example             committed template, no values in it
firestore.rules          server-side authorisation — part of every feature
firebase.json
CLAUDE.md                the rules for changing this repo — read before you start
```

Screens never call Firebase or `fetch` themselves. Each feature's `*Api.js` modules are its data access: some
use the browser Firebase SDK, guarded by `firestore.rules`, and some call a backend service under `/api/*`.
[ADR 0002](docs/adr/0002-frontend-data-access.md) says which and why.

Stack: Create React App (react-scripts 5) with React 19, Firebase Auth and Firestore, plain CSS.
Navigation is hash-based, owned by `app/routes.js`; there is no router library.

## Contributing

Work on a branch named after the story (`H6-SCRUM-144-join-waiting-list`) and merge it into `main` through a
pull request, so CI has run lint and the tests before it lands. Pull before you start and before you push, and
keep commits small enough that a conflict is a minute's work rather than an evening's.

Put the backlog story ID and the Jira ticket ID at the front of every commit message
(`B6; SCRUM-nn; save an incomplete request as a draft`) — the commit message is where story-to-code
traceability is recorded, and it is marked.

A story's acceptance criteria in `docs/Final Product Backlog.csv` are its definition of done. Read them before
starting, and check `docs/Week 7 Customer Changes.pdf` and `docs/customer-qa-session2-answers.md` — the
Week 7 stories (A6–A7, E9–E11, F9–F16, K, L) override parts of earlier ones, and the older stories were never
reconciled with the second customer Q&A. `docs/README.md` lists which story replaces which.

Scope rules, the event statuses, workflow invariants and the current open questions are in
[`CLAUDE.md`](CLAUDE.md).

## Team

Christy · Jesslyn · Kelvin · Leonard · ShiHan
