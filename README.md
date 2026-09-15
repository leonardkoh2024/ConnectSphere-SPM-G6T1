# ConnectSphere — Event Planning and Venue Booking System

IS212 Software Project Management, AY2026/27 T1 — Group 6, Team 1.

Release 1 of an event planning and venue booking system built for "ConnectSphere Event Services".
Event organisers submit event requests; a coordinator is assigned automatically, reviews the request, arranges
a venue and technical support, and confirms the event. Attendees register for events that are open to them.

The system has five roles and no administrator: Event Organiser, Event Coordinator, Venue Staff,
Technical Support Staff, Attendee.

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

The app needs a Firebase project. Create a `.env` in `frontend/` — it is gitignored, and the values must
never be committed or pasted into an issue or chat:

```
REACT_APP_FIREBASE_API_KEY=
REACT_APP_FIREBASE_AUTH_DOMAIN=
REACT_APP_FIREBASE_PROJECT_ID=
REACT_APP_FIREBASE_STORAGE_BUCKET=
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=
REACT_APP_FIREBASE_APP_ID=
```

Ask the team for the current project's values rather than creating your own, or your data will not line up
with everyone else's.

```bash
npm test           # React Testing Library, watch mode
npm run build      # production build into frontend/build/
```

Both run from the repo root and delegate to the frontend workspace.

The system is not deployed and does not need to be — the customer confirmed that running locally plus an
architecture diagram is what gets submitted.

## Layout

```
package.json             npm workspace root — install and run from here
frontend/                the React app (:3000)
  src/
    app/                 App.js auth gate · Workspace.js role shell · routes.js hash format · Icon.js
    domain/              roles · portals · accounts · events — plain rules, no React or Firebase
    features/            one folder per epic, each owning its pages and components
      auth/              LandingPage and the portal/registration form
      events/            EventRequestForm, EventList
    components/          UI shared across features
    lib/firebase.js      the only module that imports firebase/*
    sandbox/             unimported spike screens from the Firebase setup — safe to delete
  public/
  .env                   gitignored — ask the team for the values
backend/                 the service layer (:4000)
  src/index.js           Express app, /api/health
  src/services/index.js  service registry — add each service here
firestore.rules          server-side authorisation — part of every feature, not an afterthought
firebase.json
docs/                    requirements: Week 4 instructions, backlog, customer Q&A
CLAUDE.md                the rules for changing this repo — read before you start
```

Every Firestore and Auth call is still made from the browser; nothing server-side exists yet. Services move
into `backend/` as the stories that need them are picked up.

Stack: Create React App (react-scripts 5) with React 19, Firebase Auth and Firestore, plain CSS.
Navigation is hash-based, owned by `app/routes.js`; there is no router library.

## Contributing

We commit directly to `main` — no feature branches, no PRs. Pull before you start and before you push, and
keep commits small enough that a conflict is a minute's work rather than an evening's.

Put the backlog story ID at the front of every commit message (`B6: save an incomplete request as a draft`) —
with no PRs in the history, the commit message is the only place story-to-code traceability is recorded, and
it is marked.

A story's acceptance criteria in `docs/final-product-backlog.csv` are its definition of done. Read them before
starting, and check `docs/customer-qa-session2-answers.md` — the backlog predates the second customer Q&A and
has not been reconciled with it.

Scope rules, the nine event statuses, workflow invariants and the current open questions are in
[`CLAUDE.md`](CLAUDE.md).

## Team

Christy · Jesslyn · Kelvin · Leonard · ShiHan
