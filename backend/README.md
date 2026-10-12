# backend

Express service layer, on **:4000**. Started together with the frontend by `npm start` at the repo root.

Three services are mounted: `coordinatorAssignment` (C1 / SCRUM-102), `venue` (E3) and `equipment` (G3). Catalogue reads remain
in the browser through `frontend/src/lib/firebase.js`; the venue service authenticates staff and transactionally
records unavailability after checking approved bookings.

```
npm start              # from the repo root: runs this and the frontend together
npm run start:backend  # this alone
npm run test:backend   # from the repo root — node's built-in test runner, no Firestore needed
curl localhost:4000/api/health
```

Both `coordinatorAssignment` and `venue` use the Firebase **Admin** SDK (`firebase-admin`), not the client SDK
the frontend uses — see `src/lib/firebaseAdmin.js`. Their tests run against mocked Firestore, so no credentials
are needed to run them. To exercise either service against a live project, point `GOOGLE_APPLICATION_CREDENTIALS`
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
| `registration`          | attendee registrations, waiting list                       | —    |
| `notification`          | inbox items                                                | —    |

They share one process for now, which is what lets `npm start` bring the whole system up. Because no service
touches another's routes or collections, splitting them into separate processes later is a deployment change
rather than a rewrite — so keep that separation even when it would be quicker not to.

**Scoped exception — `coordinatorAssignment` also writes two fields on `events`.** Epic C has no service of
its own in the table above, and `event` (the collection's actual owner) is not built yet. Rather than stub out
an `event` service just to host one write, `coordinatorAssignment` is allowed to write exactly
`coordinator_id` and `assigned_at` on an `events` document it does not otherwise own — nothing else on that
collection. Revisit this once the `event` service exists; the natural move then is for `event` to own the
write and `coordinatorAssignment` to expose only the rotation decision.

`firestore.rules` stays at the repo root. Authorisation is enforced there regardless of what lives in this
folder, because the browser can still reach Firestore directly.

The venue service exposes `PUT /api/venues/unavailability`. It requires a Firebase ID token from a Venue
Staff account assigned through `venue_staff/{venueId}` and saves staged additions and releases together,
refusing additions that overlap an approved booking.

The equipment service exposes `POST /api/equipment/reservations` and
`POST /api/equipment/reservations/{reservationId}/release`. Both require a Technical Support Staff Firebase ID
token. Reservation creation checks the Pending equipment request, pooled inventory, overlapping reservations,
unavailability and approved venue occupied windows in one Admin Firestore transaction. It obtains the venue
window through the Venue service's approved-booking read contract rather than querying that collection itself.
Browser clients have read access for availability checks, but reservation and inventory writes are denied by
`firestore.rules`.

**Week 7 changes affect the mounted services.** K1 replaces C1's automatic assignment with an unassigned
queue that the Event Coordinator Lead assigns from, so `coordinatorAssignment`'s rotation (ADR 0001) is no
longer the release 1 behaviour. E11 replaces E3 criterion 3, so the venue service's refusal of unavailability
that overlaps an approved booking must become "list the affected bookings, confirm, and flag them". See
`docs/README.md` for every story the Week 7 changes override.
