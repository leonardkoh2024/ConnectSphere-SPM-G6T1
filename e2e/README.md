# End-to-end story tests (Playwright)

One test per backlog story, A1 to L4. Each one drives the real app in Chrome the way its users would,
role by role, and checks the story's acceptance criteria as named steps (`AC1: …`).

Everything runs against the Firebase **emulators** — a throwaway Auth and Firestore on your own machine,
loaded with the real `firestore.rules`. The shared team project is never touched: the frontend switches to
the emulators when `REACT_APP_USE_EMULATORS=true`, and `global-setup.js` refuses to run without them.

## Running

From the repo root. Stop any `npm start` first — the tests start their own copy of the app on 3000/4000.
Java 11+ must be on your PATH for the emulators.

```
npm run e2e:ui                 # the Playwright window: pick a story, watch it run step by step
npm run e2e                    # every story, no window
npm run e2e -- B9              # one story, by backlog ID
npm run e2e -- B9 --debug      # one story, paused before each action (Step over to advance)
npm run e2e -- B9 --headed     # one story in a visible Chrome window
npx playwright show-report     # the report of the last run
```

`SLOWMO=800` (milliseconds) slows every click and keypress in headed runs. A full run takes 40–60 minutes:
most stories first walk an event through submission, assignment, review and booking.

## Layout

```
e2e/
  global-setup.js     wipes the emulators, then seeds the test users, venues and equipment
  test-users.js       one account per role (plus a second organiser, coordinator, venue staff, attendees)
  catalogue.js        the mock venues and equipment inventory
  helpers/app.js      signing in, moving between screens, filling the event request form
  helpers/flows.js    moving an event along its workflow: submit → assign → approve → book → safety check
  helpers/db.js       read-only emulator lookups, and the two "time passes" steps (D5, F16)
  stories/            one spec per epic; each story is a `test.describe(...story("B9", "…"))`
  run.js              `npm run e2e` — starts the emulators, forwards a story ID as a filter
```

Each test creates its own events with unique names and dates, so stories do not depend on each other and can
run alone. Two stories cannot wait for real time to pass, so they move a date in the emulator instead:
D5 (an event's end has passed) and F16 (a hold's expiry has passed).

## Writing a new story test

1. Read the story's acceptance criteria in `docs/Final Product Backlog.csv`.
2. Get the event into the state the story starts from with `helpers/flows.js` (`newApprovedEvent`,
   `newPlannedEvent`, `newConfirmedEvent`, `newRegistrationEvent`, …).
3. Do the story's action through the screens, one `test.step` per criterion.
4. To find the right buttons and fields: `npm run e2e:codegen` with the app running, or read the snapshot
   Playwright saves when a step fails.
5. Give the test the next free TC ID and add its row to `docs/test-cases.md`.
