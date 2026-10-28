# backend

Express service layer, on **:4000**. Started together with the frontend by `npm start` at the repo root.

Five services are mounted: `coordinatorAssignment` (C1 / SCRUM-102), `event` (D5), `venue` (E3), `equipment` (G3) and `registration`
(H2 / SCRUM-140). Catalogue reads remain
in the browser through `frontend/src/lib/firebase.js`; the venue service authenticates staff and transactionally
records unavailability after checking approved bookings.

```
npm start              # from the repo root: runs this and the frontend together
npm run start:backend  # this alone
npm run test:backend   # from the repo root — node's built-in test runner, no Firestore needed
curl localhost:4000/api/health
```

The `coordinatorAssignment`, `event` and `venue` services use the Firebase **Admin** SDK (`firebase-admin`), not the client SDK
the frontend uses — see `src/lib/firebaseAdmin.js`. Their tests run against mocked Firestore, so no credentials
are needed to run them. To exercise these services against a live project, point `GOOGLE_APPLICATION_CREDENTIALS`
at a service-account key from Firebase console > Project settings > Service accounts — see `.env.example`.
`backend/scripts/seedCoordinators.js` seeds
the `coordinators` and `assignment_cursor` documents it needs; read that file before running it, since it
writes to whatever project your credentials point at.

## Adding a service

Create `src/services/<name>/index.js` exporting an Express router, import it in `src/services/index.js`, and
add a row to `SERVICES`. Nothing else changes — `index.js` mounts whatever is in that list, and the health
endpoint reports it.

One folder per service, each owning its own path prefix and its own Firestore collections, so that no two
services write to the same collection. The epics in Jira are the natural boundaries:

| Service                 | Owns                                                      | Epic |
| ----------------------- | --------------------------------------------------------- | ---- |
| `auth`                  | `users`                                                    | A    |
| `event`                 | `events`, `event_history`, `event_venue_requirements`      | B–D  |
| `coordinatorAssignment` | `coordinators`, `assignment_cursor`                        | C (C1 only) — superseded by K |
| `venue`                 | venue catalogue, availability, bookings                    | E–F  |
| `equipment`             | equipment counts, reservations                             | G    |
| `registration`          | attendee registrations, waiting list                       | H    |
| `notification`          | inbox items                                                | —    |

They share one process for now, which is what lets `npm start` bring the whole system up. Because no service
touches another's routes or collections, splitting them into separate processes later is a deployment change
rather than a rewrite — so keep that separation even when it would be quicker not to.

**Scoped exception — `coordinatorAssignment` also writes two fields on `events`.** Epic C has no service of
its own in the table above. The `event` service now handles D5 completion;
`coordinatorAssignment` continues to write exactly `coordinator_id` and `assigned_at` on an `events`
document, and no other event fields. Move that write when the C1 rotation is retired.

**Scoped exception — `equipment` reads `events` and creates `notifications`.** J6 (SCRUM-155) tells the
coordinator when an equipment request is arranged or a line cannot be fulfilled, and the notification is
written in the same transaction as that decision so the two never disagree. `notification` is not built
yet, so `equipment` reads `coordinator_id` and `name` from `events/{eventId}` and creates `notifications`
documents in the inbox's shape, and nothing else on either collection. See
`src/services/equipment/outcomeNotifications.js`. Revisit once `notification` exists.

**Scoped exception — `registration` reads `events`.** H2 (SCRUM-140) lists the events an Attendee can
register for, but an Attendee's browser has no read on `events` (A4/A5) and an event document holds far more
than an Attendee should see. `GET /api/registrations/open-events` (Attendee ID token required) therefore reads
the events with `registration_required == true`, keeps those open now by the shared rules in
`frontend/src/domain/openRegistration.mjs`, and returns only their public fields with the remaining places
(capacity less `REGISTERED` registrations). Venue names come through the venue service's
`getApprovedEventVenueNames` read contract in `src/services/venue/approvedEventBookings.js`, not a query of
its own. Each entry also carries the caller's own `registration_status`. The list writes nothing.

H3 (SCRUM-141) adds `POST /api/registrations/events/{eventId}/register` (Attendee ID token required). It is
the only way a registration is created: `firestore.rules` give no browser a create, update or delete on
`registrations`, because a rule cannot count an event's places or see a second registration by the same
attendee. One Admin transaction reads the event, checks the window, status and flag (H1 AC4, through
`registrationAttemptRefusal` in `frontend/src/domain/registrationWindow.mjs`), refuses a duplicate, counts the
`REGISTERED` places and writes `registrations/{eventId}_{attendeeId}`, with the attendee in `attendee_id`. A
refusal answers 409 with a `reason` (`closed`, `not_open_yet`, `status`, `not_enabled`, `no_capacity`, `full`,
`already_registered`), or 404 `not_found`. See `src/services/registration/register.js`.

H4 (SCRUM-142) adds `GET /api/registrations/mine` (Attendee ID token required): the caller's own registrations,
queried by `attendee_id` only, each with its event's name, description, date, window, approved venues and the
status shown. A registration on a cancelled event reads `CANCELLED`, since D4 cancels the event without
touching its registrations; the event's cancellation reason and internal fields are not sent. The rules live
in `frontend/src/domain/myRegistrations.mjs`. See `src/services/registration/myRegistrations.js`.

H5 (SCRUM-143) adds `POST /api/registrations/events/{eventId}/withdraw` (Attendee ID token required). One Admin
transaction finds the caller's `REGISTERED` record for the event (under `{eventId}_{attendeeId}` or an older
id) and sets it to `WITHDRAWN` with a server `withdrawn_at`. That gives the place back at once, because H3
counts only `REGISTERED`. It is refused with nothing written when the caller holds no Registered place
(`not_registered`), or the event has started (`event_started`) or is completed, cancelled or rejected
(`event_closed`). There is no deadline before the start. The waiting list is not touched: inviting the next
person is H7's. Each `/mine` entry also carries `active` and `can_withdraw`, from `withdrawalRefusal` in
`frontend/src/domain/myRegistrations.mjs`.

H6 (SCRUM-144) adds `POST /api/registrations/events/{eventId}/waitlist` (Attendee ID token required). In one
Admin transaction it refuses unless the event is taking registrations (the same window check as H3) and is
full (`places_available` otherwise). It also refuses when the caller already holds a place
(`already_registered`, `already_waitlisted`). Otherwise it sets `registrations/{eventId}_{attendeeId}` to
`WAITLISTED` with a server `waitlisted_at`. The position is never stored: it is worked out from join times,
first come first served, each time `/mine` or `/open-events` is read (`frontend/src/domain/waitingList.mjs`).
Registering while waitlisted is refused (`waitlisted`), so nobody holds both statuses and nobody steps past
the queue when a place frees.
The H5 withdraw route also takes a waitlisted place off the list. That frees no place in the event, and
everyone behind moves up.

H7 (SCRUM-145) offers freed places to the waiting list. Every registration transaction (register, withdraw,
join, accept, decline) ends by offering any place neither taken nor held to the first people waiting, in queue
order. Each offer is written on their record (`invited_at`, `invitation_expires_at`: 48 hours, or the event
start if sooner) along with a `WAITLIST_PLACE_OFFERED` notification. An offered place is held: nobody else can
register into it. `POST …/events/{eventId}/invitation/accept` registers the attendee while the offer stands.
`POST …/invitation/decline` takes them off the list, and the place moves to the next person. A lapsed offer
leaves the attendee on the list; the place passes on at the next action on the event, or when someone waiting
opens `/mine`. There is no timer. The person who let it lapse is offered again only when another place frees
after the lapse. This notice replaces J7's `PLACE_OPENED` broadcast to everyone waiting: only the person
offered the place is invited to apply (J7 AC2, H7 AC1). Rules: `frontend/src/domain/waitingList.mjs`.

**Scoped exception — `venue` writes `event_history` and `notifications`.** F5 rejection commits the
booking decision, audit entry and notification together. The venue endpoint uses Admin Firestore for
this transaction so the outcome cannot be partially applied by a browser write.

`firestore.rules` stays at the repo root. Authorisation is enforced there regardless of what lives in this
folder, because the browser can still reach Firestore directly.

The `event` service handles completion (`POST /api/events/:eventId/complete`), and tells an event's own organiser the names of the venues approved for it (`GET /api/events/:eventId/venues`, B10), through the venue service's `getApprovedEventVenueNames` contract.
It verifies the caller's coordinator role and current assignment, checks the confirmed
event's Singapore end instant against the server clock, then updates only the event's
status/timestamps and appends an event-history row atomically. It does not modify or
delete bookings, reservations, registrations or other event records.

The venue service exposes `PUT /api/venues/unavailability` and
`POST /api/venues/bookings/{bookingId}/reject`. Both require a Firebase ID token from Venue Staff.
Rejection verifies the caller owns the venue assignment and atomically records the terminal
reasoned decision, event history and coordinator notification through the Admin SDK, without
changing the venue's occupied window.

The equipment service exposes `POST /api/equipment/reservations` and
`POST /api/equipment/reservations/{reservationId}/release`. Both require a Technical Support Staff Firebase ID
token. Reservation creation checks the Pending equipment request, pooled inventory, overlapping reservations,
unavailability and approved venue occupied windows in one Admin Firestore transaction. It obtains the venue
window through the Venue service's approved-booking read contract rather than querying that collection itself.
Browser clients have read access for availability checks, but reservation and inventory writes are denied by
`firestore.rules`.

G4 adds `PATCH /api/equipment/requests/{eventId}/lines/{lineIndex}` for noted type/quantity amendments and
`POST /api/equipment/requests/{eventId}/lines/{lineIndex}/unable-to-fulfill` for reasoned line resolution.
Both write an `equipment_request_history` audit record with the actor and server timestamp. The coordinator
can read that history only for currently assigned events; the request moves to `ARRANGED` only when every
line is reserved or explicitly resolved.

J5 adds `POST /api/equipment/requests/{eventId}/notify-technical-support`, called by the coordinator's browser
after it saves an equipment request. It requires an Event Coordinator Firebase ID token and checks the caller
coordinates the event. A coordinator's browser cannot list Technical Support accounts, so this service writes
the notices (`EQUIPMENT_REQUEST_RAISED`, `EQUIPMENT_REQUEST_AMENDED`, `ON_SITE_SUPPORT_REQUIRED`,
`ON_SITE_SUPPORT_CHANGED`) to every active Technical Support user. It keeps what it last told them in
`equipment_request_notices/{eventId}` (no browser rule; Admin SDK only) and sends only what changed since, so
asking twice sends once. See `src/services/equipment/supportNotifications.js`. Like `outcomeNotifications.js`,
it creates `notifications` documents and reads `users` and `events`; revisit once `notification` exists.

**Week 7 changes affect the mounted services.** K1 replaces C1's automatic assignment with an unassigned
queue that the Event Coordinator Lead assigns from, so `coordinatorAssignment`'s rotation (ADR 0001) is no
longer the release 1 behaviour. E11 replaces E3 criterion 3, so the venue service's refusal of unavailability
that overlaps an approved booking must become "list the affected bookings, confirm, and flag them". See
`docs/README.md` for every story the Week 7 changes override.
