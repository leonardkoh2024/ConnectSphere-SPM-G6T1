# backend

Express service layer, on **:4000**. Started together with the frontend by `npm start` at the repo root.

No services exist yet — `src/services/index.js` is an empty registry. Every Firestore and Auth call is still
made from the browser by components in `frontend/src/`, through `frontend/src/lib/firebase.js`; services move
here as the stories that need them are picked up.

```
npm start              # from the repo root: runs this and the frontend together
npm run start:backend  # this alone
curl localhost:4000/api/health
```

## Adding a service

Create `src/services/<name>/index.js` exporting an Express router, import it in `src/services/index.js`, and
add a row to `SERVICES`. Nothing else changes — `index.js` mounts whatever is in that list, and the health
endpoint reports it.

One folder per service, each owning its own path prefix and its own Firestore collections, so that no two
services write to the same collection. The epics in Jira are the natural boundaries:

| Service        | Owns                                                      | Epic |
| -------------- | --------------------------------------------------------- | ---- |
| `auth`         | `users`                                                    | A    |
| `event`        | `events`, `event_history`, `event_venue_requirements`      | B–D  |
| `venue`        | venue catalogue, availability, bookings                    | E–F  |
| `equipment`    | equipment counts, reservations                             | G    |
| `registration` | attendee registrations, waiting list                       | —    |
| `notification` | inbox items                                                | —    |

They share one process for now, which is what lets `npm start` bring the whole system up. Because no service
touches another's routes or collections, splitting them into separate processes later is a deployment change
rather than a rewrite — so keep that separation even when it would be quicker not to.

`firestore.rules` stays at the repo root. Authorisation is enforced there regardless of what lives in this
folder, because the browser can still reach Firestore directly.
