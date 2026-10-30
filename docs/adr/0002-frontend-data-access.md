# ADR 0002 — Where the frontend reaches its data

Status: Proposed — for the team to accept or amend
Date: 2026-10-30
Story: A4 — see only what my role permits (the rule is graded server-side); applies to every epic

## Context

The frontend reaches data two ways, and both are in use:

- **Browser Firebase SDK.** The signed-in user's own token is attached, and `firestore.rules` decides what
  each read or write may touch. Most features work this way (events, venues, equipment, safety, change
  requests, notifications).
- **A backend service** under `/api/*` (`backend/src/services/`), using the Firebase Admin SDK. Today the
  venue, event, equipment, registration and arrangements services are called from the browser.

Until now nothing said which to use, and screens sometimes did their own Firestore work: the event request
form wrote five collections itself, the landing page created user profiles, and the event list ran its own
query. A screen that knows the collection layout has to change whenever that layout does, and its data
access can only be tested by rendering it.

## Decision

1. **Screens never talk to Firebase or `fetch` directly.** Each feature keeps its data access in `*Api.js`
   modules (with any shared helpers in `*ApiSupport.js`) beside its screens. A screen imports functions
   from those, and the tests mock at that seam or at `firebase/firestore`.
   The exceptions are the app shell's session handling: `app/App.js` listens for the signed-in user,
   `app/Workspace.js` signs out, and a screen may read `auth.currentUser` to know who is acting.

2. **The browser SDK is the default.** When `firestore.rules` can express who may do something, the
   feature uses the browser SDK and the rule is the boundary. The rule ships in the same commit as the code
   that relies on it.

3. **Use a backend service when the rules cannot carry the decision.** In particular when:
   - the check needs data the acting user may not read. For example, Venue Staff marking a venue unavailable
     must check approved bookings belonging to other people's events (E11).
   - the work has to happen even if nobody acts. For example, holds lapsing on time (F16) and bookings
     flagged after a venue's setup or turnaround time changes (F10).
   - the write must be consistent across documents that the rules cannot compare. For example, equipment
     counts, registration capacity and re-requesting arrangements after a significant change (I3).

   The frontend still calls the service through the feature's `*Api.js`, so a screen does not change when
   a step moves from the browser to the backend.

4. **A large `*Api.js` is split by workflow** and the original module re-exports the parts, so screens and
   tests keep one import path. See `features/venues/venuesApi.js` and `features/events/reviewApi.js`.

## Consequences

- Positive: a screen can be read without knowing the collection layout, and data access can be tested
  without rendering anything (`features/auth/authApi.test.js`). Moving a step to the backend touches only
  its `*Api.js`.
- Negative: two styles of data access remain. Anyone adding a feature has to decide which one it needs,
  using the criteria in point 3.
- Enforced by lint. `frontend/package.json` stops any file other than an `*Api.js` module, a test or the
  app shell from importing `firebase/*` or calling `fetch`, and CI runs `npm run lint`.
- In test files only, `import/first` is off: those files declare their `jest.mock` factories before
  importing the module under test, so they read in the order Jest actually runs them (Jest hoists the
  mocks either way).
