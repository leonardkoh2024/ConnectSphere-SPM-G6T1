# ConnectSphere — Event Planning and Venue Booking System

IS212 Software Project Management, AY2026/27 T1 — Group 6, Team 1.

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

The system is not deployed and does not need to be — the customer confirmed that running locally plus an
architecture diagram is what gets submitted.

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
    sandbox/             unimported spike screens from the Firebase setup — safe to delete
  public/
backend/                 the service layer (:4000)
  src/index.js           Express app, /api/health
  src/services/index.js  service registry — add each service here
  src/services/*/        one folder per service, each owning its own collections
.env                     gitignored — one file for both workspaces, ask the team for the values
.env.example             committed template, no values in it
firestore.rules          server-side authorisation — part of every feature, not an afterthought
firebase.json
docs/                    requirements: Week 4 instructions, Week 7 changes, backlog, customer Q&A
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
