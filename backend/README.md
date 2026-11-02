# backend

Express service layer, on **:4000**. Started together with the frontend by `npm start` at the repo root.
Source: <https://github.com/leonardkoh2024/ConnectSphere-SPM-G6T1>

```
npm start              # from the repo root: runs this and the frontend together
npm run start:backend  # this alone
npm run test:backend   # from the repo root — node's built-in test runner, no Firestore needed
curl localhost:4000/api/health
```

## Services

Five services are mounted, listed in `src/services/index.js`. Each owns its path prefix and its Firestore
collections, and the health endpoint reports them.

| Service | Prefix | Stories | What it does |
| --- | --- | --- | --- |
| `event` | `/api/events` | D5, B10 | Completes a Confirmed event once its end has passed; tells an organiser the venues approved for their event |
| `venue` | `/api/venues` | E3, E11, F5, F10, F15, F16 | Venue unavailability, booking rejection, conflict re-checks, hold expiry |
| `equipment` | `/api/equipment` | G3, G4, J5, J6 | Equipment catalogue, reservations, request line amendments, notices to Technical Support |
| `registration` | `/api/registrations` | H1–H7 | Open events, register, withdraw, waiting list, invitations, organiser settings and attendee list |
| `arrangements` | `/api/events` | I3 | Re-requests venue and equipment arrangements after a significant change |

Catalogue reads and most coordinator and organiser workflows go through the browser SDK instead, guarded by
`firestore.rules`. [ADR 0002](../docs/adr/0002-frontend-data-access.md) says which path a feature uses and why.

All services use the Firebase **Admin** SDK (`firebase-admin`), not the client SDK the frontend uses — see
`src/lib/firebaseAdmin.js`. Every route that acts for a user requires that user's Firebase ID token and checks
the caller's role.

### Routes

| Method and path | Caller | Purpose |
| --- | --- | --- |
| `POST /api/events/:eventId/complete` | Event Coordinator (assigned) | Mark a Confirmed event Completed |
| `GET /api/events/:eventId/venues` | Event Organiser (own event) | Names of the venues approved for the event |
| `POST /api/events/:eventId/rerequest-arrangements` | Event Coordinator | Flag affected arrangements for re-request after a significant change |
| `POST /api/events/:eventId/registration-capacity` | Event Coordinator | Save a lower registration capacity after acknowledgement |
| `PUT /api/venues/unavailability` | Venue Staff | Mark a venue unavailable and flag affected bookings |
| `POST /api/venues/bookings/:bookingId/reject` | Venue Staff | Reject a booking with a reason |
| `POST /api/venues/:venueId/recheck-conflicts` | Venue Staff | Re-check bookings after setup or turnaround times change |
| `POST /api/venues/workflows/refresh` | Event Coordinator or Venue Staff | Process lapsed holds and re-check booking conflicts |
| `GET /api/equipment/catalogue` | Technical Support Staff | Equipment types and counts |
| `POST /api/equipment/reservations` | Technical Support Staff | Reserve equipment for a request |
| `POST /api/equipment/reservations/:reservationId/release` | Technical Support Staff | Release a reservation |
| `PATCH /api/equipment/requests/:eventId/lines/:lineIndex` | Technical Support Staff | Amend a request line, with a note |
| `POST /api/equipment/requests/:eventId/lines/:lineIndex/unable-to-fulfill` | Technical Support Staff | Resolve a line as unable to fulfil, with a reason |
| `POST /api/equipment/requests/:eventId/notify-technical-support` | Event Coordinator | Tell Technical Support about a saved or changed request |
| `POST /api/equipment/requests/:eventId/notify-confirmed` | Safety Officer | Tell Technical Support the event is Confirmed |
| `POST /api/equipment/events/:eventId/cancel-reservations` | Event Coordinator | Release an event's reservations |
| `GET /api/registrations/open-events` | Attendee | Events open for registration, with places left |
| `GET /api/registrations/mine` | Attendee | The caller's own registrations |
| `POST /api/registrations/events/:eventId/register` | Attendee | Take a place |
| `POST /api/registrations/events/:eventId/withdraw` | Attendee | Give up a place or leave the waiting list |
| `POST /api/registrations/events/:eventId/waitlist` | Attendee | Join the waiting list of a full event |
| `POST /api/registrations/events/:eventId/invitation/accept` | Attendee | Accept an offered place |
| `POST /api/registrations/events/:eventId/invitation/decline` | Attendee | Decline an offered place |
| `GET`/`PUT /api/registrations/events/:eventId/settings` | Event Organiser (own event) | Registration window and capacity |
| `GET /api/registrations/events/:eventId/attendees` | Event Organiser (own event) | Attendee list |

## How the key workflows behave

**Event completion (D5).** Verifies the caller's coordinator role and current assignment, checks the Confirmed
event's Singapore end instant against the server clock, then updates only the event's status and timestamps and
appends an event-history row in one transaction. It does not touch bookings, reservations or registrations.

**Venue unavailability (E11).** Staff may mark a venue unavailable even over approved bookings. The service lists
the affected bookings, asks for confirmation, then flags them and notifies the coordinator. Nothing is cancelled
or moved, and a Confirmed event returns to Planning until a replacement venue is approved.

**Booking rejection (F5).** Verifies the caller manages the venue, then records the terminal reasoned decision,
the event history entry and the coordinator's notification in one transaction. A rejection cannot be overridden.

**Tentative holds (F15, F16).** A hold expires three working days after it is placed, Singapore time. Expired
holds are processed server-side by `POST /api/venues/workflows/refresh`, which the app calls whenever a
coordinator or Venue Staff loads the venue queues. An active or expired hold never counts as an approved
booking.

**Equipment (G3, G4).** Reservation creation checks the Pending request, pooled inventory, overlapping
reservations, unavailability and approved venue occupied windows in one transaction, reading venue windows
through the venue service's approved-booking contract. Browsers can read for availability checks but cannot
write reservations or inventory (`firestore.rules`). Amendments and unable-to-fulfil resolutions write an
`equipment_request_history` record; a request becomes `ARRANGED` only when every line is reserved or
explicitly resolved.

**Technical Support notices (J5).** A coordinator's browser cannot list Technical Support accounts, so this
service writes the `EQUIPMENT_REQUEST_RAISED`, `EQUIPMENT_REQUEST_AMENDED`, `ON_SITE_SUPPORT_REQUIRED` and
`ON_SITE_SUPPORT_CHANGED` notices to every active Technical Support user. It keeps what it last told them in
`equipment_request_notices/{eventId}` (Admin SDK only) and sends only what changed, so asking twice sends once.

**Registration (H2–H7).** A registration is created only here: `firestore.rules` give no browser a create,
update or delete on `registrations`, since a rule cannot count an event's places. Each action is one
transaction.

- Register: checks the window, status and flag, refuses a duplicate, counts `REGISTERED` places and writes
  `registrations/{eventId}_{attendeeId}`. Refusals answer 409 with a `reason`; an unknown event answers 404.
- Withdraw: sets the caller's place to `WITHDRAWN`, which frees it at once. Refused after the event starts or
  once it is Completed, Cancelled or Rejected.
- Waiting list: joining is allowed only while the event is full. Position is never stored; it is worked out
  from join times, first come first served.
- Invitations: every registration transaction ends by offering any free place to the first people waiting.
  An offer lasts 48 hours or until the event starts, whichever is sooner, and holds the place. Accepting
  registers the attendee; declining takes them off the list and passes the place on. Only the person offered
  the place is notified (J7 AC2, H7 AC1).
- Rules shared with the frontend are in `frontend/src/domain/*.mjs`.

**Significant changes (I3).** After a coordinator saves a change to pax, venue or duration, this service flags
the live venue bookings, equipment reservations and equipment request for re-request, moves a Confirmed event
back to Planning, and notifies the Venue Staff and Technical Support who hold them. It never cancels, releases
or changes the status of an arrangement. It also re-checks the registration window and capacity, and flags
registration for review without editing or closing it.

## Cross-service access

No service reads or writes another's collections except through a service contract or the narrow exceptions
below.

- `equipment` reads `coordinator_id` and `name` from `events/{eventId}` and `users`, and creates `notifications`
  documents (J5, J6), in the same transaction as the decision it reports. See
  `src/services/equipment/outcomeNotifications.js` and `supportNotifications.js`.
- `registration` reads `events` for the open-events list, because an Attendee's browser has no read on
  `events` (A4/A5). It returns only public fields. Venue names come through the venue service's
  `getApprovedEventVenueNames` contract in `src/services/venue/approvedEventBookings.js`.
- `venue` writes `event_history` and `notifications` with a booking decision so the outcome cannot be partly
  applied by a browser write.

`firestore.rules` stays at the repo root. Authorisation is enforced there regardless of what lives in this
folder, because the browser can still reach Firestore directly.

## Testing

| Command (from the repo root) | Runs |
| --- | --- |
| `npm run test:backend` | Unit tests, `node --test`, against a mocked Firestore. No credentials needed. |
| `npm run test:coverage --workspace backend` | The same, failing below 100% coverage, as CI does. |
| `npm run test:integration` | Starts the Firestore emulator, runs every `*.integration.js`, shuts it down. Needs Java 11+. |

Each integration test starts from the same data: `useFreshBaseline` in `testing/firestoreEmulator.js` clears the
emulator and re-seeds `testing/fixtures.js` before every test. Copy `docs/service.integration.TEMPLATE.js` to
write one; see the [emulator testing guide](../docs/emulator-testing-guide.md).

To use the Admin SDK against a live project, point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key
from Firebase console > Project settings > Service accounts (see `.env.example`). Never commit the key.

## Scripts

`scripts/` holds one-off seed and maintenance scripts for the shared Firebase project. Each prints what it would
write and stops; nothing is written without `--write`.

| Script | Purpose |
| --- | --- |
| `seedEquipmentInventory.mjs` | Held counts for every equipment type (our own mock data) |
| `seedOperatingHours.mjs` | Spread of opening days across the mock venue catalogue |
| `backfillVenueStaffNames.mjs` | Copy each Venue Staff name onto their venue's assignment |
| `normaliseRoles.mjs` | Rewrite every `users/{uid}.role` to its canonical value |
| `seedHappyPathEvent.mjs` | One event that a real venue satisfies, for the E8 happy path |
| `seedOpenRegistrationEvents.mjs` | Demo events for the attendee Browse events screen (`--remove` undoes it) |

## Adding a service

Create `src/services/<name>/index.js` exporting an Express router, import it in `src/services/index.js`, and
add a row to `SERVICES`. Nothing else changes: `src/index.js` mounts whatever is in that list.

One folder per service, each owning its path prefix and its Firestore collections, so no two services write the
same collection. The services share one process so `npm start` brings the whole system up. Because none touches
another's routes or collections, they could be split into separate processes without a rewrite.
