# Test cases

Every test case the repository currently holds, in the module's test-case format. Each row maps to one
automated test unless its remark says otherwise.

**Running them**

```
npm test                     # from the repo root — all frontend suites
npm test -- --testPathPattern EventRequestForm      # one suite
npm run test:backend         # from the repo root — the backend's own suite (node's test runner)
```

**Test case ID allocation** — `TC-014`, `TC-015` and `TC-016` were already in use in the code before this
document existed, and keep their numbers. `TC-001` to `TC-013` belong to the team's earlier test plan and are
reserved here so nothing collides. New IDs run from `TC-017`.

**Actual Result / status** — recorded from a run of `npm test` and `npm run test:backend` on **5 Oct 2026**
(301 frontend tests across 17 suites, 15 backend tests). Re-run and update the two right-hand columns before
submitting.

The rules themselves live in `frontend/src/domain/eventRequest.js`, which holds no React and no Firebase, so
they can be read next to the acceptance criteria and move into the service layer unchanged.

## Traceability

| Story | Jira | Summary | Test cases |
| --- | --- | --- | --- |
| A4 | SCRUM-90 | See only what my role permits | TC-014, TC-015 |
| A5 | SCRUM-91 | See only events related to me | TC-016 |
| A1–A3 | — | Accounts, portals and sign-in rules | TC-048 – TC-057 |
| B1 | SCRUM-92 | Create an event request with the core details | TC-017 – TC-029, TC-067, TC-068 |
| B4 | SCRUM-95 | State the equipment my event needs | TC-047 |
| B6, B7 | — | Save and continue a draft; drafts distinguishable by status | TC-058 – TC-063 |
| B9 | SCRUM-100 | Submit an event request | TC-030 – TC-046, TC-064 – TC-066, TC-069 |
| — | — | The form marks what is compulsory | TC-070 |
| — | — | Confirmations appear as toasts | TC-071 |
| C1 | SCRUM-102 | Have submitted events assigned to a coordinator automatically | TC-072 – TC-080 |
| E8 | SCRUM-124 | Be stopped before booking an unsuitable venue | TC-112 – TC-174 |
| E4 | SCRUM-120 | See when a venue is free | TC-200 – TC-249 |
| J6 | SCRUM-155 | Be told the outcome of my booking and equipment requests (AC1: approval only — rejection awaits F5) | TC-313 – TC-346 |
| E7 | — | Know whether a venue actually suits the event | TC-112 – TC-116 |
| C6 | SCRUM-TBD | Approve a submitted request | TC-112 – TC-117 |
| C2 | SCRUM-103 | See the events I am responsible for | TC-118 – TC-128, TC-347 |
| G1 | SCRUM-TBD | Record the equipment an event needs | TC-285 – TC-289 |
| G2 | SCRUM-TBD | Know whether enough equipment is free | TC-290 – TC-297 |
| G3 | SCRUM-TBD | Reserve equipment for an event | TC-298 – TC-306 |
| G4 | SCRUM-TBD | Amend or refuse an equipment request | TC-307 – TC-312 |

Suites: `frontend/src/features/events/EventRequestForm.test.js` (TC-017 – TC-047, TC-064 – TC-070),
`frontend/src/features/events/EventList.test.js` (TC-016, TC-058 – TC-063),
`frontend/src/app/Workspace.test.js` (TC-014, TC-015, TC-071), `frontend/src/app/App.test.js` (TC-048 – TC-057),
`frontend/src/security/firestoreRules.test.js` (TC-015, TC-016, TC-080),
`frontend/src/domain/coordinatorAssignment.test.js` (TC-073, TC-074, TC-075),
`backend/src/services/coordinatorAssignment/assignCoordinator.test.js` (TC-072, TC-076, TC-077, TC-078, TC-079),
`frontend/src/features/venues/VenueBookingRequest.test.js` (TC-112 – TC-174 — E8 in one file: the unit
tests over `domain/venueSuitability.js`, the functional tests over the screen, and the `firestore.rules`
assertions),
`frontend/src/domain/venueCalendar.test.js` (TC-200 – TC-217, TC-233 – TC-243),
`frontend/src/features/venues/VenueCalendar.test.js` (TC-218 – TC-228, TC-231), `VenueCatalogue.test.js` (TC-229),
`VenueSearch.test.js` (TC-230), `features/venues/components/MultiSelectDropdown.test.js` (TC-244 – TC-249) and
`frontend/src/app/Workspace.test.js` (TC-232) — E4,
`frontend/src/domain/equipmentRequests.test.js` (TC-285, TC-286),
`frontend/src/features/equipment/EquipmentRequestsScreen.test.js` (TC-285 – TC-288) and
`frontend/src/security/firestoreRules.test.js` (TC-289) — G1;
`frontend/src/domain/equipmentAvailability.test.js` (TC-290 – TC-294),
`frontend/src/features/equipment/EquipmentRequestsScreen.test.js` (TC-295, TC-296) and
`frontend/src/security/firestoreRules.test.js` (TC-297) — G2;
`frontend/src/domain/equipmentAvailability.test.js` (TC-299, TC-302),
`frontend/src/features/equipment/EquipmentRequestsScreen.test.js` (TC-298, TC-300, TC-301, TC-305),
`frontend/src/features/equipment/equipmentApi.browser.test.js` (TC-301, TC-303, TC-305),
`backend/src/services/equipment/reservations.test.js` (TC-300, TC-301, TC-303, TC-305),
`backend/src/services/equipment/service.test.js` (TC-304) and
`frontend/src/security/firestoreRules.test.js` (TC-304) — G3; TC-306 is in
`frontend/src/domain/equipmentAvailability.test.js`.
`backend/src/services/equipment/requests.test.js` (TC-307 – TC-310, TC-312),
`frontend/src/features/equipment/equipmentApi.browser.test.js` (TC-307, TC-309),
`frontend/src/features/equipment/EquipmentRequestsScreen.test.js` (TC-307, TC-309, TC-311) and
`frontend/src/security/firestoreRules.test.js` (TC-311) — G4.

> **Gap, not an omission of E8:** stories E1–E6 (venue catalogue, availability, search and filters) are
> implemented and tested — `domain/venueSearch.test.js`, `features/venues/VenueCatalogue.test.js`,
> `VenueSearch.test.js`, `VenueAvailability.test.js` and
> `backend/src/services/venue/unavailability.test.js` hold roughly TC-081 – TC-111 — but their rows were
> never added to this document. Someone owning those stories should backfill them.
`frontend/src/domain/venueSearch.test.js` (TC-112 – TC-114),
`frontend/src/features/venues/VenueSuitabilityForm.test.js` (TC-115, TC-116).

---

## G1 / SCRUM-TBD — Record the equipment an event needs

> As an Event Coordinator, I want to record the equipment required so that Technical Support knows what to
> arrange.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-285 | The coordinator starts from the organiser's equipment lines and can amend them | Assigned event has organiser equipment lines | Open its equipment request; change a technical requirement; submit | Original type and quantity prefill; amended line is submitted | As expected | Pass | AC1–AC2 |
| TC-286 | Every submitted request has at least one line with valid type and quantity | Coordinator is editing an equipment request | Submit no lines, an unsupported/missing type, or a zero, negative or fractional quantity; then submit a valid line | Invalid requests are blocked with a useful error; valid request proceeds | As expected | Pass | AC1, AC3 |
| TC-287 | The coordinator can manage requests for their active assigned events | Coordinator has an active assigned event | Open Equipment requests and choose the event | Its editor opens; an existing request can be amended | As expected | Pass | AC2 |
| TC-288 | Submitting creates a Pending Technical Support queue item | Coordinator submits at least one valid line | Open the Technical Support equipment queue | The Pending request appears with its event window and requested lines | As expected | Pass | AC4 |
| TC-289 | The assigned coordinator alone can create or amend the request; Technical Support can read only Pending items | firestore.rules in force | Inspect the event_equipment and equipment_requests rules | Assigned coordinator can prefill and submit; the queue is role/status gated; no client delete is allowed | As expected | Pass | AC2, AC4 — assert via `firestoreRules.test.js` |

---

## G2 / SCRUM-TBD — Know whether enough equipment is free

> As a member of Technical Support Staff, I want to check availability for the event's window so that I do not
> commit the same equipment twice.

The first supported catalogue model is pooled quantity per equipment type. Each
`equipment_inventory/{equipment_type}` document contains `total_quantity`; each overlapping
`equipment_reservations` and `equipment_unavailability` record contains `equipment_type`, `quantity`,
`start_datetime` and `end_datetime`. A reservation uses `status: RESERVED` while active. This is one of the
two models explicitly allowed by G2 AC4.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-290 | Free quantity subtracts concurrent reservations and unavailable stock from held inventory | 12 AUDIO held; 3 reserved and 2 unavailable overlap the same portion of the event window | Check availability for 4 AUDIO | 7 AUDIO are free; the result shows held, reserved and unavailable quantities at the most constrained time | As expected | Pass | AC1 |
| TC-291 | A request above free stock states the numeric shortfall | 12 AUDIO held; 5 reserved overlap; request is for 8 | Check availability | 7 are free and shortfall is reported as 1 | As expected | Pass | AC2 |
| TC-292 | Non-overlapping periods do not reduce availability | Reservation ends exactly at the event start; unavailability starts exactly at the event end | Check the event window | Both periods are excluded; windows that only touch do not overlap | As expected | Pass | AC1, AC3 |
| TC-293 | Existing reservations for the event being checked are not counted against it | The event already has an overlapping reservation | Check availability for that event | Its own held quantity is not subtracted a second time | As expected | Pass | Prevent double-counting |
| TC-294 | Invalid windows, quantities and missing inventory are reported | Missing or malformed availability input/data | Check availability | An actionable error is returned; the check does not report a successful availability result | As expected | Pass | AC1, AC4 |
| TC-295 | Technical Support checks each requested line against the Pending event window | A Pending equipment request includes its event date and time | Open Availability check and check the event | Each requested line reports free stock and numeric shortfall using the event window | As expected | Pass | AC1, AC2 |
| TC-296 | An incomplete event window is reported rather than guessed | A Pending request has no complete date/time window | Check availability | The missing event window is explicitly reported and no availability lookup is made | As expected | Pass | AC1 |
| TC-297 | Technical Support reads stock and unavailable periods without changing stock values | firestore.rules in force | Inspect inventory and unavailability rules | Technical Support may read; unavailable periods are read-only and inventory writes can only advance the availability revision | As expected | Pass | AC1, AC3 — assert via `firestoreRules.test.js` |

---

## G3 / SCRUM-TBD — Reserve equipment for an event

> As a Technical Support Staff member, I want to reserve equipment against a specific event, so that the same
> item is not promised to two events at once.

A reservation is made for one equipment-request line. Its required interval is the envelope of the event's
approved venue booking occupied windows (`occupied_start` through `occupied_end`), including each venue's
configured setup and turnaround. The reservation is a durable `equipment_reservations` record. Releasing it
changes its status and records who released it and when; the record remains linked to its event.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-298 | Technical Support enters a quantity and reserves equipment | Event has a Pending equipment request and an approved venue booking | Set the line quantity and reserve | The requested quantity is saved and a success confirmation is shown | As expected | Pass | AC1, AC6 |
| TC-299 | Reservation window includes setup and teardown from approved venue bookings | Event has approved bookings with occupied windows | Resolve the equipment window | Earliest occupied start and latest occupied end are used, covering all event venue setup/turnaround | As expected | Pass | AC2, AC4 |
| TC-300 | A quantity below one cannot be reserved | Event has a Pending equipment request | Enter zero, a negative, or a fractional quantity; reserve | The input is rejected and no reservation is written | As expected | Pass | AC3 |
| TC-301 | Insufficient stock reports the shortfall and does not create a reservation | Overlapping use leaves fewer free units than requested | Reserve the requested quantity | The user is told the quantity available and the shortfall; no reservation is written | As expected | Pass | AC4, AC7 |
| TC-302 | Future reservation succeeds when prior use ends before its required start | Existing reservation ends at the future occupied-window start | Check/reserve the future event | The touching/non-overlapping use does not reduce free quantity | As expected | Pass | AC5 |
| TC-303 | Reservation persists its event, type, quantity, window and reserving actor | Requested quantity is available throughout the required period | Reserve equipment | A `RESERVED` record contains the equipment type, quantity, event id, required window and actor | As expected | Pass | AC8 |
| TC-304 | Reservation writes are server-authorized and browser writes are denied | firestore.rules and the equipment service are in force | Inspect rules and submit without a Technical Support token | Only Technical Support can use the Admin transaction; direct browser writes are denied | As expected | Pass | AC4, AC8, AC9 — assert via backend service and `firestoreRules.test.js` |
| TC-305 | The reservation stays linked to its event until released | An event has an active reservation | Reload its Pending request, then release the reservation | The active reservation remains visible with its event; release records the actor/time and makes the quantity available again | As expected | Pass | AC6, AC9 |
| TC-306 | Non-concurrent reservations are not double-counted when checking the full interval | Two equal reservations occupy different parts of the event window and only touch | Check or reserve the event's equipment | The calculation uses the peak concurrent quantity; both portions leave the same genuinely free quantity | As expected | Pass | AC4, AC5 |

---

## G4 / SCRUM-TBD — Amend or refuse an equipment request

> As an Event Coordinator, I want to know what Technical Support can actually provide so that I am not
> planning around equipment that will not arrive.

Technical Support decisions are recorded per request line. An amended line carries its before/after values,
note, actor and timestamp. An unable-to-fulfil decision resolves that line with a mandatory reason. The
overall request becomes `ARRANGED` once every line is either `RESERVED` or `RESOLVED`; until then it remains
`PENDING`. The coordinator sees the current lines and the audit history on their Equipment requests page.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-307 | Technical Support changes a requested type or quantity with an explanatory note | Request is Pending and the line is not fulfilled | Change the equipment type or quantity and enter a note | The amended line and history record contain old/new values, note, actor and timestamp | As expected | Pass | AC1, AC3 |
| TC-308 | An amendment without a note is rejected | Request is Pending | Submit an amendment with an empty note | The amendment is refused and neither request nor history is written | As expected | Pass | AC1 |
| TC-309 | An unable-to-fulfil resolution requires a reason | Request is Pending and the line is not fulfilled | Submit without a reason, then provide a reason | Empty reason is rejected; decision records its reason, actor and timestamp | As expected | Pass | AC2, AC3 |
| TC-310 | A multi-line request is arranged only when all lines are reserved or resolved | Request has three lines, only one is reserved | Resolve one line, then resolve the final open line | It remains Pending while any line is open; once all lines are settled it becomes Arranged | As expected | Pass | AC4 |
| TC-311 | Coordinator sees Technical Support changes and decisions | Assigned coordinator has an equipment request with support history | Open Equipment requests | Current amended/resolved lines and their notes, reasons, actor and time are visible; editing is locked once Support has acted | As expected | Pass | AC3 |
| TC-312 | Support cannot amend a line with an active reservation | Request line has an active reservation | Attempt to amend its equipment type or quantity | The amendment is rejected and neither request nor history is changed | As expected | Pass | Preserves the reservation; AC1, AC4 |

---

## B1 / SCRUM-92 — Create an event request with the core details

> As an Event Organiser, I want to enter the essential details of my event so that ConnectSphere knows what I
> am asking for.

Pre-condition for every case in this section: an Event Organiser is signed in and the **New event request**
screen is open on an empty form.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-017 | Happy path — a complete request carries all seven core details, its creator and its creation time | Empty form; organiser `u1` signed in | 1. Enter name, purpose, description, expected attendance 180, a date 30 days ahead, start 09:00, end 17:00<br>2. Enter one equipment line (Projector, 2)<br>3. Click **Submit request** | The event document holds `name`, `purpose`, `description`, `event_date`, `start_time`, `end_time`, `expected_attendance` as the number 180, plus `organiser_id`, `created_by` = `u1` and a server `created_at` | As expected | Pass | AC1, AC4. Also proves the camelCase → snake_case mapping |
| TC-018 | Negative — each of the seven core details is mandatory, and the missing one is the field named | Empty form | For each of the seven fields in turn: fill a valid request but leave that one field empty, then click **Submit request** | Submission is blocked with exactly one message, "&lt;Field&gt; is required.", naming that field and no other; nothing is written to Firestore | As expected for all seven | Pass | AC1, and B9 AC4 — the message names the field. Runs as seven variants |
| TC-019 | Boundary — an end time one minute after the start is accepted | Empty form | 1. Fill a valid request with start 09:00 and end 09:01<br>2. Submit | Accepted; `start_time` 09:00 and `end_time` 09:01 are stored | As expected | Pass | AC2, lower boundary |
| TC-020 | Negative — an end time earlier than the start is refused | Empty form | 1. Fill a valid request with start 09:00 and end 08:00<br>2. Submit | Blocked with "End time must be later than start time."; nothing written | As expected | Pass | AC2 |
| TC-021 | Boundary — an end time equal to the start is refused | Empty form | 1. Fill a valid request with start 09:00 and end 09:00<br>2. Submit | Blocked with "End time must be later than start time."; nothing written | As expected | Pass | AC2, the exact boundary — a zero-length event is not an event |
| TC-022 | Boundary — today is the earliest date accepted | Empty form | 1. Fill a valid request with the proposed date set to today<br>2. Submit | Accepted; `event_date` is today | As expected | Pass | AC2. "In the past" excludes today |
| TC-023 | Negative — yesterday is refused | Empty form | 1. Fill a valid request with the proposed date set to yesterday<br>2. Submit | Blocked with "The proposed event date cannot be in the past."; nothing written | As expected | Pass | AC2 |
| TC-024 | Boundary — an attendance of 1 is accepted | Empty form | 1. Fill a valid request with expected attendance 1<br>2. Submit | Accepted; `expected_attendance` stored as the number 1, not the string "1" | As expected | Pass | AC3, lower boundary |
| TC-025 | Boundary — an attendance of 0 is refused | Empty form | 1. Fill a valid request with expected attendance 0<br>2. Submit | Blocked with "Expected attendance must be a whole number greater than zero."; nothing written | As expected | Pass | AC3, the exact boundary |
| TC-026 | Negative — a negative attendance is refused | Empty form | 1. Fill a valid request with expected attendance −5<br>2. Submit | Blocked with the whole-number message; nothing written | As expected | Pass | AC3 |
| TC-027 | Negative — a fractional attendance is refused | Empty form | 1. Fill a valid request with expected attendance 1.5<br>2. Submit | Blocked with the whole-number message; nothing written | As expected | Pass | AC3. 1.5 people cannot attend |
| TC-028 | Negative — text cannot be entered as an attendance | Empty form | 1. Fill a valid request and type "many" into expected attendance<br>2. Submit | The field discards the text and reads empty; submission is blocked with "Expected attendance is required." rather than with the whole-number message | As expected | Pass | AC3. The number control refuses the value before validation sees it, so the organiser is told the field is missing |
| TC-029 | Guard — the date and attendance controls carry their own limits | Empty form | Inspect the **Proposed date** and **Expected attendance** controls | Proposed date has `min` = today; expected attendance is `type="number"` with `min="1"` and `step="1"` | As expected | Pass | AC2, AC3. Client-side guard that stops most bad values being typed at all |

---

## B9 / SCRUM-100 — Submit an event request

> As an Event Organiser, I want to submit my completed event request so that a coordinator can start planning
> my event.

Pre-condition for every case in this section: an Event Organiser is signed in and the **New event request**
screen is open, unless the row says otherwise.

Each section that can be declined — facilities, equipment, accessibility, registration — opens with a Yes/No
question, and its detail fields only appear on Yes. Nothing is pre-selected except registration, which B5 AC1
requires to default to off. That is what lets an unanswered section be told apart from a declined one, so
"filled in nothing" and "forgot to look" are never the same state.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-030 | Happy path — a complete request is recorded as Submitted with a reference number and a submission time | Empty form | 1. Fill every required detail including one equipment line<br>2. Click **Submit request** | The event is written with `status` = `SUBMITTED`, a `reference_no` of the form `EVT-XXXXXX-XXXXX`, and a server `submitted_at`; an `event_history` entry is written with `action_type` = `EVENT_SUBMITTED` and the organiser as actor | As expected | Pass | AC5 |
| TC-031 | Happy path — the confirmation names the reference number the request was given | Empty form | 1. Fill a valid request<br>2. Submit | The confirmation reads "Event request &lt;reference&gt; submitted for coordinator review.", carrying the same reference that was written to the event | As expected | Pass | AC6. The reference is the only thing the organiser can quote when following the request up |
| TC-032 | Negative — an empty form writes nothing at all, and every unanswered field is named | Empty form | Click **Submit request** without entering anything | Twelve messages are listed — the seven core details, both venue requirements, and the three unanswered Yes/No questions — in the order they appear on the form; no create and no update reaches Firestore | As expected | Pass | AC4. The list is asserted in full, so a rule that quietly stops firing fails the test |
| TC-033 | Negative — values already entered stay on screen | Empty form | 1. Fill a valid request but set expected attendance to 0<br>2. Submit | Submission is blocked, and event name, purpose, proposed date and the equipment line still hold what was typed | As expected | Pass | AC4. Nothing is cleared on a failed submit, so the organiser only has to fix the offending field |
| TC-034 | Negative — answering Yes to equipment and then adding no line is refused | Empty form | 1. Fill everything, answer **Yes** to "Does your event need equipment?" and leave the line blank<br>2. Submit | Blocked with "Add at least one equipment line, or answer No above."; nothing written | As expected | Pass | AC2 |
| TC-069 | Happy path — answering No puts the equipment fields away and stores the decision | Empty form | 1. Answer **Yes** to the equipment question and confirm the fields appear<br>2. Change the answer to **No** and confirm they disappear<br>3. Submit | The request is accepted with `equipment_required` false, and no `event_equipment` row is written | As expected | Pass | AC2. A No is a recorded decision, not an absence |
| TC-035 | Boundary — an equipment quantity of 0 is refused | Empty form | 1. Fill a valid request with equipment type Projector and quantity 0<br>2. Submit | Blocked with "Equipment quantity 1 must be a whole number greater than zero."; nothing written | As expected | Pass | AC3 applied to equipment. The message carries the line number, because there can be several |
| TC-036 | Boundary — an equipment quantity of 1 is accepted | Empty form | 1. Fill a valid request with equipment type Projector and quantity 1<br>2. Submit | Accepted; an `event_equipment` document is written with `equipment_type` Projector and `quantity` 1 | As expected | Pass | AC3, lower boundary |
| TC-037 | Boundary — a registration capacity equal to the expected attendance is accepted | Empty form | 1. Fill a valid request with expected attendance 180<br>2. Tick **Registration required**, capacity 180, open today 09:00, close the day before the event 17:00<br>3. Submit | Accepted; `registration_required` true and `registration_capacity` 180 are stored | As expected | Pass | The exact boundary — capacity may equal, but not exceed, attendance |
| TC-038 | Negative — a registration capacity above the expected attendance is refused | Empty form | Same as TC-037 but capacity 181 | Blocked with "Registration capacity cannot exceed the expected attendance."; nothing written | As expected | Pass | One over the boundary |
| TC-039 | Negative — registration with no open and close date/time is refused | Empty form | 1. Fill a valid request<br>2. Tick **Registration required**, capacity 100, leave all four date/time fields empty<br>3. Submit | Blocked with "Registration open and close date/time are required when registration is enabled."; nothing written | As expected | Pass | AC2 |
| TC-040 | Negative — registration closing after the event starts is refused | Empty form | 1. Fill a valid request starting 09:00<br>2. Tick **Registration required**, capacity 100, close on the event day at 10:00<br>3. Submit | Blocked with "Registration close date/time must be at or before the event start."; nothing written | As expected | Pass | Registration cannot still be open once the event has begun |
| TC-041 | Happy path — the form is cleared once the request has gone | Empty form | 1. Fill a valid request<br>2. Submit | After the confirmation, event name and expected attendance are empty again | As expected | Pass | AC7. The submitted request cannot be sent a second time from the same form |
| TC-042 | Happy path — an already-submitted request opens read-only | An event exists with `status` = `SUBMITTED` and reference `EVT-100234` | Open that request from **My events** | The note "Viewing request EVT-100234. This request is no longer editable." is shown; there is no **Submit request** and no **Save draft** button; the fields are read-only | As expected | Pass | AC7 |
| TC-043 | Negative — the block names exactly the fields that are wrong, and nothing else | Empty form | 1. Fill a valid request but leave event name and start time empty and set expected attendance to 0<br>2. Submit | Exactly three messages: "Event name is required.", "Start time is required." and "Expected attendance must be a whole number greater than zero."; nothing is written | As expected | Pass | AC4 |
| TC-044 | Negative — a request with no venue requirements cannot be submitted | Empty form | 1. Fill the core details, equipment and the facility and accessibility answers, leaving preferred location and required layout empty<br>2. Submit | Blocked, naming both "Preferred location or area is required." and "Required layout is required."; nothing written | As expected | Pass | AC1. Venue requirements stay optional on a draft (B2 AC3) and are required only at submission |
| TC-045 | Negative — answering Yes to facilities and choosing none is refused; answering No is accepted | Empty form | 1. Fill everything, answer **Yes** to the facilities question, select nothing<br>2. Submit<br>3. Change the answer to **No**<br>4. Submit again | The first submit is blocked with "Select at least one required facility, or answer No above."; the second is accepted and `facilities_required` false is stored | As expected | Pass | AC1, AC2. Yes makes the list compulsory; No records the decision |
| TC-046 | Negative — answering Yes to accessibility and choosing none is refused; answering No is accepted | Empty form | 1. Fill everything, answer **Yes** to the accessibility question, select nothing<br>2. Submit<br>3. Change the answer to **No**<br>4. Submit again | The first submit is blocked with "Select at least one accessibility need, or answer No above."; the second is accepted and `accessibility_needed` false is stored | As expected | Pass | AC2. The Yes/No question is what the customer has not ruled on — see Open questions in `CLAUDE.md` |
| TC-064 | Boundary — changing a Yes to a No clears what was chosen rather than submitting it | Empty form | 1. Answer **Yes** to the accessibility question and tick **WHEELCHAIR ACCESS**<br>2. Change the answer to **No**<br>3. Submit | No `event_accessibility` row is written; the selection made while the answer was Yes does not travel to Firestore behind the organiser's back | As expected | Pass | AC2 |
| TC-065 | Happy path — a draft keeps the reference number it was first given | A draft exists with reference `EVT-ABC123-9Z8Y` | 1. Open the draft<br>2. Complete it<br>3. Submit | The update keeps `reference_no` = `EVT-ABC123-9Z8Y` and sets `status` to `SUBMITTED` | As expected | Pass | AC5. The reference shown while drafting still finds the request afterwards |
| TC-066 | Boundary — references generated in the same millisecond never repeat | — | Generate 2000 reference numbers in a tight loop | All 2000 are distinct, and all match `EVT-XXXXXX-XXXXX` | As expected | Pass | AC5. A counter behind the timestamp is what makes this hold, so the test is deterministic rather than a matter of luck. Uniqueness is guaranteed within one browser session; across sessions the random pair makes a clash unlikely, and a global guarantee needs the service layer |

---

## B1 / SCRUM-92 — a draft is judged on what it holds

B6 exists so an organiser can save an unfinished request, so presence is only checked at submission. A value
that *has* been entered is judged the same way either way — B1 AC2 and AC3 are rules about the value, not about
whether the organiser has finished.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-067 | Happy path — an incomplete draft saves without complaint | Empty form | 1. Enter an event name only<br>2. Click **Save draft** | The draft is saved with `status` = `DRAFT` and the organiser is told which reference it was given | As expected | Pass | B6. Nothing about the missing fields is reported |
| TC-068 | Negative — a draft holding an impossible value is refused | Empty form | 1. Enter an event name, start 14:00 and end 11:00<br>2. Click **Save draft** | Blocked with "End time must be later than start time." | As expected | Pass | B1 AC2. Incomplete is allowed; impossible is not |

---

## B4 / SCRUM-95 — State the equipment my event needs

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-047 | Happy path — a second equipment line can be added and both are submitted | Organiser signed in, empty form | 1. Fill the core details<br>2. Type Projector / 2 / "Need HDMI cable adapter." into the first equipment line<br>3. Click **Add equipment line**<br>4. Type Microphone / 4 into the second<br>5. Submit | Both lines are written to `event_equipment` — Projector with quantity 2 and the technical note, Microphone with quantity 4 and a null note | As expected | Pass | Repaired: the previous version of this test looked up "Equipment type" after a second line existed, which matched two fields and made the test error out. It now uses the numbered labels |

---

## The form says what is compulsory

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-070 | Every compulsory question carries the red marker, and the optional ones do not | Organiser signed in, empty form | 1. Open the form<br>2. Check each of the seven core details, both venue requirements and all four Yes/No questions<br>3. Check the accessibility notes | All thirteen compulsory questions carry a red `*`; the additional accessibility notes do not, and say "Optional" instead. The form opens with a line saying what the marker means, and sets `noValidate` so its own list is what the organiser sees | As expected | Pass | The browser's own validation bubble would otherwise fire first and hide the B9 AC4 list |

| TC-071 | A confirmation appears as a toast in the corner, announces itself, and clears | Organiser signed in | 1. Arrive in the workspace with a confirmation waiting<br>2. Read where it renders<br>3. Dismiss one by hand<br>4. Leave another for eight seconds | The message renders in the fixed toast layer and not in the panel body; the layer is a `status` live region; the dismiss button removes it; an untouched toast clears itself | As expected | Pass | The form is long enough to scroll, and a message only above the fold is one the organiser has to go looking for |

---

## A4 / SCRUM-90 and A5 / SCRUM-91 — role-based access

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-014 | Each role sees exactly the screens it is permitted | A user is signed in under each of the five roles in turn | 1. Open the workspace as each role<br>2. Read the sidebar<br>3. Check for any screen belonging only to another role | The sidebar matches the approved permission matrix exactly, no screen from another role appears, and the role is named beside the signed-in user | As expected for all five roles | Pass | A4. The expected matrix is written out by hand in the test so it cannot silently agree with a mistake in `ROLE_META` |
| TC-015 | A screen belonging to another role is refused, and no rule leaves a request unguarded | An Attendee is signed in; `firestore.rules` is in the repo | 1. Request an Organiser screen by its hash route<br>2. Request a screen the Attendee does own<br>3. Read every `allow` rule in `firestore.rules` | The organiser screen shows "Not authorised" while the attendee's own screen opens normally; no rule grants access unconditionally, every rule tests caller identity or role, a user cannot promote themselves to another role, and a profile is readable only by its owner | As expected | Pass | A4. The rules half asserts the policy the file states; behavioural proof comes from a Rules Playground screenshot in the evidence pack, because running the emulator needs a Java runtime we have not added |
| TC-016 | A user sees only the events they are related to, in the UI and at the server | A user is signed in under each role in turn | 1. Open **My events** as each role<br>2. Read the Firestore query<br>3. Read the `events` rules | The organiser queries on `organiser_id`, the coordinator on `coordinator_id`, venue staff on `venue_staff_id`, technical support on `tech_support_id`, and the attendee never queries `events` at all; the rules restrict reads by the same field per role | As expected | Pass | A5. Asserting the query rather than the rendered list — a list only contains what the test handed back, so absence would prove nothing |

---

## A1–A3 — accounts, portals and sign-in rules

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-048 | A visitor who is not signed in lands on the log in chooser | No user signed in | Open the application | The "Choose how you log in" heading is shown with an Individuals and a Corporate tab | As expected | Pass | |
| TC-049 | The individual portal is selected by default | No user signed in | Open the application and read the selected tab | The Individuals tab is selected | As expected | Pass | |
| TC-050 | The corporate portal pre-sets the role from the work email | No user signed in | 1. Open the Corporate tab<br>2. Type `amir.coordinator@connectsphere.com` | "Detected role: Event Coordinator" is shown | As expected | Pass | |
| TC-051 | Each corporate mailbox maps to its role | — | Resolve the role for the organiser, coordinator, venue and technical support mailboxes on the corporate portal | Each returns its matching role | As expected for all four | Pass | Runs as four variants |
| TC-052 | An unrecognised staff mailbox falls back to the least privileged staff role | — | Resolve `j.tan@connectsphere.com` on the corporate portal | Event Organiser | As expected | Pass | Fails safe rather than guessing |
| TC-053 | The individual portal is always an attendee | — | Resolve a staff email and a personal email on the individual portal | Attendee in both cases | As expected | Pass | A staff email on the individual portal grants nothing |
| TC-054 | A company domain cannot set a role on its own | — | Resolve `j.tan@venueco.com` on the corporate portal | Not Venue Staff | As expected | Pass | Negative case — the domain name is not a credential |
| TC-055 | Only approved domains may hold a corporate account | — | Check a `connectsphere.com` address and a `gmail.com` address | True for the approved domain, false for the other | As expected | Pass | |
| TC-056 | A password needs 12 characters, a number and a special character | — | Check `TwelveChars!`, `TwelveChars12` and `SecurePassword1!` | The first two are refused, the third accepted | As expected | Pass | Boundary — the first two are each missing exactly one requirement |
| TC-057 | A mobile number needs at least eight digits and no separators | — | Check `1234567`, `+65 9123 4567` and `91234567` | The first two are refused, the third accepted | As expected | Pass | Boundary — seven digits is one short |

---

## B6, B7 — drafts in the organiser's event list

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-058 | Drafts and submitted requests appear together, told apart by status | The organiser has one submitted request and one draft | Open **My events** | Both events are listed, one carrying a DRAFT pill and the other SUBMITTED | As expected | Pass | B7. There is no separate drafts screen — one list, told apart by the status pill |
| TC-059 | A draft carries its last-saved time; a submitted request does not | As above | Open **My events** and read the timestamps | Exactly one "Last saved …" line, on the draft | As expected | Pass | B6 |
| TC-060 | Only a draft can be continued | As above | 1. Open **My events**<br>2. Read the actions on each record<br>3. Click **View details** on the submitted request | One **Continue editing** button, on the draft; the submitted request offers **View details**, which opens that request | As expected | Pass | B6 |
| TC-061 | The most recently saved event comes first | As above, saved at different times | Open **My events** and read the order | The more recently saved event is listed first | As expected | Pass | |
| TC-062 | A draft with no times reads cleanly | The organiser has a draft with no date or times | Open **My events** | The record reads "Date not set · Time not set" rather than leaving a dangling separator | As expected | Pass | |
| TC-063 | An empty list points the organiser at the request form | The organiser has no events | Open **My events** | A message saying they have not created any events yet | As expected | Pass | |


## C1 / SCRUM-102 / Have submitted events assigned to a coordinator automatically

**Legend:** `C1`, `C2`, `C3` = Coordinator 1/2/3 (by `coordinator_seq` 1, 2, 3) · `E1`, `E2`, … = Event 1/2/… submitted by the Organiser. Test-data labels, not C4 diagram levels.

**Assignment rule — circular rotation by `coordinator_seq`:** On first submission (only when `coordinator_id` is empty), assign the coordinator whose `coordinator_seq` is the next one after the last-assigned seq; after the highest, wrap back to the lowest. All seeded coordinators participate — there is no active/inactive flag and no unassigned queue. Assignment is performed by the **backend** (the client cannot write `coordinator_id`); the event's status stays `Submitted`; `coordinator_id` is immutable once set; the timestamp is recorded in **SGT**.

**Agreed decisions (remind your group):**
1. Strategy is **circular rotation by `coordinator_seq`** (ascending, wrap) — see ADR-0001. Not LRA.
2. **No active/inactive flag, no unassigned queue** — coordinators are seeded and always available (Q16).
3. **No reassignment in C1** — coordinator unavailability is out of scope (Q16); manual reassignment, if any, is C9.
4. **Backend is the only writer** of `coordinator_id` / `assigned_at`; `firestore.rules` block the client. Assignment runs once, when `coordinator_id` is empty; immutable thereafter.
5. Timestamps stored in **SGT**. Coordinators are never "busy" — no cap on events per coordinator.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
|---|---|---|---|---|---|---|---|
| TC-072 | Happy path — a valid submission produces a well-formed assignment | Coordinators seeded `{C1, C2}`; no prior assignments; Organiser authenticated | 1. Organiser submits a valid event E1<br>2. Retrieve E1 | E1 has a `coordinator_id` referencing one seeded coordinator; `assigned_at` is non-null and in SGT; E1.status = **Submitted** (unchanged) | As expected | Pass | AC2 — shape of a successful assignment. *Which* coordinator is chosen → TC-073; the never-two invariant → TC-076 |
| TC-073 | Consecutive submissions rotate in ascending `coordinator_seq` | seeded `{C1, C2, C3}` (seq 1, 2, 3); no prior assignments | 1. Submit E1<br>2. Submit E2<br>3. Submit E3<br>4. Retrieve assignments | E1→C1, E2→C2, E3→C3; each has exactly one coordinator; each stays Submitted | As expected | Pass | AC3 — rotation order |
| TC-074 | Rotation wraps after the last coordinator back to the first | Continues from TC-073: C1, C2, C3 each assigned once (last-assigned seq = 3) | 1. Submit E4<br>2. Retrieve E4 | E4→C1 (no higher seq, so rotation wraps to the lowest); C1 now holds 2 events (E1, E4) | As expected | Pass | AC3, AC5 — wrap boundary |
| TC-075 | A single seeded coordinator receives all events | Only one coordinator seeded `{C1}` | 1. Submit E1<br>2. Submit E2<br>3. Submit E3 | All three → C1 (one coordinator holds multiple events); each event has exactly one coordinator | As expected | Pass | AC5 — boundary (no cap) |
| TC-076 | An event is never assigned to two coordinators (invariant) | seeded `{C1, C2}`; E1 already assigned to C1 | 1. Attempt to assign a second coordinator to E1<br>2. Inspect E1's assignment record(s) | E1 still references exactly one coordinator; the second assignment is rejected / not persisted | As expected | Pass | AC1 — invariant |
| TC-077 | Concurrent submissions each get exactly one, distinct coordinator | seeded `{C1, C2}`; no prior assignments | 1. Submit E1 and E2 simultaneously (concurrent requests)<br>2. Retrieve E1, E2 | E1 and E2 each assigned to exactly one coordinator, and to different coordinators (C1 and C2); the rotation cursor advances once per assignment; no double-assignment or skipped seq from a race | As expected against a mocked transaction (see Remarks) | Pass | AC1, AC3 — concurrency. Holds because the backend serialises the cursor in one Firestore transaction (Option B). Exercised as two sequential calls against a mock, not two requests racing over the network — that stronger claim needs the emulator this repo does not run (see TC-015) |
| TC-078 | Assignment timestamp recorded at assignment time, in SGT | seeded `{C1}`; note current time T | 1. Submit E1 at ~T<br>2. Read E1.assigned_at | E1.assigned_at non-null; equals assignment time within tolerance (e.g. ±2s); stored in SGT; recorded alongside coordinator_id | As expected | Pass | AC2. Stored as a Firestore `Timestamp` via `FieldValue.serverTimestamp()`, same as `created_at`/`submitted_at` elsewhere; SGT is a display concern, not a storage format |
| TC-079 | Assignment happens once — re-saving or editing an already-assigned event does not reassign | E1 already assigned to C1 (coordinator_id set) | 1. Edit and re-save a detail on E1 (or re-trigger a submit on it)<br>2. Retrieve E1 | E1.coordinator_id is still C1 (unchanged); no fresh assignment runs, because assignment only fires when coordinator_id is empty | As expected | Pass | AC7 — assign once |
| TC-080 | The client can never write or change the coordinator (server-side rule) | Organiser authenticated; `firestore.rules` in force; for step 2, E1 already assigned to C1 | 1. Attempt a direct client write creating an event with `coordinator_id` pre-filled<br>2. Attempt a direct client write changing or clearing `coordinator_id` (or `assigned_at`) on E1 | Both writes are rejected by `firestore.rules`: `coordinator_id` is not client-writable on create and is immutable to the client once set; only the backend may write it (and `assigned_at`) | As expected | Pass | AC6, AC7 — server-side integrity (A4). Same approach as TC-015/016: asserts the rule text, not live behaviour, for the same emulator/Java-runtime reason |

---

## E8 / SCRUM-124 — Be stopped before booking an unsuitable venue

**Legend / standing test data:** *Hall A* = `VEN-001`, capacity **200**, facilities `{WIFI, STAGE, POWER_POINTS}`,
accessibility `{WHEELCHAIR_ACCESS, LIFT}`, layouts `{THEATRE, CLASSROOM}`. *Coordinator 7* = `coordinator-7`.
Criterion codes are `CAPACITY`, `FACILITY`, `ACCESSIBILITY`, `LAYOUT`.

**The rule the story sets:** capacity is a **hard stop** — a room that cannot physically hold the pax is refused
outright and cannot be acknowledged past (AC1). A missing facility, accessibility feature or layout is a
**judgement call** — the coordinator may proceed, but only after explicitly acknowledging each failing
criterion, and the decision is written onto the booking for Venue Staff to read (AC2, AC3).

**Design decisions (remind your group):**
1. **One acknowledgement per failing criterion**, not one blanket tick. "Explicitly acknowledge" is read
   strictly: ticking "layout" does not silently accept a missing accessibility feature.
2. **The acknowledgement is immutable.** `venue_bookings` has a create rule and deliberately **no** update
   rule — it records what the coordinator accepted at the time and is not rewritten later.
3. **The gate is enforced server-side.** `firestore.rules` re-reads the venue's `max_capacity` and re-checks it
   against `expected_attendance`, and refuses any booking without a well-formed acknowledgement. A disabled
   button is not the control (story A4).
4. **Operating hours are evaluated here, as a hard stop.** Originally left out as E7 AC4's concern, but once
   the booking screen became the place a venue and event are assessed together, E7 AC1 and AC5 were being met
   there while AC4 was not checked at all — a coordinator could be told a venue "meets all requirements" on a
   day it is shut. It blocks alongside capacity rather than warning, which goes further than E8 AC1 (that
   names only capacity); the deviation is deliberate. A venue stating no hours at all is treated as open at
   any time, since that is missing data rather than a closure.
5. The rules are in `frontend/src/domain/venueSuitability.js` — no React, no Firebase — so they can be read
   next to the acceptance criteria and move into the service layer unchanged.
6. **All 36 cases live in one suite**, `features/venues/VenueBookingRequest.test.js`, in three labelled
   parts: `unit —` (TC-112 – TC-131, TC-148 – TC-150, TC-158 – TC-159, TC-166 – TC-168, TC-175 – TC-180), `functional —` (TC-132 – TC-143,
   TC-152 – TC-157, TC-160 – TC-165, TC-169 – TC-173) and `rules —` (TC-144 – TC-147, TC-151, TC-174).
   Run just this story with `npm test -- --testPathPattern VenueBookingRequest`.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
|---|---|---|---|---|---|---|---|
| TC-112 | Attendance above capacity is a blocking failure | Hall A (cap 200) | 1. Assess Hall A for an event expecting 201 | Outcome has exactly one blocking failure, `CAPACITY`; `suitable` = false | As expected | Pass | AC1 — the hard stop |
| TC-113 | Attendance exactly at capacity is not a failure | Hall A (cap 200) | 1. Assess Hall A for an event expecting 200 | No blocking failures; `suitable` = true | As expected | Pass | AC1 — boundary (200 fits in 200) |
| TC-114 | The capacity failure names both numbers | Hall A (cap 200) | 1. Assess Hall A for an event expecting 350<br>2. Read the blocking entry | Entry reports `required` = 350 and `available` = 200 | As expected | Pass | AC1 — the coordinator is told the shortfall, not just refused |
| TC-115 | A capacity block cannot be acknowledged away | Hall A (cap 200) | 1. Assess for 201<br>2. Attempt to submit having "acknowledged" `CAPACITY` | Submission refused; `CAPACITY` is absent from the acknowledgeable criteria; the refusal names capacity | As expected | Pass | AC1 vs AC2 — the two paths must not leak into each other |
| TC-116 | A missing required facility warns rather than blocks | Hall A | 1. Assess for an event requiring `{WIFI, KITCHEN_PANTRY}` | No blocking failures; one warning on `FACILITY` naming `KITCHEN_PANTRY` only | As expected | Pass | AC2 — only what is actually missing is listed |
| TC-117 | A missing accessibility feature warns | Hall A | 1. Assess for an event requiring `{HEARING_LOOP}` | One warning on `ACCESSIBILITY` naming `HEARING_LOOP` | As expected | Pass | AC2 |
| TC-118 | An unsupported layout warns | Hall A | 1. Assess for an event requiring layout `BANQUET` | One warning on `LAYOUT` naming `BANQUET` | As expected | Pass | AC2 |
| TC-119 | Every failing criterion is named, one warning each | Hall A | 1. Assess for an event requiring facilities `{KITCHEN_PANTRY, PARKING}`, accessibility `{HEARING_LOOP}`, layout `BANQUET` | Three warnings, in order `FACILITY`, `ACCESSIBILITY`, `LAYOUT`; the facility warning lists both missing items | As expected | Pass | AC2 — nothing is collapsed or hidden |
| TC-120 | A block and warnings are reported together | Hall A | 1. Assess for 500 pax also requiring `KITCHEN_PANTRY` | Blocking `CAPACITY` **and** warning `FACILITY` both present | As expected | Pass | The coordinator sees the whole picture, not just the first failure |
| TC-121 | Criteria evaluated are reported even when they pass | Hall A | 1. Assess for 100 pax requiring `{WIFI}` and layout `THEATRE` | `suitable` = true; evaluated = `CAPACITY`, `FACILITY`, `LAYOUT` | As expected | Pass | Mirrors E7 AC5 — "the criteria evaluated are shown either way" |
| TC-122 | A criterion the event does not ask for is not evaluated | Hall A | 1. Assess for 100 pax with no facility, accessibility or layout requirement | Evaluated = `CAPACITY` only; no warnings | As expected | Pass | An organiser who answered No to a section (B9 AC2) is not failed on it |
| TC-123 | Submission refused while a warning is unacknowledged | Hall A; event short on `FACILITY` and `LAYOUT` | 1. Attempt to submit with nothing acknowledged | Refused; outstanding = `FACILITY`, `LAYOUT` | As expected | Pass | AC2 |
| TC-124 | Acknowledging some but not all still refuses | As TC-123 | 1. Acknowledge `FACILITY` only<br>2. Attempt to submit | Refused; outstanding = `LAYOUT` | As expected | Pass | AC2 — the per-criterion decision (design decision 1) |
| TC-125 | Submission allowed once all warnings are acknowledged | As TC-123 | 1. Acknowledge `FACILITY` and `LAYOUT`<br>2. Attempt to submit | Allowed; nothing outstanding; no block reason | As expected | Pass | AC2 |
| TC-126 | A venue with no failures needs no acknowledgement | Hall A; event requires `{WIFI}` only | 1. Assess<br>2. Attempt to submit with nothing acknowledged | `suitable` = true; nothing outstanding; submission allowed | As expected | Pass | AC2 — the gate is invisible when there is nothing to warn about |
| TC-127 | The acknowledgement record is complete | Hall A; event short on `FACILITY` (`KITCHEN_PANTRY`) and `ACCESSIBILITY` (`HEARING_LOOP`); Coordinator 7 at 2026-10-04T09:30:00Z | 1. Acknowledge both<br>2. Build the record | Record = `acknowledged: true`, criteria `[FACILITY, ACCESSIBILITY]`, missing items per criterion, `acknowledged_by` = coordinator-7, `acknowledged_at` = the timestamp | As expected | Pass | AC3 — this is what Venue Staff later read |
| TC-128 | Nothing to acknowledge is recorded plainly | Hall A; event requires `{WIFI}` only | 1. Build the record | Record = `acknowledged: false`, empty criteria and missing, null `acknowledged_by` / `acknowledged_at` | As expected | Pass | AC3 — a clean booking is explicitly clean, not an absent field |
| TC-129 | An unacknowledged warning cannot be written away | Hall A; event short on `FACILITY` and `LAYOUT` | 1. Acknowledge `FACILITY` only<br>2. Attempt to build the record | Throws, naming `LAYOUT` | As expected | Pass | AC3 — the record cannot claim more than the coordinator agreed to |
| TC-130 | A stored event maps onto the criteria | Event with `expected_attendance` 180, `required_layout` BANQUET, facilities `{WIFI, STAGE}`, accessibility `{HEARING_LOOP}` | 1. Derive the requirements | All four map across; `required_layout` becomes `layout` | As expected | Pass | Keeps the Firestore `snake_case` / React `camelCase` split honest |
| TC-131 | An event that answered No asks for nothing on that section | Event with attendance 40 and no other requirement | 1. Derive the requirements | Empty facility and accessibility lists, null layout | As expected | Pass | B9 AC2 — an explicit No is an answer |
| TC-132 | The screen disables the request on a capacity failure and says why | Hall A; event expects 400; Coordinator 7 signed in | 1. Open the venue's booking panel | "Request this venue" is disabled; an alert names capacity and shows 400 | As expected | Pass | AC1 at the screen |
| TC-133 | A capacity failure offers no way to acknowledge past it | As TC-132 | 1. Open the booking panel | No acknowledgement checkbox is rendered at all | As expected | Pass | AC1 — the control does not exist, rather than existing and being ignored |
| TC-134 | Nothing is submitted while blocked | As TC-132 | 1. Click "Request this venue" | No booking request is sent | As expected | Pass | AC1 |
| TC-135 | Each failing criterion is listed with what the venue lacks | Hall A; event needs `KITCHEN_PANTRY` and layout `BANQUET` | 1. Open the booking panel | Both `KITCHEN PANTRY` and `BANQUET` are shown to the coordinator | As expected | Pass | AC2 — the coordinator is told what they are accepting |
| TC-136 | The request stays disabled until every warning is ticked | As TC-135 | 1. Observe two checkboxes, button disabled<br>2. Tick the first — still disabled<br>3. Tick the second | Button becomes enabled only after the second tick | As expected | Pass | AC2 — design decision 1 at the screen |
| TC-137 | The acknowledgement travels with the submitted request | As TC-135 | 1. Tick both<br>2. Click "Request this venue" | One request sent carrying `venue_id`, `event_id` and an acknowledgement with `acknowledged: true`, criteria `[FACILITY, LAYOUT]`, the missing items, the acknowledging user and an ISO timestamp | As expected | Pass | AC3 — the link between the screen decision and the stored record |
| TC-138 | Unticking a warning disables the request again | As TC-135 | 1. Tick both (button enabled)<br>2. Untick the first | Button disabled again | As expected | Pass | AC2 — the gate is not one-way |
| TC-139 | A suitable venue submits with no acknowledgement | Hall A; event within capacity, requires `{WIFI}` and `THEATRE` | 1. Open the panel<br>2. Click "Request this venue" | No checkboxes shown; button enabled; request sent with `acknowledged: false` | As expected | Pass | AC2, AC3 |
| TC-140 | Criteria evaluated are shown even when all pass | As TC-139 | 1. Open the panel | Capacity and layout both appear in the evaluated list | As expected | Pass | Mirrors E7 AC5 |
| TC-141 | A failed save is surfaced and does not claim success | As TC-139; the write will fail | 1. Click "Request this venue" | The failure message is shown; no confirmation appears | As expected | Pass | The coordinator is never told a booking exists when it does not |
| TC-142 | Venue Staff see every criterion the coordinator accepted | A booking carrying an acknowledgement for `FACILITY` (`KITCHEN_PANTRY`) and `LAYOUT` (`BANQUET`) | 1. View the booking | Both missing items are shown on the booking | As expected | Pass | AC3 — "shown to Venue Staff"; rendered in the availability calendar, where staff already see bookings |
| TC-143 | A booking with nothing acknowledged shows no notice | A booking with `acknowledged: false` | 1. View the booking | No acknowledgement notice is rendered | As expected | Pass | AC3 — absence of a warning is not itself a warning |
| TC-144 | Only a coordinator may raise a booking, and only as themselves | `firestore.rules` in force | 1. Inspect the `venue_bookings` create rule | Requires role `EVENT_COORDINATOR` and `requested_by == request.auth.uid`; organisers and attendees are not permitted | As expected | Pass | AC1–AC3 server-side (A4). Asserts the rule text, not live behaviour — same emulator/Java-runtime reason as TC-015/TC-016 |
| TC-145 | A booking cannot be written without its acknowledgement | `firestore.rules` in force | 1. Inspect the create rule | The rule requires `suitability_acknowledgement` with a boolean `acknowledged` and a list of criteria | As expected | Pass | AC3 — the record cannot be omitted by a crafted request |
| TC-146 | A venue over capacity cannot be booked by a crafted request | `firestore.rules` in force | 1. Inspect the create rule | The rule reads the venue's `max_capacity` and requires it to be ≥ `expected_attendance` | As expected | Pass | AC1 — the hard stop survives a client that ignores the UI |
| TC-147 | The acknowledgement cannot be rewritten after the fact | `firestore.rules` in force | 1. Inspect the `venue_bookings` block | There is no update rule, so no client may alter a raised booking's acknowledgement | As expected | Pass | AC3 — design decision 2 |
| TC-148 | Find venues carries the event's requirements into the filters | Event: 180 pax, CENTRAL, THEATRE, {WIFI, STAGE}, {LIFT} | 1. Derive the shortlist filters from the event | Location, minimum capacity, facilities, accessibility and layout all pre-filled from the event | As expected | Pass | The shortlist opens narrowed to what was asked for, not the whole catalogue |
| TC-149 | An event that asked for nothing leaves the filters clear | Event with no requirements | 1. Derive the filters | Identical to the empty filter set | As expected | Pass | B9 AC2 — an explicit No is an answer |
| TC-150 | The pre-filled filters are the ones the screen can clear | Event: 180 pax, {WIFI}, THEATRE | 1. Derive the filters<br>2. Read the active filter chips | Chips for capacity range, facilities and layout — each clearable | As expected | Pass | AC2 stays reachable: clearing a chip widens the list to venues that fall short, which is what the acknowledge gate is for |
| TC-151 | A coordinator on the event may read its requirements, but not edit them | `firestore.rules` in force | 1. Inspect `event_venue_requirements`, `event_facilities` and `event_accessibility` | `get, list` use `canReadEvent`; `create`, `update`, `delete` stay `ownsEvent` | As expected | Pass | Three cases (one per collection). Pre-existing defect found while building E8: these were organiser-only, so a coordinator could not read the requirements they must match a venue against — AC2 could not fire in the live app |
| TC-152 | The venue list offers the whole catalogue, not only venues that fit | Catalogue: Hall A (200) and Seminar Room (20) | 1. Open the Venue bookings form | Both venues are offered | As expected | Pass | AC1 — the blocked state is only reachable because nothing is pre-filtered here |
| TC-153 | Naming a venue that cannot hold the event blocks the request | Event 150 pax; Seminar Room holds 20 | 1. Choose the event<br>2. Choose Seminar Room | Alert names capacity; the request action is disabled; nothing is sent | As expected | Pass | AC1 at the screen |
| TC-154 | Arriving from Find venues carries both choices in already | Entered with event and venue | 1. Open the booking screen | The suitability panel is shown for that pairing; the request action is enabled | As expected | Pass | Route 1 — the shortlist only offers venues that fit, so this path never trips the gate |
| TC-155 | Nothing is judged until both an event and a venue are chosen | Nothing chosen | 1. Open the booking form | Venue cards are listed; no request action; no event detail rows | As expected | Pass | AC1, AC2 — no verdict is implied before there is something to judge |
| TC-156 | Choosing an event shows what that event needs, before any venue is picked | Event EVT-1 | 1. Choose the event | The same card shows date, time, attendance, location, layout, facilities and accessibility | As expected | Pass | The coordinator can see the requirements they are matching against |
| TC-157 | The venue list says which venues fit, before one is chosen | Event 150 pax; Hall A (200), Seminar Room (20) | 1. Choose the event<br>2. Read the venue cards | Hall A reads "Meets all requirements"; Seminar Room reads "Too small for 150"; each card lists the venue's own features | As expected | Pass | AC1, AC2 — a venue can be judged before it is selected, and an unsuitable one is still selectable |
| TC-158 | A finished event offers no venue search | Event status COMPLETED, CANCELLED or REJECTED | 1. Evaluate whether venues can be sought | Refused for all three | As expected | Pass | Three cases. A finished event has nothing left to book |
| TC-159 | A live event still offers venue search | Event status SUBMITTED, UNDER_REVIEW or APPROVED | 1. Evaluate whether venues can be sought | Allowed for all three | As expected | Pass | Three cases — the complement of TC-158 |
| TC-160 | The tab opens on the requests this coordinator has raised | One booking raised | 1. Open Venue bookings | The booking is listed with its event, venue and status; the booking form is not in the way | As expected | Pass | AC3 — a raised request is visible to the coordinator who raised it |
| TC-161 | A coordinator with no requests is told so, and can still start one | No bookings raised | 1. Open Venue bookings | An empty-state line plus New booking request | As expected | Pass | — |
| TC-162 | The request action is gone once the booking has been sent | Event and venue chosen, all criteria met | 1. Send the request | Confirmation is shown and the request action is no longer present | As expected | Pass | Same rule as B9 AC7 — the same request cannot be sent twice |
| TC-163 | A booking expands to its details and offers the event request | One booking raised | 1. Expand it<br>2. Open the event request<br>3. Collapse it | Details appear (attendance, venue capacity, status, requested time); the event request opens for that event; collapsing hides them again | As expected | Pass | AC3 — what was accepted is readable after the fact. Opening the request does not start a review on it |
| TC-164 | An event titled the way the events collection stores it is named | Event with `name` set and no `event_name` | 1. Open the booking screen for it | The heading names the event; nothing reads "Untitled event" | As expected | Pass | Defect found in UAT: bookings read `event_name` while events store `name`, so the title saved blank |
| TC-165 | The acknowledgement reaches the Venue Staff availability calendar | An approved booking on Hall A carrying an acknowledgement for FACILITY and LAYOUT | 1. Open the availability calendar as Venue Staff<br>2. Read the booking | The booking shows "Requested despite known shortfalls" naming KITCHEN PANTRY and BANQUET | As expected | Pass | AC3 — TC-142 proves the notice renders; this proves it is on the screen Venue Staff actually use |
| TC-166 | A live request for the same event and venue is found | A PENDING request for EVT-1 on VEN-001 | 1. Look for an existing request for that pairing | The request is returned; an APPROVED one counts too | As expected | Pass | F1 AC4 — the same pairing is not requested twice while one is live |
| TC-167 | A different event or a different venue is not a duplicate | As TC-166 | 1. Look for EVT-2 on VEN-001<br>2. Look for EVT-1 on VEN-009 | Neither matches | As expected | Pass | The guard is on the pairing, not on either half |
| TC-168 | A request that is no longer live leaves the pairing free again | A REJECTED, then a CANCELLED request for EVT-1 on VEN-001 | 1. Look for an existing request | Neither counts | As expected | Pass | A rejected venue can be asked for again once circumstances change |
| TC-169 | A venue already requested for this event is refused with a reason | A PENDING request for this event and venue | 1. Open the booking screen for that pairing | An alert names the event, the status and the venue; no acknowledge controls and no request action; nothing is sent | As expected | Pass | F1 AC4 at the screen — raising a second request is refused before it can be attempted |
| TC-170 | Arriving straight into the form reports its back handler without crashing | Entered with an event and a venue, with a back-handler callback | 1. Open the booking screen | The suitability panel renders and the back handler is handed up; no runtime error | As expected | Pass | Regression for a crash found in UAT — `ReferenceError: Cannot access 'startOver' before initialization`. The effect that hands the handler up runs on the first render, which returns early while loading, so a handler declared after that early return was still in its temporal dead zone. Verified by restoring the old ordering: this case fails, and passes again once fixed |
| TC-171 | A pending request can be withdrawn, and asks in a dialog before it does | One PENDING request raised by this coordinator | 1. Expand it<br>2. Withdraw request<br>3. Keep request<br>4. Withdraw request<br>5. Yes, withdraw | Step 2 opens a confirmation dialog naming the event and venue; step 3 closes it and sends nothing; step 5 withdraws that booking | As expected | Pass | F1 AC4 — withdrawing frees the event and venue to be requested again. Same dialog pattern as the delete-draft confirmation in EventList, with the safe choice focused |
| TC-172 | A request that is not pending offers no withdraw | One APPROVED request | 1. Expand it | No withdraw action is offered | As expected | Pass | Only a request still awaiting Venue Staff is the raiser's to pull |
| TC-173 | A withdraw that fails is reported and does not claim success | The withdraw will fail | 1. Expand the request<br>2. Confirm the withdraw | The failure is shown; the request is not presented as withdrawn | As expected | Pass | The coordinator is never told a request is gone when it is not |
| TC-174 | Withdrawing is the only update, and only the raiser may do it | `firestore.rules` in force | 1. Inspect the `venue_bookings` update rule | Requires the coordinator role and `requested_by == request.auth.uid`; only PENDING to WITHDRAWN; only `status` and `withdrawn_at` may change | As expected | Pass | AC3 — the acknowledgement stays pinned (TC-147); withdrawal cannot be used to rewrite what was accepted |
| TC-175 | A window inside the venue's hours for that day passes | Hall A open FRIDAY 10:00–20:00; event Friday 10:00–17:00 | 1. Assess | No blocking failure; operating hours appear among the criteria evaluated; suitable | As expected | Pass | E7 AC4 |
| TC-176 | A window starting before the venue opens blocks the request | As TC-175 but the event starts 09:00 | 1. Assess<br>2. Attempt to submit having acknowledged it | Blocking failure on operating hours; the refusal names the venue's hours and the day; acknowledging it does not allow submission | As expected | Pass | E7 AC4 as a hard stop — a shut venue is not a judgement call |
| TC-177 | A venue that does not open that day at all blocks the request | Venue open MONDAY only; event on a Friday | 1. Assess | Blocking failure on operating hours; the refusal says it does not open on FRIDAY | As expected | Pass | E7 AC4 |
| TC-178 | A venue stating no hours at all is treated as open, not shut | Hall A lists no operating hours | 1. Assess with a full window | No blocking failure | As expected | Pass | Missing data is not a closure — the same stance E4 AC8 takes |
| TC-179 | A date with no times asks only that the venue opens that day | A date, no start or end time | 1. Assess a venue open that day<br>2. Assess one that is not | The first passes; the second is blocked on operating hours | As expected | Pass | The date alone is a usable question; the times narrow it |
| TC-180 | No date stated means the criterion is not evaluated at all | An event with no date | 1. Assess | Operating hours are absent from the criteria evaluated | As expected | Pass | A criterion with nothing stated behind it is not judged |

---

## E4 / SCRUM-120 — See when a venue is free

**Legend / standing test data:** *Hall A* = `VEN-001`, Central, open Monday and Tuesday 09:00–18:00, closed other
days. *Annex* = `VEN-002`, North, no operating hours recorded in the screen tests. October 2026 is the month
shown; Mon 12 Oct is "today". All times are local.

**How it is reached:** *View calendar* at the top right of the Venue catalogue header, for both Coordinators and
Venue Staff. It opens a month grid across **every venue**; filters narrow it to any set of venues (a dropdown
of checkboxes — none ticked is all of them), a location, and the kinds of entry shown. Choosing a day shows that day hour by hour for each venue still in view. *Back to catalogue* returns to
the list exactly as it was left, filters included.

**Design decisions (remind your group):**
1. **Month first, hours on demand.** A month cell lists its bookings, pending requests and blocks (three, then
   "+N more"); free time and closed hours are read in the day detail, where they can be shown exactly. On a
   phone the chips shrink to coloured bars and the detail carries the words.
2. **Pending requests do not occupy the venue.** They are dashed in the grid and hatched in the detail, but the
   time underneath still reads free: a pending request may yet be rejected, and FCFS is applied at approval.
3. **Setup and teardown default to zero.** AC5 asks for a booked period to include them, but how long they are
   is still an open customer question (`CLAUDE.md`). `SETUP_MINUTES` / `TEARDOWN_MINUTES` in
   `domain/venueCalendar.js` are the two values to change; TC-210 proves the widening works.
4. **Closed days are marked only for a single venue.** Opening days differ between venues, so with several in
   view no day is called closed; choose one venue and its closed days are shaded (AC3).
5. **Without operating hours there is no free time.** A venue with none recorded shows its bookings and blocks,
   and the rest as *no data*, rather than claiming it is free (AC8).
6. **Event names are for internal roles only** (Coordinator, Venue Staff, Technical Support). Everyone else sees
   *Booked*. Today only internal roles can reach the calendar, and `firestore.rules` already limits
   `venue_bookings` reads to Coordinators and Venue Staff, so AC4 is also held server-side.
7. **Test IDs start at TC-200**, leaving the numbers below it to E8, whose range was still growing when E4 was written.
8. The rules are in `frontend/src/domain/venueCalendar.js` — no React, no Firebase.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
|---|---|---|---|---|---|---|---|
| TC-200 | An open day with nothing on it | Hall A open Mon 09:00–18:00; no bookings or blocks | 1. Build Hall A for Mon 12 Oct 2026 | 00:00–09:00 closed, 09:00–18:00 free, 18:00–24:00 closed | As expected | Pass | AC1, AC3 |
| TC-201 | An approved booking is occupied | Approved booking *Annual Gala* 12:00–14:00 | 1. Build Mon 12 Oct | Free 09:00–12:00, booked 12:00–14:00, free 14:00–18:00 | As expected | Pass | AC1, AC5 |
| TC-202 | An unavailability period is blocked | Block 09:00–11:00, reason *Electrical maintenance* | 1. Build Mon 12 Oct | Blocked 09:00–11:00 carrying the reason | As expected | Pass | AC1, AC6 |
| TC-203 | A multi-day block covers its whole duration | Block Mon 15:00 → Wed 10:00, reason *Renovation* | 1. Build Mon–Wed | Mon blocked 15:00–24:00; Tue blocked all day; Wed blocked 00:00–10:00 | As expected | Pass | AC6; E3 AC2 — a block outranks closed hours |
| TC-204 | Pending requests are distinct and do not occupy | Pending *Product Launch* 10:00–12:00 | 1. Build Mon 12 Oct | No booked time; 09:00–18:00 still free; the request is listed separately as pending | As expected | Pass | AC2 — a pending request may still be rejected |
| TC-205 | Rejected and withdrawn requests are not shown | One REJECTED and one WITHDRAWN booking | 1. Build Mon 12 Oct | Day is free; nothing pending | As expected | Pass | AC1 — only approved bookings occupy |
| TC-206 | A weekday with no hours is closed | Hall A has no Wednesday hours | 1. Build Wed 14 Oct | Closed 00:00–24:00 | As expected | Pass | AC3 |
| TC-207 | Internal users see the event name | Approved *Annual Gala* | 1. Build as Coordinator, Venue Staff and Technical Support | Booked block labelled *Annual Gala* for all three | As expected | Pass | AC4 |
| TC-208 | External users do not see the event name | Approved and pending bookings | 1. Build as Organiser, Attendee and no role | Labels read *Booked* and *Pending request* | As expected | Pass | AC4 |
| TC-209 | Internal roles are exactly the three staff roles | — | 1. Check each of the five roles | Coordinator, Venue Staff, Technical Support internal; Organiser and Attendee not | As expected | Pass | AC4; roles from `domain/roles.js` |
| TC-210 | Setup and teardown widen a booked period | Booking 12:00–14:00; setup 60 min, teardown 30 min | 1. Build Mon 12 Oct | Booked 11:00–14:30 | As expected | Pass | AC5. The real durations are an open question, so the defaults are 0 (design decision 3) |
| TC-211 | A booking stored as date + times is placed correctly | Booking `event_date` 2026-10-13, 10:00–11:30 | 1. Build Mon–Tue | Monday free; Tuesday booked 10:00–11:30 | As expected | Pass | Both storage shapes in `venue_bookings` |
| TC-212 | Another venue's entries are ignored | Booking and block on VEN-002 | 1. Build VEN-001 | VEN-001 day is free | As expected | Pass | AC1 |
| TC-213 | Touching bookings leave no gap or overlap | *Morning* 09:00–12:00, *Afternoon* 12:00–15:00 | 1. Build Mon 12 Oct | Two booked blocks in order; free 15:00–18:00 | As expected | Pass | Mirrors F6 AC2 |
| TC-214 | An unknown venue is not found | Venue ID VEN-404 | 1. Build | `found` = false; no days | As expected | Pass | AC8 |
| TC-215 | A venue with no hours has no availability data | Venue with empty operating hours and one block | 1. Build | `hasAvailabilityData` = false; block shown; the rest is *unknown*, not free | As expected | Pass | AC8 — free time is never claimed without hours |
| TC-216 | The date range is validated | — | 1. Valid week<br>2. End before start<br>3. 46 days<br>4. Missing start | Seven days; *on or after* error; *31 days* error; *choose* error | As expected | Pass | Guards the day-detail builder |
| TC-217 | A month grid runs Monday to Sunday | October 2026 (1st is a Thursday) | 1. Build the grid | Five full weeks, 28 Sep – 1 Nov, seven days each | As expected | Pass | Wall-calendar layout |
| TC-233 | Months step across a year and read as words | — | 1. Step Dec 2026 forward<br>2. Step Jan 2026 back<br>3. Label Oct 2026 | 2027-01; 2025-12; *October 2026* | As expected | Pass |  |
| TC-234 | By default the month covers every venue | Hall A (booked 12 Oct), Annex (pending 12 Oct, rejected 12 Oct) | 1. Build October with no filters | Both venues kept; 12 Oct lists the pending Annex request then the Hall A booking; the rejected one is absent; 28 Sep marked outside the month | As expected | Pass | AC1, AC2 — all venues by default |
| TC-235 | A multi-day block appears on each day | Hall A blocked 20 Oct 15:00 → 22 Oct 10:00 | 1. Build October | 20th 15:00–24:00; 21st all day; 22nd 00:00–10:00 | As expected | Pass | AC6 |
| TC-236 | Venue filter | As TC-234 | 1. Tick VEN-001 only | Only Hall A and its entries | As expected | Pass | AC1 — a chosen venue |
| TC-237 | Location filter | Hall A CENTRAL, Annex NORTH | 1. Filter to NORTH | Only Annex and its pending request | As expected | Pass |  |
| TC-238 | Kind filter | As TC-234 | 1. Show booked only | Pending and blocked entries hidden | As expected | Pass | AC7 |
| TC-239 | One venue's closed days are marked | Hall A open Mon–Tue | 1. Tick Hall A only<br>2. Build with no venue ticked | Wed 14 Oct closed for Hall A; no day marked closed across several venues | As expected | Pass | AC3 |
| TC-240 | External viewers see no event names in the month | As TC-234 | 1. Build as Organiser | Labels *Pending request* and *Booked* | As expected | Pass | AC4 |
| TC-241 | An unknown venue is not found | Venue ID VEN-404 asked for | 1. Build | `found` = false; no venues | As expected | Pass | AC8 |
| TC-242 | Several venues can be chosen at once | As TC-234 | 1. Tick Annex and Hall A | Both venues kept, A–Z; both entries on 12 Oct; no day called closed | As expected | Pass | Multi-select venue filter |
| TC-243 | No venue ticked means every venue | As TC-234 | 1. Build with an empty venue list | Both venues kept | As expected | Pass | All venues by default |
| TC-218 | The calendar opens on this month across every venue | Today = Mon 12 Oct | 1. Open the calendar | Heading *October 2026*; the closed Venues field reads *All venues*; columns Mon–Sun; 12 Oct shows Hall A's booking and block and Annex's booking | As expected | Pass | AC1 |
| TC-219 | The chosen day shows each venue's free, booked and blocked time | As TC-218 | 1. Read the day detail | *Monday 12 October 2026*; Hall A *Open 09:00–18:00* with *Booked*, *Blocked* and *Free* badges; legend lists all five states | As expected | Pass | AC1, AC3, AC7 — colour is never the only signal |
| TC-220 | Pending shown apart from booked | Pending *Product Launch* on Tue 13 Oct | 1. Read the 13 Oct cell<br>2. Choose 13 Oct | Dashed pending chip; detail shows *Pending*, no *Booked* | As expected | Pass | AC2 |
| TC-221 | One venue's closed days are shown | Hall A ticked in Venues | 1. Read Wed 14 Oct<br>2. Choose it | Cell reads *Closed*; detail reads *Closed all day* | As expected | Pass | AC3 |
| TC-222 | External viewer does not see event names | Signed in as Organiser | 1. Open the calendar | No event name anywhere; *Booked* shown | As expected | Pass | AC4 |
| TC-223 | Month navigation | — | 1. Next month<br>2. Previous month twice<br>3. Today | November, then September, then October 2026 | As expected | Pass |  |
| TC-224 | Venue multi-select on screen | — | 1. Open Venues, tick Annex<br>2. Also tick Hall A<br>3. Untick Hall A, tick *All venues* | Field reads *Annex* (1 chip on 12 Oct); then both venues (3 chips, both in the day detail); then *All venues* with Annex unticked | As expected | Pass | AC1 |
| TC-225 | Location and kind filters, and clearing them | — | 1. Location = Central<br>2. Untick Blocked<br>3. Clear filters | 12 Oct shows 2 chips, then 1, then all 3; location reset | As expected | Pass | AC7 |
| TC-226 | No availability data is stated | Annex has no hours | 1. Tick Annex in Venues | Status message *No availability data* | As expected | Pass | AC8 |
| TC-227 | A missing venue is stated | Venue ID VEN-404 | 1. Open the calendar on it | Status message *venue could not be found*; no grid | As expected | Pass | AC8 |
| TC-228 | Back returns to the catalogue | — | 1. Click *Back to catalogue* | `onBack` called | As expected | Pass |  |
| TC-231 | A busy day shows three entries and a count | Five bookings on Thu 15 Oct | 1. Read the 15 Oct cell | Three chips and *+2 more* | As expected | Pass | Keeps the grid readable |
| TC-229 | Venue Staff's catalogue swaps to the calendar | Signed in as Venue Staff | 1. Open the calendar<br>2. Open Venues<br>3. Click *Back to catalogue* | No per-venue calendar button; Venues reads *All venues* and lists *All venues*, Annex, Hall A; Back closes it | As expected | Pass | Entry point |
| TC-230 | Coordinator returns from the calendar to the same filters | Coordinator; Location filter = CENTRAL | 1. Open the calendar<br>2. Close it | Month grid with Venues reading *All venues*; catalogue Location filter still CENTRAL afterwards | As expected | Pass | Entry point — E4's own actor |
| TC-232 | *View calendar* sits in the Venue catalogue header | Coordinator, then Venue Staff | 1. Open Venue catalogue<br>2. Click *View calendar*<br>3. Click Venue catalogue in the sidebar | Button in the page header; calendar shown and the button hidden while open; the sidebar returns to the list. Not offered on other screens | As expected | Pass | Top right of the page |
| TC-244 | The Venues dropdown starts closed | — | 1. Render it with nothing ticked | Reads *All venues*; `aria-expanded` false; no checkboxes on the page | As expected | Pass | Keeps the filter compact |
| TC-245 | Opening it lists every option | Annex, Hall A, Rooftop | 1. Click the field | `aria-expanded` true; *All venues*, Annex, Hall A, Rooftop in order; *All venues* ticked | As expected | Pass |  |
| TC-246 | Several can be ticked; the field summarises | — | 1. Tick Hall A<br>2. Tick Rooftop | Field named *Venues Hall A*, then reads *2 venues*; list stays open; both ticked | As expected | Pass | Multi-select |
| TC-247 | *All venues* clears the others | Hall A and Rooftop ticked | 1. Tick *All venues* | Field reads *All venues*; Hall A unticked | As expected | Pass |  |
| TC-248 | Escape closes and returns focus | List open | 1. Press Escape | List gone; focus on the field | As expected | Pass | Keyboard use (A4 checklist) |
| TC-249 | Clicking elsewhere closes | List open | 1. Click outside the field | List gone | As expected | Pass |  |

---

## Open defects

None. TC-043 to TC-046 were the four B9 acceptance criteria the form did not satisfy when these tests were
first written. All four are implemented and now pass, along with the unique reference number B9 AC5 asks for
(TC-066).

One assumption was needed to close TC-046, and is recorded under **Open questions** in `CLAUDE.md` rather than
settled here: B9 AC2 requires accessibility needs to be *answered* before submission, and the customer has not
said whether a request with no accessibility needs counts as answered. The form takes the literal reading — an
explicit No is an answer, an untouched question is not. If Session 3 says otherwise, the rule is one line in
`domain/eventRequest.js`.

---

## E7 — Know whether a venue actually suits the event

| Test Case ID | Test Scenario | Expected Result | Actual Result | Status | Remarks |
|---|---|---|---|---|---|
| TC-112 | A venue fails several requested criteria | Assessment names the capacity, each missing facility/accessibility feature, layout and operating-hours failures; passing requirements are still listed | As expected | Pass | AC1–AC4 |
| TC-113 | Attendance equals capacity and event exactly fits opening/closing times | Venue is suitable; all five criterion groups are shown as passing | As expected | Pass | Capacity and time boundaries |
| TC-114 | Requested time is outside hours or the venue has no hours listed | Operating-hours criterion fails with the applicable reason | As expected | Pass | AC4 |
| TC-115 | Submit the suitability form with an unmet capacity and facility requirement | Outcome says Not suitable, names both failures and shows other evaluated criteria | As expected | Pass | AC1, AC5 |
| TC-116 | Submit the suitability form for a venue that meets all requirements | Outcome says Suitable and shows every evaluated criterion | As expected | Pass | AC5 |

---

## C6 / SCRUM-TBD — Approve a submitted request

> As an Event Coordinator, I want to approve a request I have reviewed so that it can proceed to planning.

**Scope:** this story is the **Approve** transition only (Under Review -> Approved). The confirm gate (venue + technical arrangements -> Confirmed) is owned by **D3**. IDs run from TC-112 because TC-081 - TC-111 are reserved by the spec-first `test.js` suite (C5, E2, E5, E6). SCRUM ticket to be filled in. Note: these IDs overlap the venue epic's TC-112+ numbering in this document only — reconcile in the team's test-case sheet if needed.

Pre-condition for every case: an Event Coordinator is signed in, and the event named is assigned to a coordinator as the row states.

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-112 | Happy path - the assigned coordinator approves a request that is under review | E1 is `Under Review`, assigned to coordinator C1; C1 signed in | 1. Open E1<br>2. Approve E1 | E1.status becomes `Approved`; the decision, `deciding_coordinator_id` = C1 and a decision timestamp (SGT) are recorded |  | Not Executed | AC1, AC2 - happy path |
| TC-113 | Approve is offered only from Under Review | E1 set to `Submitted`, then `Approved`, then `Rejected`, then `Draft` in turn; C1 signed in | For each status: attempt to approve E1 | Blocked each time; status unchanged and nothing is written | | Not Executed | AC1 - negative/boundary. Runs as four variants |
| TC-114 | Only the assigned coordinator may approve | E1 `Under Review`, assigned to C1; a different coordinator C2 signed in | Attempt to approve E1 as C2 | Refused; E1 is unchanged | | Not Executed | AC3 (with A4/A5) |
| TC-115 | Approve is unavailable while a clarification request is open | E1 `Under Review` with an open clarification request (C4); C1 signed in | 1. Attempt to approve E1<br>2. Close the clarification (organiser responds)<br>3. Attempt to approve again | The first attempt is blocked (awaiting the organiser); after the clarification closes, approve succeeds and status becomes `Approved` | | Not Executed | AC4 - interaction with C4 AC2 |
| TC-116 | Approval writes an audit-history entry | E1 `Under Review`, assigned to C1 | Approve E1 | An `event_history` entry (`action_type` = `EVENT_APPROVED`, actor C1, timestamp in SGT) is written | | Not Executed | AC5 - audit, ties to D6 |
| TC-117 | The client cannot approve by writing the status directly (server-side rule) | E1 `Under Review`; `firestore.rules` in force | Attempt a direct client write setting `status = Approved` (or the decision fields) on E1 | The write is rejected by `firestore.rules`; only the backend may make the transition | | Not Executed | integrity (A4) - assert via `firestoreRules.test.js` |

---

## C2 / SCRUM-103 — See the events I am responsible for

> As an Event Coordinator, I want a list of the event requests assigned to me so that I know what I am accountable for.

**Acceptance criteria:** AC1 — the list contains only events assigned to the signed-in coordinator. AC2 — each row shows event name, organiser, proposed date, current status and time since last activity. AC3 — the list can be filtered by status and sorted by proposed date.

**Scope:** AC1 is enforced at the data layer (`reviewApi.list()` queries only events whose `coordinator_id` is the signed-in coordinator) and by `firestore.rules`. The list-shaping rules live as pure functions in `frontend/src/domain/assignedEvents.js`, unit-tested in `assignedEvents.test.js`; the screen behaviour is covered in `frontend/src/features/events/EventReviewScreen.test.js`. Note: TC-118 – TC-128 overlap the venue epic's TC-112+ numbering in this document only — reconcile in the team's test-case sheet if needed.

Pre-condition for the functional cases: an Event Coordinator is signed in and the events named are assigned to them.

**Unit test cases — `frontend/src/domain/assignedEvents.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-118 | Only the signed-in coordinator's events are kept | A mix of events assigned to C1 and C2 | 1. onlyForCoordinator(events, 'c1')<br>2. buildAssignedView(events, coordinatorId c1) | Only the C1 events are returned, in input order | | Not Executed | AC1 - pure scoping rule |
| TC-119 | A row exposes all five columns, organiser falling back | Event with and without organiser_name, organiser_id, name | Build assignedRow(event) | name, organiser, proposedDate, status and a time-since label present; organiser falls back name then id then "Unknown"; name falls back to "Untitled event" | | Not Executed | AC2 - columns and fallbacks |
| TC-120 | Time since last activity reads naturally and copes with none | Activity at 30s, 1m, 5m, 1h, 3d ago, and none; and an event with only created_at | Call timeSince(...) / build a row | "Just now", "1 minute ago", "5 minutes ago", "1 hour ago", "3 days ago", "No activity yet"; last activity falls back to created_at | | Not Executed | AC2 - relative time |
| TC-121 | Filter by a status keeps only that status; ALL keeps everything | Rows across SUBMITTED and APPROVED | filterByStatus(rows, 'SUBMITTED'), then ALL, then empty | Only SUBMITTED rows for the first; all rows for ALL and empty | | Not Executed | AC3 - filter |
| TC-122 | Sort by proposed date orders ascending and descending | Rows with three different dates | Call sortByProposedDate ascending, then descending | Ascending then descending order by proposed date | | Not Executed | AC3 - sort |
| TC-123 | A row with no proposed date sorts last in both directions | Rows plus one undated row | Sort ascending, then descending | The undated row is last either way | | Not Executed | AC3 - sort boundary |
| TC-124 | statusOptions lists ALL first then the distinct statuses present | Events across two statuses, one repeated | Call statusOptions(events) | ALL first, then APPROVED and SUBMITTED, de-duplicated and sorted | | Not Executed | AC3 - filter options |
| TC-125 | buildAssignedView scopes, filters and sorts together | C1 and C2 events across statuses and dates | buildAssignedView(events, coordinatorId c1, status SUBMITTED, sort asc) | Only C1's SUBMITTED events, ascending by proposed date | | Not Executed | AC1 + AC2 + AC3 - pipeline |

**Functional test cases — `frontend/src/features/events/EventReviewScreen.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-126 | Each assigned row renders the five columns | One event assigned to the coordinator | Render the assigned list | The row shows event name, organiser, proposed date, status and a "Last activity: ..." label | | Not Executed | AC2 - rendered columns |
| TC-127 | The status filter narrows the list | Three assigned events across SUBMITTED and APPROVED | 1. Render the list<br>2. Choose "SUBMITTED" in the "Filter by status" control | Only the SUBMITTED event remains visible | | Not Executed | AC3 - filter |
| TC-128 | Sorting by proposed date reorders the rows | Three assigned events with different proposed dates | 1. Render (ascending by default)<br>2. Activate "Sort by proposed date" | Rows ascending by date first, then descending after the toggle | | Not Executed | AC3 - sort |

**Security test cases — `frontend/src/security/firestoreRules.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-347 | A coordinator may read organiser profiles, and no other role's | firestore.rules in force | Inspect the `users` get rule | The coordinator clause is limited to `role == 'EVENT_ORGANISER'`; attendee and other staff profiles are not opened | As expected | Pass | AC2 — the organiser column and event details read `users/{organiser_id}`. Found 15 Oct 2026: the Review queue failed with "Missing or insufficient permissions." once the committed rules were deployed |

---

## J1 / SCRUM-150 — Have one place where things needing my attention appear

> As a ConnectSphere user, I want the things that concern me collected in one inbox so that I do not have to keep checking every event.

**Acceptance criteria:** AC1 — notifications are delivered to a per-user in-system inbox showing message, related event and timestamp. AC2 — a user receives only notifications for events they are related to by role. AC3 — unread notifications carry an unread indicator and are counted in a badge on the inbox; opening one marks it read and decrements the count. AC4 — read notifications remain listed and viewable.

**Scope:** every role's Notifications screen is the inbox (`frontend/src/features/notifications/`). The workspace holds one live subscription, so the sidebar badge and the inbox count the same list. AC2 is enforced where notifications are written and in `firestore.rules`: a user reads only notifications addressed to them, and may change nothing but the read marker. Ordering, counting and labelling are pure functions in `frontend/src/domain/notifications.js`. Each row also offers **View**, which opens the related event on the screen that role already uses for one event: the organiser's event request page, or the coordinator's Assigned events detail. Roles with no such screen yet, and events the user can no longer read, get no View.

**AC coverage:** AC1 — TC-250, TC-253 – TC-255, TC-259, TC-279, TC-281. AC2 — TC-262, TC-279, TC-284. AC3 — TC-251, TC-252, TC-256, TC-257, TC-260, TC-261, TC-280, TC-282. AC4 — TC-258, TC-262, TC-282. View — TC-263 – TC-268.

**Unit test cases — `frontend/src/domain/notifications.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-250 | Notifications list newest first, undated last | Three notifications: one older, one newer, one with no timestamp yet | Call newestFirst(list) | Newer, then older, then the undated one; the input list is not reordered | | Not Executed | AC1 - ordering |
| TC-251 | Only notifications not yet read count as unread | A mix of read, unread and unmarked notifications | Call unreadCount(list) | Unread and unmarked are counted; an empty list counts 0 | | Not Executed | AC3 - count |
| TC-252 | The badge is absent at zero and capped at 99+ | Counts 0, 3, 99, 100 | Call badgeText(count) | No badge at 0; "3", "99", then "99+" | | Not Executed | AC3 - badge |
| TC-253 | The related event reads as name and reference | Events with both, either, neither; and no event | Call eventLabel(event) | "Name (EVT-...)", then name, reference, "Untitled event"; null when the event cannot be read | | Not Executed | AC1 - related event |
| TC-254 | Each stored type has words | Known types and an unknown one | Call notificationTypeLabel(type) | Known types read in words; an unknown one reads "Update" | | Not Executed | AC1 - message heading |
| TC-263 | View goes to each role's own event screen | Each of the five roles, and an unknown role | Call eventViewScreen(role) | Organiser: "New event request"; Coordinator: "Assigned events"; Venue Staff, Technical Support, Attendee and an unknown role: none | | Not Executed | View - routing rule |

**Functional test cases — `frontend/src/features/notifications/NotificationInbox.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-255 | Each row shows the message, the related event and when it arrived | One unread notification for event E1 | Render the inbox | The row shows the type, the message, "Name (EVT-...)" and a time stamped with created_at | | Not Executed | AC1 |
| TC-256 | Unread rows carry the unread marker; read rows do not | One unread and one read notification | Render the inbox | Only the unread row has the dot, the bolder heading and the "Unread" label | | Not Executed | AC3 - indicator |
| TC-257 | Opening an unread notification marks it read | One unread notification | 1. Render the inbox<br>2. Open the notification | The row expands with its detail and the inbox asks for it to be marked read | | Not Executed | AC3 - mark read |
| TC-258 | A read notification stays listed and is not marked again | One read notification whose event is no longer readable | 1. Render the inbox<br>2. Open it | It is still listed and opens; nothing is written; the event reads "Event no longer available" | | Not Executed | AC4 |
| TC-259 | An empty inbox says so | No notifications | Render the inbox | "You have no notifications yet." | | Not Executed | AC1 - empty state |
| TC-264 | View opens the related event and marks the notification read | One unread notification for a readable event E1 | 1. Render the inbox with a View handler<br>2. Click "View" on the row | The handler receives E1's record and the notification is marked read | | Not Executed | View |
| TC-265 | No View when there is nowhere to go | 1. A notification whose event is no longer readable<br>2. A role with no event screen | Render the inbox for each | No View button in either case; the first row reads "Event no longer available" | | Not Executed | View - boundary |

**Functional test cases — `frontend/src/app/Workspace.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-260 | Every role sees the unread count on Notifications | Three unread notifications; each of the five roles in turn | Render the workspace | The Notifications item carries a badge reading 3, labelled "3 unread" | | Not Executed | AC3 - badge |
| TC-261 | With nothing unread there is no badge | No unread notifications | Render the workspace | No unread badge is shown | | Not Executed | AC3 - badge |
| TC-266 | An organiser's View opens that event request | Organiser on Notifications; a notification for E1 | Click "View" on the notification | The organiser's event request page opens for E1, with "Back to notifications" | | Not Executed | View - organiser |
| TC-267 | A coordinator's View opens that event under Assigned events | Coordinator on Notifications; a notification for E1 | Click "View" on the notification | Assigned events opens with E1's detail, with "Back to notifications" | | Not Executed | View - coordinator |
| TC-268 | Roles with no event screen are offered no View | Venue Staff, Technical Support, Attendee in turn, on Notifications | Render the workspace | No View button is offered | | Not Executed | View - boundary |

**Functional test cases — `frontend/src/features/notifications/notificationsApi.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-279 | The inbox asks only for the signed-in user's notifications, newest first | User u1 signed in | 1. Start the inbox subscription for u1<br>2. Deliver two notifications | The query is notifications where user_id == u1; the list arrives newest first with ISO timestamps | | Not Executed | AC2 - client scope; AC1 - order |
| TC-280 | Marking a notification read writes only the read marker | Notification n1 | Call markNotificationRead('n1') | notifications/n1 is updated with is_read true and a server read_at, nothing else | | Not Executed | AC3 - mark read |
| TC-281 | An event the user can no longer read comes back empty | Events e1 (readable), one denied, one deleted, with a repeat and a blank id | Call eventsFor(ids) | e1's record, null for the other two, each event read once | | Not Executed | AC1 - related event |

**Functional test cases — `frontend/src/features/notifications/useNotifications.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-282 | Opening an unread notification drops the unread count | Two unread and one read notification delivered | 1. Mark n1 read<br>2. Deliver the updated list | The count goes 2, then 1; all three stay listed; leaving the screen ends the subscription | | Not Executed | AC3 - decrement; AC4 |
| TC-283 | A failed load or mark-read is reported | Subscription errors; then the mark-read write is refused | 1. Fail the subscription<br>2. Mark a notification read | Each shows its own error message | | Not Executed | AC1/AC3 - error states |

**Security test cases — `frontend/src/security/firestoreRules.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-262 | Notifications are private and only ever marked read | firestore.rules in force | 1. Read another user's notification<br>2. Change a notification's message, recipient or mark it unread<br>3. Delete a notification | All three are refused; the only permitted update sets is_read true with read_at, on the user's own notification | | Not Executed | AC2 + AC3 + AC4 - assert via `firestoreRules.test.js` |
| TC-284 | A notification is only ever addressed to someone related to its event | firestore.rules in force | Attempt to create a notification for a user who is neither the event's organiser nor its coordinator, or from a user not related to the event | Refused; every create branch requires the writer to be related to the event and ties the recipient to its organiser_id or coordinator_id | | Not Executed | AC2 - assert via `firestoreRules.test.js` |

---

## UI — Event detail tabs: the request and its clarifications

**Scope:** every event detail page is split into two tabs, **Event request** and **Clarifications**, under the event's heading. The organiser's page (`features/events/OrganiserEventDetail.js`) and the coordinator's review detail (`EventReviewScreen.js`) share the tab bar (`components/EventDetailTabs.js`) and the exchange (`components/ClarificationThread.js`). A draft has no tabs. The Clarifications tab counts the questions asked, and when the organiser owes an answer it is flagged and opens first. Request clarification moved to the Clarifications tab; Reject, Reassign and Find venues stay on the request. TC-060 – TC-063 now open the Clarifications tab before their steps, and TC-076 renders the decision from detail handed in by the page.

**Unit test cases — `frontend/src/domain/eventReview.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-269 | The Clarifications tab counts questions and knows when an answer is owed | Details with two questions and one open; with none; and no detail | Call clarificationSummary(detail) | { requests: 2, awaitingOrganiser: true }; then 0 and false for the other two | | Not Executed | Tab badge |
| TC-270 | Only an organiser who owes an answer starts on Clarifications | Open and answered clarifications; organiser and coordinator viewers | Call initialEventTab(detail, viewer) | Clarifications only for the organiser with an open question; Event request otherwise | | Not Executed | Default tab |

**Functional test cases — `frontend/src/features/events/components/EventDetailTabs.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-271 | Tabs switch by click and keyboard, keeping the other panel mounted | Two tabs, a field typed into on the first | 1. Type into the field<br>2. Click Clarifications<br>3. Press ArrowRight, then End | The chosen tab is selected and its panel shown; focus follows the arrow keys; the typed value survives the switch | | Not Executed | Tab bar - ARIA tabs pattern |
| TC-272 | The Clarifications tab shows its count and a reply-needed cue | Two clarifications, then one owed | Render the tab bar without and with attention | "Clarifications 2"; with attention the count takes the accent and the tab announces "reply needed" | | Not Executed | Tab bar - badge |

**Functional test cases — `frontend/src/features/events/OrganiserEventDetail.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-273 | A draft is just the form | Organiser opens a draft | Render the event request page | No tabs; the editable form; no review detail is loaded | | Not Executed | Organiser page - draft |
| TC-274 | A submitted request opens on its read-only request | Organiser opens a submitted request with no clarification | 1. Render the page<br>2. Open Clarifications | Event request tab selected, decision summary and read-only form shown; Clarifications says none has been requested | | Not Executed | Organiser page - C7 |
| TC-275 | An owed answer opens Clarifications, and replying closes the amend window | Organiser opens a request Under Review with an open clarification | 1. Render the page<br>2. Type a response and send | Clarifications is selected with the question shown; the response is sent and confirmed; the form becomes read-only | | Not Executed | Organiser page - C5 |

**Functional test cases — `frontend/src/features/events/EventReviewScreen.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-276 | The coordinator's detail opens on the request | Coordinator opens an event with one clarification | 1. Open the event<br>2. Open Clarifications | Event request selected with the details shown and "Clarifications 1"; the history appears only on its tab | | Not Executed | Coordinator page |
| TC-277 | Each action is on the tab it belongs to | Coordinator opens an event Under Review | Look at each tab | Reject and Reassign on Event request; Request clarification on Clarifications | | Not Executed | Coordinator page - actions |
| TC-278 | Switching tab closes a half-written action | Coordinator has opened the Reject form | Switch to Clarifications and back | The Reject form is gone and nothing was sent | | Not Executed | Coordinator page - actions |

## J6 / SCRUM-155 — Be told the outcome of my booking and equipment requests

> As an Event Coordinator, I want the outcomes pushed to me so that I know whether the event can be confirmed without polling two queues.

**Acceptance criteria:** AC1 — the coordinator is notified when a booking request is approved or rejected, with the reason on rejection. AC2 — the coordinator can open that venue booking from the notification and check its date and time. AC3 — the coordinator is notified when an equipment request is marked arranged or unable to be fulfilled. AC4 — the coordinator can open that equipment request from the notification and check its date, time and quantity.

**Scope:** a venue booking approval (`approveVenueBooking`) writes a `VENUE_BOOKING_APPROVED` notification to the coordinator who raised the booking (`requested_by`) in the same transaction, carrying `booking_id`. `firestore.rules` accepts a venue booking outcome only from the Venue Staff member deciding that booking, to its raiser, in the same commit as the decision (`decided_at` and `created_at` are both the request time), and through no other clause. The equipment service writes `EQUIPMENT_UNABLE_TO_FULFIL` (per line, with the reason) and `EQUIPMENT_ARRANGED` (when the last open line is reserved or resolved) to the event's current coordinator inside its own transactions; no browser may create either type. View on these opens Venue bookings with that booking expanded, or Equipment requests with that event's request and Technical Support updates open.

**Not yet covered:** booking *rejection* (half of AC1). F5 / SCRUM-129 (reject with a reason) is not built; when it is, it calls `venueBookingOutcomeMessage({ approved: false, reason })` and writes `VENUE_BOOKING_REJECTED` with `booking_id` and `created_at` equal to its `decided_at`, which the rule and inbox already accept. TC-313 and TC-318 check the rejection half of the rule and the message only; no test exercises a rejection end to end. A booking raised before a K3 reassignment notifies the coordinator who raised it, since Venue Staff cannot read the event to find its current coordinator. The rule tests read the policy text; behavioural evidence for the rule needs the Rules Playground or the emulator, as for TC-015.

**AC coverage:** AC1 (approval; rejection awaits F5) — TC-313, TC-317 – TC-319, TC-335 – TC-338, TC-344. AC2 — TC-317, TC-320, TC-321, TC-324, TC-337 – TC-340, TC-343. AC3 — TC-314 – TC-316, TC-319, TC-325 – TC-334, TC-338, TC-344, TC-346. AC4 — TC-320, TC-322, TC-323, TC-338, TC-341 – TC-343, TC-345.

**Executed:** 15 Oct 2026, every case below twice, plus a mutation check: each of 36 deliberate breakages of the J6 code and rules was caught by at least one of these cases.

**Server rule — `frontend/src/security/firestoreRules.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-313 | A booking outcome is told only by its decider, to its raiser, with the decision | firestore.rules | Read the notifications create rule | The booking (read after the write) must match the notice's event and venue, have been raised by the recipient and decided by the writer, an assigned Venue Staff member, at this request's time, with the notice created at the same time, and hold the status the type names (approved / rejected); the clause needs a booking_id | As expected | Pass | AC1 - server rule |
| TC-344 | Outcome types go through no other clause; equipment outcomes never from a browser | firestore.rules | Read the notifications create rule | The whole rule refuses EQUIPMENT_ARRANGED / EQUIPMENT_UNABLE_TO_FULFIL, and those types appear nowhere else in the rules; the ordinary clauses are closed to the venue booking outcome types | As expected | Pass | AC1, AC3 - server rule |

**Venue booking approval — `frontend/src/features/venues/venuesApi.workflow.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-317 | Approval notifies the coordinator who raised the booking | Pending booking VB-001 raised by COORD-001 for Q4 Partner Summit at Harbour Hall | Venue Staff approve it | Exactly one document is written to notifications: VENUE_BOOKING_APPROVED to COORD-001 for EVT-001, carrying VB-001 and VEN-001, unread, reading "Q4 Partner Summit: the booking for Harbour Hall was approved." | As expected | Pass | AC1, AC2 |
| TC-335 | A booking with no recorded raiser | Pending booking with no requested_by | Venue Staff approve it | Approved; nothing is written to notifications | As expected | Pass | AC1 - boundary |
| TC-336 | A refused approval tells nobody | Pending booking overlapping an approved one | Venue Staff try to approve it | Refused as a clash; nothing is written at all | As expected | Pass | AC1 - negative |
| TC-337 | One approval, one complete notification | Pending booking with no event name | Venue Staff approve it | Exactly one notifications document with every inbox field, booking_id and venue_id; the message falls back to "Your event" | As expected | Pass | AC1, AC2 |

**Equipment outcomes — `backend/src/services/equipment/outcomeNotifications.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-325 | The arranged message lists what was reserved and counts what was not | All reserved; one reserved and two refused; all refused | Call arrangedMessage | Quantities and types in words; "2 lines were" / "1 line was unable to be fulfilled"; "Your event" when unnamed | As expected | Pass | AC3 |
| TC-326 | The unable message names quantity, type and trimmed reason | A line of 3 visual, reason with spaces | Call unableMessage | "… cannot fulfil 3 × visual. Reason: Projector under repair."; "Your event" when unnamed | As expected | Pass | AC3 |
| TC-327 | The notification goes to the current coordinator in the inbox's shape | Event with coordinator coord-2 | Call notifyCoordinator | One notifications document with every inbox field, unread, addressed to coord-2, plus the extra fields | As expected | Pass | AC3 |
| TC-328 | No event or no coordinator, nothing written | Missing event; event with no or an empty coordinator; no snapshot | Call notifyCoordinator | Returns null and creates nothing; the event name falls back to its reference, then to empty | As expected | Pass | AC3 - boundary |

**Equipment outcomes — `backend/src/services/equipment/requests.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-314 | A line marked unable to be fulfilled tells the coordinator why | Two open lines; event coordinator coord-1 | Mark line 2 unable to fulfil with a reason | Exactly one EQUIPMENT_UNABLE_TO_FULFIL notification, to coord-1, unread, naming the event, quantity, type and reason, with the line index | As expected | Pass | AC3 |
| TC-315 | Resolving the last open line also says the request is arranged | Line 1 reserved, line 2 open | Mark line 2 unable to fulfil | Two notifications, unable then arranged; the arranged one lists the reserved line and "1 line was unable to be fulfilled" | As expected | Pass | AC3 |
| TC-316 | No coordinator, no notification | Event with no coordinator | Mark the only line unable to fulfil | The request is Arranged; no notification is written | As expected | Pass | AC3 - boundary |
| TC-331 | An amendment is not an outcome | One open line | Amend it with a note | No notification | As expected | Pass | AC3 - negative |
| TC-332 | A refused resolution writes nothing | Blank reason; request already Arranged; line already reserved; line with an active reservation; unknown line | Try to mark it unable to fulfil | Each is refused with its message; no notification and no update | As expected | Pass | AC3 - negative |
| TC-333 | Several refused lines are counted in the plural | Line 1 resolved, line 2 open | Mark line 2 unable to fulfil | The arranged notification reads "2 lines were unable to be fulfilled." with no "Reserved:" part | As expected | Pass | AC3 |

**Equipment outcomes — `backend/src/services/equipment/reservations.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-329 | Reserving one of several open lines tells nobody yet | Two open lines | Reserve line 1 | The request stays Pending; no notification | As expected | Pass | AC3 - boundary |
| TC-330 | The last line reserved after another was refused | Line 1 resolved unable, line 2 open; event coordinator coord-2 | Reserve line 2 | Arranged; exactly one EQUIPMENT_ARRANGED notification, to coord-2, listing the reserved line and "1 line was unable to be fulfilled" | As expected | Pass | AC3 |
| TC-334 | No coordinator on the event, reservation still made | Event document missing | Reserve the only line | Reservation made and request Arranged; no notification | As expected | Pass | AC3 - boundary |
| TC-346 | Reserving the only open line arranges the request and says so once | One open line; event coordinator coord-1 | Reserve it | Exactly one notifications document, EQUIPMENT_ARRANGED to coord-1, unread, its id matching the document, reading "Q4 Partner Summit: your equipment request is arranged. Reserved: 2 × audio." | As expected | Pass | AC3 |

**Inbox rules — `frontend/src/domain/notifications.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-318 | A booking outcome says approved, or rejected with its reason | — | Call venueBookingOutcomeMessage | Approved names the event and venue; rejected adds "Reason: …" trimmed; missing names fall back to words | As expected | Pass | AC1 (rejection message only) |
| TC-319 | Each outcome type has words | — | Call notificationTypeLabel | Venue booking approved / rejected, Equipment arranged, Equipment unavailable | As expected | Pass | AC1, AC3 |
| TC-320 | View on an outcome goes to the booking or equipment request | Each outcome type, for a coordinator and other roles | Call notificationViewScreen | Coordinator: booking outcomes with a booking go to Venue bookings, equipment outcomes to Equipment requests, anything else to Assigned events; other roles unchanged | As expected | Pass | AC2, AC4 - routing |

**Inbox — `frontend/src/features/notifications/NotificationInbox.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-338 | Outcomes read in words, and View hands over the outcome | An unread booking approval and a read equipment refusal | 1. Render the inbox<br>2. Click View on each | "Venue booking approved" and "Equipment unavailable" with their messages; each View passes the event and that notification; only the unread one is marked read | As expected | Pass | AC1, AC2, AC4 |

**Navigation — `frontend/src/app/Workspace.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-321 | A booking outcome opens that booking | Coordinator on Notifications | Click View on a booking outcome | Venue bookings opens focused on VB-1, with "Back to notifications" | As expected | Pass | AC2 |
| TC-322 | An equipment outcome opens that event's equipment request | Coordinator on Notifications | Click View on an equipment outcome | Equipment requests opens focused on e1, with "Back to notifications" | As expected | Pass | AC4 |
| TC-343 | The focus lasts only for that visit | Coordinator on Notifications | For a booking outcome, then an equipment outcome: View it, go back to Notifications, then open its screen from the sidebar | Each time the sidebar opens the plain list, not the previously focused record | As expected | Pass | AC2, AC4 |

**Venue bookings — `frontend/src/features/venues/VenueBookings.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-324 | The focused booking is open on arrival | Two bookings | Render Venue bookings focused on VB-1 | Only VB-1 is expanded, showing date 2026-11-20, time 10:00–12:00 and status | As expected | Pass | AC2 |
| TC-339 | Nothing opens by itself without a named booking | Two bookings | Render Venue bookings with no focus, then focused on an unknown booking | Neither booking is expanded either time | As expected | Pass | AC2 - boundary |
| TC-340 | The named booking is scrolled into view | Two bookings | Render Venue bookings focused on VB-2 | VB-2's record, and only it, is scrolled into view after loading | As expected | Pass | AC2 |

**Equipment requests — `frontend/src/features/equipment/EquipmentRequestsScreen.test.js`**

| Test Case ID | Test Scenario | Pre-Condition | Test Steps | Expected Result | Actual Result | Pass / Fail / Not Executed / Block | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-323 | The focused equipment request is open on arrival | Arranged request for event-1, 2 × audio reserved | Render Equipment requests focused on event-1 | Date and time read "2026-11-04 · 09:00–17:00"; request details and Technical Support updates are both open, each showing AUDIO · 2, the update marked Reserved | As expected | Pass | AC4 |
| TC-341 | Only the named event's equipment request opens | Two events with arranged requests | Render Equipment requests focused on event-2 | event-2's disclosures are open; event-1's are closed | As expected | Pass | AC4 |
| TC-342 | Without a named event nothing opens or scrolls | One arranged request with no times | Render Equipment requests with no focus | Both disclosures closed, nothing scrolled, the date shown alone | As expected | Pass | AC4 - boundary |
| TC-345 | The named event is scrolled into view | One arranged request | Render Equipment requests focused on event-1 | That record is scrolled into view after loading | As expected | Pass | AC4 |
