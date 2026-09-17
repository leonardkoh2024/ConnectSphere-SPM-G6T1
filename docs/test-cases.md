# Test cases

Every test case the repository currently holds, in the module's test-case format. Each row maps to one
automated test unless its remark says otherwise.

**Running them**

```
npm test                     # from the repo root — all suites
npm test -- --testPathPattern EventRequestForm      # one suite
```

**Test case ID allocation** — `TC-014`, `TC-015` and `TC-016` were already in use in the code before this
document existed, and keep their numbers. `TC-001` to `TC-013` belong to the team's earlier test plan and are
reserved here so nothing collides. New IDs run from `TC-017`.

**Actual Result / status** — recorded from the run of `npm test` on **17 Sep 2026** (97 tests, 5 suites).
Re-run and update the two right-hand columns before submitting.

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

Suites: `frontend/src/features/events/EventRequestForm.test.js` (TC-017 – TC-047, TC-064 – TC-070),
`frontend/src/features/events/EventList.test.js` (TC-016, TC-058 – TC-063),
`frontend/src/app/Workspace.test.js` (TC-014, TC-015, TC-071), `frontend/src/app/App.test.js` (TC-048 – TC-057),
`frontend/src/security/firestoreRules.test.js` (TC-015, TC-016).

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
