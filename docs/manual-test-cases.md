# Manual functional test cases

Manual test cases for release 1 of ConnectSphere, written in the IS212 test-case template: one table per case,
with rows in the template's order. There are 170 cases covering all 94 backlog stories (A1–L4), one to three per
story. They are separate from the automated tests; their IDs (`TC-Mnnn`) do
not follow the automated IDs.

Fill in *Actual Result*, *Pass/Fail/Not Executed/Blocked*, *Executed By* and *Date of Execution* when you run a
case.

## 1. Test environment

Every case runs against the **local Firebase emulators**, never the shared team project. The seed refuses to run
against anything except an emulator on localhost.

Requirements: Node 18+, Java 11+ on your PATH (for the emulators), `npm install` done at the repo root.

| Action | Command (from the repo root) |
| --- | --- |
| Start everything: emulators, baseline seed, backend :4000 and frontend :3000 | `npm run manual:start` |
| Reset to the baseline (with the app still running) | `npm run manual:seed` (in a second terminal) |
| Stop | Ctrl+C in the `manual:start` terminal (all emulator data is discarded) |

App: http://localhost:3000. The seed prints the date of every event for that run.

**Pre-condition for every case:** run `npm run manual:seed` immediately before the case, then sign in fresh
(log out first, or reload the page). The seed wipes all emulator accounts and data and reloads the baseline below,
so each case starts from the same state no matter what earlier cases changed. Where a case lists a further
pre-condition, carry it out after seeding.

## 2. Baseline data (`manual-tests/seed-baseline.mjs`)

Dates are relative to the day you seed, in Singapore time, so the baseline stays valid on any execution date:
upcoming events fall on weekdays, registration windows are open "now", one hold has already expired, and one
Confirmed event has already ended.

### 2.1 Accounts — password for all: `ConnectSphere#2026`

| Role | Name | Email | Sign-in tab |
| --- | --- | --- | --- |
| Event Organiser | Olivia Tan (Harbour Arts Society) | organiser1@manual.test | Corporate |
| Event Organiser | Marcus Lim (Northside Runners Club) | organiser2@manual.test | Corporate |
| Event Coordinator | Chloe Ng | coordinator1@manual.test | Corporate |
| Event Coordinator | Daniel Koh | coordinator2@manual.test | Corporate |
| Event Coordinator Lead | Priya Nair | lead@manual.test | Corporate |
| Venue Staff (Marina Grand Hall, Bayview Meeting Room) | Ravi Kumar | venuestaff1@manual.test | Corporate |
| Venue Staff (Fort Canning Garden Lawn, East Coast Pavilion) | Siti Rahman | venuestaff2@manual.test | Corporate |
| Technical Support Staff | Ethan Goh | tech@manual.test | Corporate |
| Safety Officer | Grace Lee | safety@manual.test | Corporate |
| Attendee | Aaron Teo | attendee1@manual.test | Individuals |
| Attendee | Bella Chua | attendee2@manual.test | Individuals |
| Attendee | Caleb Wong | attendee3@manual.test | Individuals |
| Attendee | Dana Yeo | attendee4@manual.test | Individuals |

### 2.2 Venues

| Venue | Area | Capacity | Setup / turnaround (min) | Layouts | Facilities | Accessibility | Hours |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Marina Grand Hall | Central | 200 | 30 / 30 | THEATRE, CLASSROOM, BANQUET | AIR_CONDITIONING, WIFI, STAGE, POWER_POINTS, TOILETS, TABLES_AND_CHAIRS | WHEELCHAIR_ACCESS, LIFT, ACCESSIBLE_TOILET | Mon–Fri 08:00–22:00 |
| Bayview Meeting Room | Central | 40 | 15 / 15 | BOARDROOM, CLASSROOM, U_SHAPE | AIR_CONDITIONING, WIFI, POWER_POINTS | WHEELCHAIR_ACCESS, LIFT | Mon–Fri 08:00–22:00 |
| Fort Canning Garden Lawn | Central | 500 | 60 / 60 | OPEN_SPACE, STANDING_COCKTAIL, EXHIBITION_BOOTHS | TOILETS, PARKING, LOADING_AREA, POWER_POINTS | STEP_FREE_ACCESS, ACCESSIBLE_PARKING | Daily 07:00–23:00 |
| East Coast Pavilion | East | 120 | 30 / 30 | THEATRE, CLASSROOM, BANQUET | AIR_CONDITIONING, WIFI, STAGE, TOILETS | LIFT, WHEELCHAIR_ACCESS | Daily 07:00–23:00 |

Fort Canning Garden Lawn is blocked for maintenance for three days starting about 18 days after seeding.

Equipment stock: AUDIO 10, VISUAL 6, LIGHTING 8, STAGING 4, FURNITURE 200, OTHERS 10.

### 2.3 Events

"+n" is the number of days after the seed date (moved forward to a weekday).

| Ref | Event | Organiser | Coordinator | Status | Date, time, pax | What it is set up for |
| --- | --- | --- | --- | --- | --- | --- |
| EVT-MT0001-SEED0 | Spring Poetry Reading | Olivia Tan | – | DRAFT | +40, no times | Draft with only name, purpose and date |
| EVT-MT0002-SEED0 | Charity Fun Run Briefing | Marcus Lim | – | SUBMITTED | +35, 18:00–20:00, 120 | Unassigned, submitted 2 days ago (oldest in the Lead's queue) |
| EVT-MT0003-SEED0 | Community Choir Concert | Olivia Tan | – | SUBMITTED | +45, 19:00–21:00, 150 | Unassigned, submitted 3 hours ago |
| EVT-MT0004-SEED0 | Tech Careers Fair | Olivia Tan | Chloe Ng | SUBMITTED | +50, 10:00–16:00, 180 | Assigned, not yet opened; every requirement section filled (equipment, registration, accessibility note) |
| EVT-MT0005-SEED0 | Youth Coding Workshop | Olivia Tan | Chloe Ng | UNDER_REVIEW | +30, 10:00–16:00, 30 | Open clarification request waiting on the organiser |
| EVT-MT0006-SEED0 | Harbour Lights Gala Dinner | Olivia Tan | Chloe Ng | UNDER_REVIEW | +55, 18:00–22:00, 120 | Ready to approve, reject or clarify |
| EVT-MT0007-SEED0 | Harbour Arts Showcase | Olivia Tan | Chloe Ng | APPROVED | +60, 14:00–17:00, 150 | No bookings; needs THEATRE, STAGE, WIFI, WHEELCHAIR_ACCESS; equipment lines AUDIO 4 and LIGHTING 2; registration opens in 14 days |
| EVT-MT0008-SEED0 | Riverside Book Fair | Olivia Tan | Chloe Ng | APPROVED | +25, 09:00–12:00, 35 | Marina Grand Hall hold that expired 2 hours before seeding |
| EVT-MT0009-SEED0 | Startup Pitch Night | Olivia Tan | Chloe Ng | PLANNING | +21, 18:00–21:00, 35 | Bayview Meeting Room request PENDING (submitted first); equipment request PENDING (AUDIO 2, VISUAL 1); change request PENDING (pax 35 → 38) |
| EVT-MT0010-SEED0 | Founders Breakfast Roundtable | Marcus Lim | Chloe Ng | APPROVED | same day as Pitch Night, 18:30–20:30, 30 | Competing Bayview request PENDING, submitted later |
| EVT-MT0011-SEED0 | Wellness Talk Series | Olivia Tan | Chloe Ng | APPROVED | +28, 12:00–14:00, 80 | Active hold on Marina Grand Hall, 3 working days from seeding |
| EVT-MT0012-SEED0 | Product Launch Gala | Olivia Tan | Chloe Ng | PLANNING | +70, 10:00–12:00, 150 | Two approved bookings (Main programme at Marina Grand Hall, Breakout 1 at Bayview); VISUAL 2 reserved; safety notes filled; registration open, capacity 100, 3 registered — ready to send for the safety check |
| EVT-MT0013-SEED0 | Leadership Talk | Olivia Tan | Chloe Ng | CONFIRMED | same day as Launch, 13:00–15:00, 30 | Bayview approved (30 min after Breakout 1); registration open, capacity 2, full (attendees 1 and 2), attendee 3 waitlisted |
| EVT-MT0014-SEED0 | Open Day Tours | Olivia Tan | Chloe Ng | CONFIRMED | +42, 09:00–12:00, 100 | Marina Grand Hall approved; registration open, capacity 50, attendee 4 registered |
| EVT-MT0015-SEED0 | Alumni Homecoming | Olivia Tan | Chloe Ng | CONFIRMED | +48, 18:00–21:00, 200 | Registration closed yesterday; attendee 1 registered |
| EVT-MT0016-SEED0 | Quarterly Town Hall | Olivia Tan | Chloe Ng | CONFIRMED | 2 days ago, 09:00–11:00, 90 | Already ended, ready to mark Completed |
| EVT-MT0017-SEED0 | Community Food Fair | Marcus Lim | Chloe Ng | SAFETY_REVIEW | +32, 10:00–18:00, 400 | Fort Canning Garden Lawn approved; FURNITURE 40 reserved; first safety check |
| EVT-MT0018-SEED0 | Night Market Fest | Marcus Lim | Daniel Koh | SAFETY_REVIEW | +38, 17:00–22:00, 100 | East Coast Pavilion approved; resent after an earlier *Request changes* outcome |
| EVT-MT0019-SEED0 | Autumn Networking Evening | Olivia Tan | Daniel Koh | COMPLETED | 20 days ago | Completed event with history |
| EVT-MT0020-SEED0 | Winter Craft Market | Olivia Tan | Chloe Ng | CANCELLED | +26 | Cancelled with a reason; rejected Marina Grand Hall request; attendee 1 had registered |
| EVT-MT0021-SEED0 | Rooftop Fireworks Party | Olivia Tan | Chloe Ng | REJECTED | +33 | Rejected with reason *Fireworks are not permitted at any of our venues.* |
| EVT-MT0022-SEED0 | Marathon Expo | Marcus Lim | Daniel Koh | APPROVED | +52 | Daniel Koh's event, for "not my event" checks |

Notifications: the Lead has 2 unread (both unassigned events); Chloe Ng 1 unread and 1 read; Olivia Tan 2 unread
and 1 read; Ravi Kumar 2 unread booking requests; Grace Lee 2 unread safety-review notices.

## 3. Traceability

| Story | Jira | Summary | Manual test cases |
| --- | --- | --- | --- |
| A1 | SCRUM-82 | Self-register as an Event Organiser | TC-M001, TC-M002 |
| A2 | SCRUM-83 | Register an Attendee account | TC-M003, TC-M004, TC-M005 |
| A3 | SCRUM-84 | Sign in and sign out | TC-M006, TC-M007, TC-M008, TC-M009 |
| A4 | SCRUM-90 | See only what my role permits | TC-M010, TC-M011, TC-M012 |
| A5 | SCRUM-91 | See only events I am related to | TC-M013, TC-M014 |
| A6 | SCRUM-169 | Use ConnectSphere as an Event Coordinator Lead | TC-M015, TC-M016 |
| A7 | SCRUM-170 | Use ConnectSphere as a Safety Officer | TC-M017, TC-M018 |
| B1 | SCRUM-92 | Create an event request with the core details | TC-M019, TC-M020, TC-M021 |
| B2 | SCRUM-93 | State the venue requirements for my event | TC-M022 |
| B3 | SCRUM-94 | State the accessibility needs of my event | TC-M023 |
| B4 | SCRUM-95 | State the equipment my event needs | TC-M024, TC-M025 |
| B5 | SCRUM-96 | Indicate whether my event needs attendee registration | TC-M026, TC-M027 |
| B6 | SCRUM-97 | Save an incomplete event request as a draft | TC-M028, TC-M029 |
| B7 | SCRUM-98 | Return to and continue editing a draft | TC-M030 |
| B8 | SCRUM-99 | Delete a draft I no longer need | TC-M031, TC-M032 |
| B9 | SCRUM-100 | Submit an event request | TC-M033, TC-M034, TC-M035 |
| B10 | SCRUM-101 | See the current status of my event request | TC-M036, TC-M037 |
| C1 | SCRUM-102 | Have submitted events assigned to a coordinator automatically | TC-M038 |
| C2 | SCRUM-103 | See the events I am responsible for | TC-M039, TC-M040 |
| C3 | SCRUM-104 | Review a submitted request in full | TC-M041 |
| C4 | SCRUM-105 | Request clarification or amendments from the organiser | TC-M042, TC-M043 |
| C5 | SCRUM-106 | Respond to a request for clarification | TC-M044 |
| C6 | SCRUM-107 | Approve a submitted request | TC-M045, TC-M046 |
| C7 | SCRUM-108 | Reject a request with a reason | TC-M047, TC-M048 |
| C8 | SCRUM-109 | Understand the decision on my request | TC-M049 |
| C9 | SCRUM-110 | Reassign an event to a different coordinator | TC-M050 |
| D1 | SCRUM-111 | Update ordinary event information during planning | TC-M051, TC-M052 |
| D2 | SCRUM-112 | Be warned before making a significant change | TC-M053, TC-M054 |
| D3 | SCRUM-113 | Confirm an event once arrangements are in place | TC-M055, TC-M056 |
| D4 | SCRUM-114 | Cancel an event | TC-M057, TC-M058 |
| D5 | SCRUM-115 | Close out an event after it has taken place | TC-M059, TC-M060 |
| D6 | SCRUM-116 | See everything that happened to an event | TC-M061, TC-M062 |
| E1 | SCRUM-117 | Maintain the venue catalogue | TC-M063, TC-M064, TC-M065 |
| E2 | SCRUM-118 | Browse the venue catalogue | TC-M066, TC-M067 |
| E3 | SCRUM-119 | Record when a venue cannot be used | TC-M068 |
| E4 | SCRUM-120 | See when a venue is free | TC-M069, TC-M070 |
| E5 | SCRUM-121 | Find venues that fit my event | TC-M071, TC-M072 |
| E6 | SCRUM-122 | Narrow the shortlist | TC-M073, TC-M074 |
| E7 | SCRUM-123 | Know whether a venue actually suits the event | TC-M075, TC-M076 |
| E8 | SCRUM-124 | Be stopped before booking an unsuitable venue | TC-M077, TC-M078 |
| E9 | SCRUM-171 | Set a venue's setup and turnaround time | TC-M079, TC-M080 |
| E10 | SCRUM-172 | Record a venue's safety information | TC-M081, TC-M082 |
| E11 | SCRUM-173 | Take a venue out of use even when events are booked there | TC-M083 |
| F1 | SCRUM-125 | Request a venue for an event | TC-M084, TC-M085, TC-M086 |
| F2 | SCRUM-126 | Have submitted event bookings assigned to a venue staff automatically | TC-M087 |
| F3 | SCRUM-127 | See booking requests waiting on me | TC-M088, TC-M089 |
| F4 | SCRUM-128 | Approve a venue booking request | TC-M090, TC-M091 |
| F5 | SCRUM-129 | Reject a venue booking request with a reason | TC-M092, TC-M093 |
| F6 | SCRUM-130 | Never double-book a venue | TC-M094, TC-M095 |
| F7 | SCRUM-131 | Track the status of my booking requests | TC-M096 |
| F8 | SCRUM-132 | Release a venue when it is no longer needed | TC-M097 |
| F9 | SCRUM-174 | Count setup and turnaround time when checking for clashes | TC-M098, TC-M099 |
| F10 | SCRUM-175 | See existing bookings that now clash | TC-M100 |
| F11 | SCRUM-176 | Find a replacement venue for an event that lost its venue | TC-M101 |
| F12 | SCRUM-177 | Book more than one venue for an event | TC-M102, TC-M103 |
| F13 | SCRUM-178 | Have each venue of an event checked on its own | TC-M104 |
| F14 | SCRUM-179 | Release one venue without losing the others | TC-M105 |
| F15 | SCRUM-180 | Place a tentative hold on a venue | TC-M106, TC-M107, TC-M108 |
| F16 | SCRUM-181 | Have unconfirmed holds expire on time | TC-M109 |
| G1 | SCRUM-133 | Record the equipment an event needs | TC-M110, TC-M111 |
| G2 | SCRUM-134 | Know whether enough equipment is free | TC-M112 |
| G3 | SCRUM-135 | Reserve equipment for an event | TC-M113, TC-M114, TC-M115 |
| G4 | SCRUM-136 | Amend or refuse an equipment request | TC-M116, TC-M117 |
| G5 | SCRUM-137 | Release equipment when it is no longer needed | TC-M118 |
| G6 | SCRUM-138 | Reassess equipment after a significant change | TC-M119 |
| H1 | SCRUM-139 | Open registration for my event | TC-M120, TC-M121, TC-M122 |
| H2 | SCRUM-140 | Find events I can register for | TC-M123, TC-M124 |
| H3 | SCRUM-141 | Register for an event | TC-M125, TC-M126, TC-M127 |
| H4 | SCRUM-142 | See the status of my registrations | TC-M128, TC-M129 |
| H5 | SCRUM-143 | Withdraw from an event | TC-M130, TC-M131 |
| H6 | SCRUM-144 | Join the waiting list when an event is full | TC-M132, TC-M133 |
| H7 | SCRUM-145 | Be invited to take a freed place | TC-M134, TC-M135 |
| H8 | SCRUM-146 | See who has registered for my event | TC-M136, TC-M137 |
| I1 | SCRUM-147 | Request a change after submitting my event | TC-M138, TC-M139 |
| I2 | SCRUM-148 | Decide on a requested change | TC-M140, TC-M141 |
| I3 | SCRUM-149 | Have arrangements re-requested after a significant change | TC-M142, TC-M143 |
| J1 | SCRUM-150 | Have one place where things needing my attention appear | TC-M144, TC-M145 |
| J2 | SCRUM-151 | Be told how my request is progressing | TC-M146 |
| J3 | SCRUM-152 | Be told when work arrives for me | TC-M147 |
| J4 | SCRUM-153 | Be told when work arrives for me | TC-M148 |
| J5 | SCRUM-154 | Be told when work arrives for me | TC-M149 |
| J6 | SCRUM-155 | Be told the outcome of my booking and equipment requests | TC-M150 |
| J7 | SCRUM-156 | Be told about changes to events I registered for | TC-M151 |
| J8 | SCRUM-191 | Be told when an event is waiting for a coordinator | TC-M152, TC-M153 |
| J9 | SCRUM-192 | Be told when an event is waiting for its safety check | TC-M154, TC-M155 |
| K1 | SCRUM-182 | See newly submitted events waiting for a coordinator | TC-M156, TC-M157 |
| K2 | SCRUM-183 | Assign an event to a coordinator | TC-M158, TC-M159 |
| K3 | SCRUM-184 | Reassign an event to another coordinator | TC-M160, TC-M161 |
| K4 | SCRUM-185 | Oversee all coordinators' assignments | TC-M162 |
| K5 | SCRUM-186 | Manage only the events assigned to me | TC-M163, TC-M164 |
| L1 | SCRUM-187 | Send an event for its safety check | TC-M165, TC-M166 |
| L2 | SCRUM-188 | Review an event's operational safety | TC-M167 |
| L3 | SCRUM-189 | Record the outcome of a safety check | TC-M168, TC-M169 |
| L4 | SCRUM-190 | Return an event to planning after a safety concern | TC-M170 |

## 4. Test cases

## A — Access, identity and authorisation

### TC-M001 — A1: Self-register a new Event Organiser account and reuse of the email is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M001 |
| Test Scenario | Self-register a new Event Organiser account and reuse of the email is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open http://localhost:3000 and choose the **Corporate** tab.<br>2. Click **Create an account**.<br>3. Enter the test data and click **Create event organiser account**.<br>4. Check the role shown under your name in the sidebar.<br>5. Click **Log out**, open **Create an account** on the Corporate tab again, enter the same email with a different name and organisation, and submit. |
| Test Data | Full name: New Organiser; Organisation name: Acme Pte Ltd; Mobile: 91234567; Email: new.organiser@manual.test; Password and Confirm password: ConnectSphere#2026 |
| Expected Result | 1. Step 3: the account is created and signed in straight away, with no approval step.<br>2. Step 4: the role badge reads *Event Organiser*.<br>3. Step 5: the form shows *We could not create an account with those details. Please check them and try again.* — it does not say the email exists or which role holds it. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A1 (SCRUM-82) — Self-register as an Event Organiser. A1 AC1–AC4. Normal + conflict. Open question: Session 2 says release 1 needs no account creation (see CLAUDE.md). |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M002 — A1: Organiser registration with a missing organisation name is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M002 |
| Test Scenario | Organiser registration with a missing organisation name is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open the **Corporate** tab and click **Create an account**.<br>2. Fill every field except Organisation name.<br>3. Click **Create event organiser account**. |
| Test Data | Full name: No Org; Email: no.org@manual.test; Mobile: 91234567; Password: ConnectSphere#2026 |
| Expected Result | The account is not created; the Organisation name field is flagged as required and you stay on the form. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A1 (SCRUM-82) — Self-register as an Event Organiser. A1 AC1. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M003 — A2: Register an Attendee account with valid details

| Item | Value |
| --- | --- |
| Test Case ID | TC-M003 |
| Test Scenario | Register an Attendee account with valid details |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open the **Individuals** tab and click **Create an account**.<br>2. Enter the test data.<br>3. Click **Create attendee account**. |
| Test Data | Full name: New Attendee; Email: new.attendee@manual.test; Mobile: 91234567; Preferred contact: Email; Password and Confirm password: ConnectSphere#2026 |
| Expected Result | 1. The message *Your account has been created successfully.* is shown.<br>2. The user is signed in and the sidebar badge reads *Attendee*. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A2 (SCRUM-83) — Register an Attendee account. A2 AC1, AC3–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M004 — A2: Attendee registration with a password that breaks the rules

| Item | Value |
| --- | --- |
| Test Case ID | TC-M004 |
| Test Scenario | Attendee registration with a password that breaks the rules |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open the **Individuals** tab, click **Create an account**.<br>2. Enter the test data and click **Create attendee account**. |
| Test Data | Full name: Weak Password; Email: weak.pw@manual.test; Mobile: 91234567; Password and Confirm: no-digits-here! |
| Expected Result | 1. Submission is blocked with a message that the password needs at least 12 characters, including a number and a special character.<br>2. No account is created. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A2 (SCRUM-83) — Register an Attendee account. A2 AC8. Boundary/failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M005 — A2: Attendee registration with an email already linked to an account

| Item | Value |
| --- | --- |
| Test Case ID | TC-M005 |
| Test Scenario | Attendee registration with an email already linked to an account |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open the **Individuals** tab, click **Create an account**.<br>2. Enter the test data and click **Create attendee account**. |
| Test Data | Full name: Duplicate; Email: attendee1@manual.test (seeded); Mobile: 91234567; Password: ConnectSphere#2026 |
| Expected Result | Submission is refused with a validation message; no second account is created and you are not signed in. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A2 (SCRUM-83) — Register an Attendee account. A2 AC7. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M006 — A3: Sign in with a valid email and password, then sign out

| Item | Value |
| --- | --- |
| Test Case ID | TC-M006 |
| Test Scenario | Sign in with a valid email and password, then sign out |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Note the screen you land on.<br>3. Click **Log out**.<br>4. Press the browser's **Back** button. |
| Test Data | Email: coordinator1@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | 1. Step 1: the coordinator workspace opens; the sidebar shows *Chloe Ng* and the role *Event Coordinator*.<br>2. Step 3: the sign-in page with the Corporate/Individuals tabs is shown.<br>3. Step 4: no protected screen is shown; you stay on the sign-in page. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A3 (SCRUM-84) — Sign in and sign out. A3 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M007 — A3: Wrong password gives a generic error

| Item | Value |
| --- | --- |
| Test Case ID | TC-M007 |
| Test Scenario | Wrong password gives a generic error |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Open the **Corporate** tab.<br>2. Enter a seeded email with a wrong password and click **Log in**.<br>3. Repeat with an email that does not exist. |
| Test Data | 1) coordinator1@manual.test / WrongPassword#1  2) nobody@manual.test / WrongPassword#1 |
| Expected Result | Both attempts show the same generic error; neither says whether the email exists. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A3 (SCRUM-84) — Sign in and sign out. A3 AC2. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M008 — A3: Requesting a protected page while signed out

| Item | Value |
| --- | --- |
| Test Case ID | TC-M008 |
| Test Scenario | Requesting a protected page while signed out |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. In the address bar open `http://localhost:3000/#/event_coordinator/assigned-events`.<br>2. Sign in on the **Corporate** tab as coordinator1@manual.test. |
| Test Data | Email: coordinator1@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | 1. Step 1: the sign-in page is shown instead of the protected screen.<br>2. Step 2: after signing in you land on **Assigned events** (the page originally requested). |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A3 (SCRUM-84) — Sign in and sign out. A3 AC4, AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M009 — A3: An attendee cannot sign in through the Corporate portal

| Item | Value |
| --- | --- |
| Test Case ID | TC-M009 |
| Test Scenario | An attendee cannot sign in through the Corporate portal |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed out. |
| Test Steps | 1. Choose the **Corporate** tab.<br>2. Sign in with an attendee account. |
| Test Data | Email: attendee1@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | Sign-in is refused with a message that the account cannot be used in this portal. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A3 (SCRUM-84) — Sign in and sign out. A3 (portal split). Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M010 — A4: Each role sees only its own navigation

| Item | Value |
| --- | --- |
| Test Case ID | TC-M010 |
| Test Scenario | Each role sees only its own navigation |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Sign in as each account in the test data in turn (attendees on the **Individuals** tab).<br>2. Record the sidebar items for each, then log out. |
| Test Data | organiser1, coordinator1, lead, venuestaff1, tech, safety (Corporate); attendee1 (Individuals) — all @manual.test |
| Expected Result | 1. Organiser: My events, Change requests, Notifications.<br>2. Coordinator: Review queue, Assigned events, Venue catalogue, Venue bookings, Equipment requests, Change requests, Registrations, Notifications.<br>3. Lead: Unassigned queue, Oversight, Notifications.<br>4. Venue Staff: Booking requests, Venue catalogue, Availability calendar, Notifications.<br>5. Technical Support: Equipment queue, Availability check, Equipment catalogue, Reservations, Notifications.<br>6. Safety Officer: Safety reviews, Venue safety information, Notifications.<br>7. Attendee: Browse events, My registrations, Notifications. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A4 (SCRUM-90) — See only what my role permits. A4 AC1. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M011 — A4: Opening another role's screen by URL is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M011 |
| Test Scenario | Opening another role's screen by URL is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. In the address bar change the hash to `#/event_coordinator/review-queue`.<br>2. Change it to `#/venue_staff/booking-requests`.<br>3. Change it to `#/safety_officer/safety-reviews`. |
| Test Data | URLs as in the steps |
| Expected Result | Each time the page heading is *Not authorised* with *You are not authorised to access this function.*; no other role's data is shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A4 (SCRUM-90) — See only what my role permits. A4 AC2. Failure. Server-side enforcement of data reads is in firestore.rules. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M012 — A4: An attendee cannot open organiser or staff screens by URL

| Item | Value |
| --- | --- |
| Test Case ID | TC-M012 |
| Test Scenario | An attendee cannot open organiser or staff screens by URL |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in on the Individuals tab as attendee1@manual.test. |
| Test Steps | 1. Change the hash to `#/event_organiser/my-events`.<br>2. Change it to `#/event_coordinator_lead/oversight`. |
| Test Data | URLs as in the steps |
| Expected Result | Both show *Not authorised*; no event list is shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A4 (SCRUM-90) — See only what my role permits. A4 AC2, AC3. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M013 — A5: An organiser's list holds only their own events

| Item | Value |
| --- | --- |
| Test Case ID | TC-M013 |
| Test Scenario | An organiser's list holds only their own events |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **My events**.<br>3. Look for the events owned by Marcus Lim (Organiser 2).<br>4. Type `EVT-MT0002-SEED0` into the search box. |
| Test Data | Own events: Spring Poetry Reading … Rooftop Fireworks Party. Other organiser's: Charity Fun Run Briefing (EVT-MT0002-SEED0), Founders Breakfast Roundtable, Community Food Fair, Night Market Fest, Marathon Expo |
| Expected Result | 1. Only Olivia Tan's 17 events are listed; none of Marcus Lim's events appear.<br>2. Searching EVT-MT0002-SEED0 shows *No events match these filters.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A5 (SCRUM-91) — See only events I am related to. A5 AC1. Normal + failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M014 — A5: The other organiser sees only their own events

| Item | Value |
| --- | --- |
| Test Case ID | TC-M014 |
| Test Scenario | The other organiser sees only their own events |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser2@manual.test`.<br>2. Open **My events**. |
| Test Data | Email: organiser2@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | Only Charity Fun Run Briefing, Founders Breakfast Roundtable, Community Food Fair, Night Market Fest and Marathon Expo are listed. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A5 (SCRUM-91) — See only events I am related to. A5 AC1. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M015 — A6: The seeded Lead signs in to the Lead workspace

| Item | Value |
| --- | --- |
| Test Case ID | TC-M015 |
| Test Scenario | The seeded Lead signs in to the Lead workspace |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `lead@manual.test`.<br>2. Open **Unassigned queue**, then **Oversight**.<br>3. Look for coordinator screens (Review queue, Assigned events) in the sidebar. |
| Test Data | Email: lead@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | 1. Sign-in succeeds; the role badge reads *Event Coordinator Lead*.<br>2. Both screens open.<br>3. No coordinator, venue, equipment or safety screens are offered. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A6 (SCRUM-169) — Use ConnectSphere as an Event Coordinator Lead. A6 AC1, AC2, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M016 — A6: The Lead is refused a coordinator screen by URL

| Item | Value |
| --- | --- |
| Test Case ID | TC-M016 |
| Test Scenario | The Lead is refused a coordinator screen by URL |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Change the hash to `#/event_coordinator/review-queue`. |
| Test Data | URL as in the step |
| Expected Result | *Not authorised* is shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A6 (SCRUM-169) — Use ConnectSphere as an Event Coordinator Lead. A6 AC5. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M017 — A7: The seeded Safety Officer signs in and sees only safety screens

| Item | Value |
| --- | --- |
| Test Case ID | TC-M017 |
| Test Scenario | The seeded Safety Officer signs in and sees only safety screens |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. Open **Safety reviews**, then **Venue safety information**.<br>3. Look for event-editing screens in the sidebar. |
| Test Data | Email: safety@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | 1. Sign-in succeeds; badge reads *Safety Officer*.<br>2. Safety reviews lists Community Food Fair and Night Market Fest.<br>3. No Assigned events, Booking requests or editing screens are offered. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A7 (SCRUM-170) — Use ConnectSphere as a Safety Officer. A7 AC1, AC2, AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M018 — A7: The Safety Officer is refused another role's screen by URL

| Item | Value |
| --- | --- |
| Test Case ID | TC-M018 |
| Test Scenario | The Safety Officer is refused another role's screen by URL |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as safety@manual.test. |
| Test Steps | 1. Change the hash to `#/event_coordinator/assigned-events`. |
| Test Data | URL as in the step |
| Expected Result | *Not authorised* is shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story A7 (SCRUM-170) — Use ConnectSphere as a Safety Officer. A7 AC6. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## B — Event requests

### TC-M019 — B1: Create a request with all core details

| Item | Value |
| --- | --- |
| Test Case ID | TC-M019 |
| Test Scenario | Create a request with all core details |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill the core details, venue requirements and answer every Yes/No question as in the test data.<br>3. Click **Submit request**.<br>4. Find the event in **My events**. |
| Test Data | Event name: Annual Staff Picnic; Purpose: Team bonding; Description: Picnic for staff and families; Proposed date: any weekday ≥ 30 days from today; Start 10:00; End 12:00; Expected attendance: 40; Location: Central; Layout: THEATRE; Facilities: No; Equipment: No; Registration: No; Accessibility: No |
| Expected Result | 1. A confirmation *Event request EVT-… submitted for coordinator review* appears.<br>2. The event is listed with status SUBMITTED and a *Last updated* time (its creation record). |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B1 (SCRUM-92) — Create an event request with the core details. B1 AC1, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M020 — B1: Past date and end time before start time are refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M020 |
| Test Scenario | Past date and end time before start time are refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill the form as in TC for B1 normal, but use the test data for date and times.<br>3. Click **Submit request**. |
| Test Data | Proposed date: yesterday; Start 10:00; End 09:00 (other fields valid) |
| Expected Result | 1. Submission is blocked and the issue list shows *The proposed event date cannot be in the past.* and *End time must be later than start time.*<br>2. Entered values stay on screen. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B1 (SCRUM-92) — Create an event request with the core details. B1 AC2. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M021 — B1: Expected attendance must be a whole number above zero

| Item | Value |
| --- | --- |
| Test Case ID | TC-M021 |
| Test Scenario | Expected attendance must be a whole number above zero |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill a valid request but set Expected attendance to each value in the test data, clicking **Submit request** each time. |
| Test Data | Expected attendance: 0, then -5, then 2.5 |
| Expected Result | Each time submission is blocked with *Expected attendance must be a whole number greater than zero.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B1 (SCRUM-92) — Create an event request with the core details. B1 AC3. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M022 — B2: Venue requirements are captured from catalogue values and kept

| Item | Value |
| --- | --- |
| Test Case ID | TC-M022 |
| Test Scenario | Venue requirements are captured from catalogue values and kept |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Open the Preferred location and Required layout lists and compare them with the venue catalogue values.<br>3. Fill a valid request with the test data and submit.<br>4. Reopen it from **My events → View details**. |
| Test Data | Location: East; Layout: BANQUET; Facilities: Yes — WIFI and STAGE |
| Expected Result | 1. Layouts offered are THEATRE, CLASSROOM, BOARDROOM, U SHAPE, BANQUET, CABARET, CLUSTER TABLES, EXHIBITION BOOTHS, OPEN SPACE, STAGE AUDIENCE, STANDING COCKTAIL — the same values the venue catalogue uses.<br>2. The submitted request shows East, BANQUET, and WIFI and STAGE ticked; other facilities unticked. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B2 (SCRUM-93) — State the venue requirements for my event. B2 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M023 — B3: Several accessibility needs and a note are recorded

| Item | Value |
| --- | --- |
| Test Case ID | TC-M023 |
| Test Scenario | Several accessibility needs and a note are recorded |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill a valid request; answer Yes to accessibility needs and tick the test-data items; add the note.<br>3. Submit, then reopen via **View details**. |
| Test Data | Accessibility: WHEELCHAIR ACCESS, HEARING LOOP; Notes: Two guests use wheelchairs. |
| Expected Result | Both needs stay ticked and the note is shown on the submitted request. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B3 (SCRUM-94) — State the accessibility needs of my event. B3 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M024 — B4: Two equipment lines with a technical note

| Item | Value |
| --- | --- |
| Test Case ID | TC-M024 |
| Test Scenario | Two equipment lines with a technical note |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill a valid request; answer Yes to equipment.<br>3. Line 1 as in test data; click **Add equipment line**; line 2 as in test data.<br>4. Submit, then reopen via **View details**. |
| Test Data | Line 1: AUDIO × 4, note *Wireless microphones*; Line 2: VISUAL × 1 |
| Expected Result | Request submits; both lines are shown with their type, quantity and note. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B4 (SCRUM-95) — State the equipment my event needs. B4 AC1. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M025 — B4: Equipment quantity of zero is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M025 |
| Test Scenario | Equipment quantity of zero is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill a valid request; answer Yes to equipment; add a line with the test data.<br>3. Click **Submit request**. |
| Test Data | Line 1: VISUAL × 0 |
| Expected Result | Submission is blocked with *Equipment quantity 1 must be a whole number greater than zero.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B4 (SCRUM-95) — State the equipment my event needs. B4 AC2. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M026 — B5: Registration is off by default and captures capacity and window when on

| Item | Value |
| --- | --- |
| Test Case ID | TC-M026 |
| Test Scenario | Registration is off by default and captures capacity and window when on |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Check the answer to *Do attendees need to register?*<br>3. Fill a valid request and answer Yes; enter the test data.<br>4. Submit. |
| Test Data | Event date: weekday ≥ 40 days ahead, 10:00–12:00, attendance 40; Capacity 30; Opens tomorrow 09:00; Closes on the event date at 08:00 |
| Expected Result | 1. The registration question starts at **No**.<br>2. With Yes, capacity and open/close date-time fields appear; the request submits. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B5 (SCRUM-96) — Indicate whether my event needs attendee registration. B5 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M027 — B5: Registration capacity above attendance or a close after the start is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M027 |
| Test Scenario | Registration capacity above attendance or a close after the start is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill a valid request (attendance 40) with registration Yes and the first test-data set; submit.<br>3. Change to the second set; submit. |
| Test Data | 1) Capacity 60, close on event date 08:00  2) Capacity 30, close on event date 11:00 (event starts 10:00) |
| Expected Result | 1. 1) *Registration capacity cannot exceed the expected attendance.*<br>2. 2) *Registration close date/time must be at or before the event start.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B5 (SCRUM-96) — Indicate whether my event needs attendee registration. B5 AC3. Boundary/failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M028 — B6: Save a half-filled request as a draft

| Item | Value |
| --- | --- |
| Test Case ID | TC-M028 |
| Test Scenario | Save a half-filled request as a draft |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Enter only the event name.<br>3. Click **Save draft**.<br>4. Open **My events**. |
| Test Data | Event name: Half-done draft |
| Expected Result | 1. A *Draft … saved* message appears with no validation errors.<br>2. The event is listed as DRAFT with *Last saved* date and time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B6 (SCRUM-97) — Save an incomplete event request as a draft. B6 AC1, AC3, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M029 — B6: Drafts are not visible to coordinators or other organisers

| Item | Value |
| --- | --- |
| Test Case ID | TC-M029 |
| Test Scenario | Drafts are not visible to coordinators or other organisers |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as coordinator1@manual.test. |
| Test Steps | 1. Open **Review queue** and **Assigned events** (All statuses).<br>2. Log out and sign in as organiser2@manual.test; open **My events**. |
| Test Data | Seeded draft: Spring Poetry Reading (Olivia Tan) |
| Expected Result | Spring Poetry Reading appears in neither coordinator list nor Organiser 2's list. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B6 (SCRUM-97) — Save an incomplete event request as a draft. B6 AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M030 — B7: Reopen a draft, see saved values, edit and re-save

| Item | Value |
| --- | --- |
| Test Case ID | TC-M030 |
| Test Scenario | Reopen a draft, see saved values, edit and re-save |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events**; on **Spring Poetry Reading** click **Edit**.<br>2. Check the fields.<br>3. Enter a description and click **Save draft**.<br>4. Reopen it. |
| Test Data | Seeded draft: name *Spring Poetry Reading*, purpose *Poetry evening for members*, no times; New description: Added on the second sitting. |
| Expected Result | 1. Name and purpose are restored exactly; description, times and attendance are empty.<br>2. After saving, the new description is kept, the status is still DRAFT and *Last saved* shows the new time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B7 (SCRUM-98) — Return to and continue editing a draft. B7 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M031 — B8: Delete is offered only on drafts and needs confirmation

| Item | Value |
| --- | --- |
| Test Case ID | TC-M031 |
| Test Scenario | Delete is offered only on drafts and needs confirmation |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events**.<br>2. Compare the buttons on **Spring Poetry Reading** (DRAFT) and **Community Choir Concert** (SUBMITTED).<br>3. Click **Delete** on the draft, then **Keep draft**. |
| Test Data | Seeded events as named |
| Expected Result | 1. Only the draft offers **Delete**.<br>2. A *Delete this draft?* dialog opens; **Keep draft** closes it and the draft remains. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B8 (SCRUM-99) — Delete a draft I no longer need. B8 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M032 — B8: Confirming deletion removes the draft

| Item | Value |
| --- | --- |
| Test Case ID | TC-M032 |
| Test Scenario | Confirming deletion removes the draft |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events**; click **Delete** on **Spring Poetry Reading**.<br>2. Click **Yes, delete**.<br>3. Search for `EVT-MT0001-SEED0`. |
| Test Data | Draft: Spring Poetry Reading (EVT-MT0001-SEED0) |
| Expected Result | A *deleted* message appears and the draft is gone from the list; the search finds nothing. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B8 (SCRUM-99) — Delete a draft I no longer need. B8 AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M033 — B9: An incomplete request lists exactly what is missing

| Item | Value |
| --- | --- |
| Test Case ID | TC-M033 |
| Test Scenario | An incomplete request lists exactly what is missing |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Enter only the event name.<br>3. Click **Submit request**. |
| Test Data | Event name: Submit me |
| Expected Result | 1. Nothing is submitted. The issue list names the missing fields, e.g. *Purpose is required.*, *Proposed date is required.*, and *Answer “Does your event have accessibility needs?”*, *Answer “Does your event need equipment?”*.<br>2. The event name stays filled in. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B9 (SCRUM-100) — Submit an event request. B9 AC1, AC2, AC4. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M034 — B9: A complete request is submitted once with a reference number

| Item | Value |
| --- | --- |
| Test Case ID | TC-M034 |
| Test Scenario | A complete request is submitted once with a reference number |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** and click **Create new event request**.<br>2. Fill a complete valid request (as in the B1 normal case) and click **Submit request**.<br>3. Note the reference number in the confirmation.<br>4. Reopen the request via **View details**. |
| Test Data | As B1 normal case; name: Submit once |
| Expected Result | 1. Confirmation shows *Event request EVT-… submitted for coordinator review*.<br>2. The list shows SUBMITTED with the same reference.<br>3. The reopened request says *Viewing request EVT-…. This request is no longer editable.* and has no **Submit request** button. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B9 (SCRUM-100) — Submit an event request. B9 AC5–AC7. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M035 — B9: Submitting a saved draft after completing it

| Item | Value |
| --- | --- |
| Test Case ID | TC-M035 |
| Test Scenario | Submitting a saved draft after completing it |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** → **Edit** on **Spring Poetry Reading**.<br>2. Complete every required field and answer every question.<br>3. Click **Submit request**. |
| Test Data | Times 18:00–20:00; attendance 50; description *An evening of poetry*; location Central; layout THEATRE; all questions No |
| Expected Result | The draft is submitted, gets an EVT reference, and is listed as SUBMITTED. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B9 (SCRUM-100) — Submit an event request. B9 AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M036 — B10: Every saved request shows its current status

| Item | Value |
| --- | --- |
| Test Case ID | TC-M036 |
| Test Scenario | Every saved request shows its current status |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events**.<br>2. Use the **Status** filter to choose *Draft*, then *Rejected*, then *All events*. |
| Test Data | Seeded: one event in each status (Draft … Rejected) |
| Expected Result | 1. The list shows DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, PLANNING, CONFIRMED, COMPLETED, CANCELLED and REJECTED events together.<br>2. Filtering shows only the chosen status. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B10 (SCRUM-101) — See the current status of my event request. B10 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M037 — B10: Opening a request shows its status and time, with no way to change it

| Item | Value |
| --- | --- |
| Test Case ID | TC-M037 |
| Test Scenario | Opening a request shows its status and time, with no way to change it |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Open **My events** → **View details** on **Harbour Arts Showcase**.<br>2. Look at the *Review and decision* panel and for any status control. |
| Test Data | Seeded event: Harbour Arts Showcase (APPROVED) |
| Expected Result | 1. The panel shows APPROVED with the decision time and coordinator Chloe Ng.<br>2. There is no control to change the status. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story B10 (SCRUM-101) — See the current status of my event request. B10 AC4, AC6. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## C — Review and decisions

### TC-M038 — C1: A submitted event is not auto-assigned and waits in the Lead's queue

| Item | Value |
| --- | --- |
| Test Case ID | TC-M038 |
| Test Scenario | A submitted event is not auto-assigned and waits in the Lead's queue |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as organiser1@manual.test. |
| Test Steps | 1. Submit a new complete request (as B1 normal).<br>2. Open it via **View details** and check the coordinator.<br>3. Log out; sign in as lead@manual.test; open **Unassigned queue**. |
| Test Data | Name: Queue check |
| Expected Result | 1. The request shows no assigned coordinator.<br>2. It appears in the Lead's Unassigned queue. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C1 (SCRUM-102) — Have submitted events assigned to a coordinator automatically. C1 AC4 (as replaced by K1 AC1). Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M039 — C2: A coordinator's list holds only their events with name, organiser, date, status and last activity

| Item | Value |
| --- | --- |
| Test Case ID | TC-M039 |
| Test Scenario | A coordinator's list holds only their events with name, organiser, date, status and last activity |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events**; choose *All statuses*.<br>3. Look for **Night Market Fest** and **Marathon Expo** (Daniel Koh's). |
| Test Data | Email: coordinator1@manual.test; Password: `ConnectSphere#2026` |
| Expected Result | 1. Each row shows event name, organiser, proposed date, status and *Last activity*.<br>2. Night Market Fest and Marathon Expo are not listed. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C2 (SCRUM-103) — See the events I am responsible for. C2 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M040 — C2: Filter by status and sort by date

| Item | Value |
| --- | --- |
| Test Case ID | TC-M040 |
| Test Scenario | Filter by status and sort by date |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as coordinator1@manual.test. |
| Test Steps | 1. Open **Assigned events**.<br>2. Set the status filter to *APPROVED*.<br>3. Click **Proposed date** sort twice. |
| Test Data | Seeded APPROVED events: Riverside Book Fair, Founders Breakfast Roundtable, Wellness Talk Series, Harbour Arts Showcase |
| Expected Result | 1. Only the four APPROVED events show.<br>2. The order flips between earliest-first and latest-first. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C2 (SCRUM-103) — See the events I am responsible for. C2 AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M041 — C3: Opening a submitted request shows everything and moves it to Under Review

| Item | Value |
| --- | --- |
| Test Case ID | TC-M041 |
| Test Scenario | Opening a submitted request shows everything and moves it to Under Review |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Tech Careers Fair**, click **View request**.<br>4. Check the status pill and the detail. |
| Test Data | Seeded: Tech Careers Fair (EVT-MT0004-SEED0), SUBMITTED, assigned to Chloe Ng |
| Expected Result | 1. Status becomes UNDER_REVIEW.<br>2. The view shows reference EVT-MT0004-SEED0, submission time, organiser Olivia Tan with organiser1@manual.test, layout CLASSROOM, facilities WIFI and POWER_POINTS, accessibility WHEELCHAIR_ACCESS and LIFT with the note, equipment AUDIO × 2 and VISUAL × 1, and registration (capacity 150 with its window).<br>3. **Activity** shows *Started review* by Chloe Ng. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C3 (SCRUM-104) — Review a submitted request in full. C3 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M042 — C4: Raise a clarification request; empty message refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M042 |
| Test Scenario | Raise a clarification request; empty message refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Lights Gala Dinner**, click **View request**.<br>4. Open the **Clarifications** tab and click **Request clarification**.<br>5. Click **Send request** with the box empty.<br>6. Enter the message and click **Send request**. |
| Test Data | Message: Please confirm the number of VIP guests. |
| Expected Result | 1. Empty message: an error is shown and nothing is sent.<br>2. With text: *Clarification request sent.*; the message and its time are shown on the event. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C4 (SCRUM-105) — Request clarification or amendments from the organiser. C4 AC1, AC3. Normal + failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M043 — C4: With a clarification open, approve, reject and a second request are unavailable

| Item | Value |
| --- | --- |
| Test Case ID | TC-M043 |
| Test Scenario | With a clarification open, approve, reject and a second request are unavailable |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Youth Coding Workshop**, click **View request**.<br>4. Look at the **Event request** tab actions.<br>5. Open the **Clarifications** tab. |
| Test Data | Seeded: Youth Coding Workshop with an open clarification about laptops |
| Expected Result | 1. Status is UNDER_REVIEW and the event shows it is awaiting the organiser.<br>2. No **Approve** or **Reject request** button.<br>3. No **Request clarification** button; the open question is shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C4 (SCRUM-105) — Request clarification or amendments from the organiser. C4 AC2, AC4. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M044 — C5: The organiser edits the request and answers the clarification

| Item | Value |
| --- | --- |
| Test Case ID | TC-M044 |
| Test Scenario | The organiser edits the request and answers the clarification |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **My events** → **View details** on **Youth Coding Workshop**.<br>3. On the **Event request** tab change the start time and click **Save changes**.<br>4. Open **Clarifications**, type the response and click **Send response**.<br>5. Log out; sign in as coordinator1 and open the event from **Review queue** → **Clarifications**. |
| Test Data | Start time: 10:30; Response: Each student brings their own laptop. |
| Expected Result | 1. *Request details updated.* then *Your clarification response was sent.*; the response box disappears.<br>2. The coordinator sees the question and the answer in time order, and **Approve** is available again. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C5 (SCRUM-106) — Respond to a request for clarification. C5 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M045 — C6: Approve an Under Review request

| Item | Value |
| --- | --- |
| Test Case ID | TC-M045 |
| Test Scenario | Approve an Under Review request |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Lights Gala Dinner**, click **View request**.<br>4. Click **Approve**, enter the reason and click **Approve event**. |
| Test Data | Reason: All details are complete. |
| Expected Result | 1. *Event request approved.*; status APPROVED.<br>2. **Activity** shows *Approved the request* by Chloe Ng with the time.<br>3. **Send for safety check** is disabled with *Still outstanding: an approved venue booking.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C6 (SCRUM-107) — Approve a submitted request. C6 AC1–AC3, AC8 (Week 7: confirmation is through L1). Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M046 — C6: Approve is not offered outside Under Review

| Item | Value |
| --- | --- |
| Test Case ID | TC-M046 |
| Test Scenario | Approve is not offered outside Under Review |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**. |
| Test Data | Seeded: Harbour Arts Showcase (APPROVED) |
| Expected Result | No **Approve** button is shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C6 (SCRUM-107) — Approve a submitted request. C6 AC1. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M047 — C7: Reject needs a reason and is final

| Item | Value |
| --- | --- |
| Test Case ID | TC-M047 |
| Test Scenario | Reject needs a reason and is final |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Lights Gala Dinner**, click **View request**.<br>4. Click **Reject request**, then **Reject event** with an empty reason.<br>5. Enter the reason and click **Reject event**.<br>6. Log out; sign in as organiser1; open **My events**. |
| Test Data | Reason: No suitable venue can be secured on that date. |
| Expected Result | 1. Empty reason: an error is shown.<br>2. With a reason: *Event request rejected.*; status REJECTED.<br>3. The organiser sees REJECTED and no **Edit** button. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C7 (SCRUM-108) — Reject a request with a reason. C7 AC1–AC3. Normal + failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M048 — C7: A rejected event cannot be edited or resubmitted

| Item | Value |
| --- | --- |
| Test Case ID | TC-M048 |
| Test Scenario | A rejected event cannot be edited or resubmitted |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **My events** → **View details** on **Rooftop Fireworks Party**. |
| Test Data | Seeded: Rooftop Fireworks Party (REJECTED) |
| Expected Result | *This request is no longer editable.* is shown; no Save or Submit buttons; **Create new event request** is still available on My events. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C7 (SCRUM-108) — Reject a request with a reason. C7 AC3. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M049 — C8: The organiser sees the decision, reason, time and coordinator

| Item | Value |
| --- | --- |
| Test Case ID | TC-M049 |
| Test Scenario | The organiser sees the decision, reason, time and coordinator |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **My events** → **View details** on **Rooftop Fireworks Party**. |
| Test Data | Seeded rejection reason: Fireworks are not permitted at any of our venues. |
| Expected Result | *Review and decision* shows Decision REJECTED, the decision time, the reason in full, and Assigned coordinator Chloe Ng. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C8 (SCRUM-109) — Understand the decision on my request. C8 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M050 — C9: Reassigned coordinator takes over (as changed by K3)

| Item | Value |
| --- | --- |
| Test Case ID | TC-M050 |
| Test Scenario | Reassigned coordinator takes over (as changed by K3) |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `lead@manual.test`.<br>2. Open **Oversight**; on **Harbour Arts Showcase** choose *Daniel Koh* and click **Reassign**.<br>3. Log out; sign in as coordinator2@manual.test; open the event from **Assigned events**.<br>4. Open **Notifications**. |
| Test Data | Event: Harbour Arts Showcase; from Chloe Ng to Daniel Koh |
| Expected Result | 1. *Reassigned to Daniel Koh.*<br>2. Daniel Koh sees the event with **Edit event** available.<br>3. Daniel Koh has a notification naming the event. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story C9 (SCRUM-110) — Reassign an event to a different coordinator. C9 AC1, AC2, AC4 (AC5 replaced by K3). Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## D — Planning

### TC-M051 — D1: Edit ordinary details without touching arrangements; change is logged

| Item | Value |
| --- | --- |
| Test Case ID | TC-M051 |
| Test Scenario | Edit ordinary details without touching arrangements; change is logged |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. Click **Edit event**, change Purpose, click **Save changes**.<br>5. Click **Edit event** again, fill Internal notes, save.<br>6. Open **Arrangements**, then **Activity**. |
| Test Data | Purpose: Quarterly product launch; Internal notes: Catering confirmed by phone. |
| Expected Result | 1. *Event changes saved.* both times (no acknowledgement asked).<br>2. Both venue bookings stay APPROVED and equipment stays reserved.<br>3. Activity lists each change with old value, new value, Chloe Ng and the time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D1 (SCRUM-111) — Update ordinary event information during planning. D1 AC1, AC2, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M052 — D1: Ordinary edits refused in terminal statuses

| Item | Value |
| --- | --- |
| Test Case ID | TC-M052 |
| Test Scenario | Ordinary edits refused in terminal statuses |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Winter Craft Market**, click **View request**. |
| Test Data | Seeded: Winter Craft Market (CANCELLED) |
| Expected Result | No **Edit event** button is offered. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D1 (SCRUM-111) — Update ordinary event information during planning. D1 AC3. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M053 — D2: Changing attendance warns of affected arrangements and needs acknowledgement

| Item | Value |
| --- | --- |
| Test Case ID | TC-M053 |
| Test Scenario | Changing attendance warns of affected arrangements and needs acknowledgement |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. Click **Edit event** and change *Expected attendance (pax)*.<br>5. Read the warning; try **Save changes**.<br>6. Tick the acknowledgement and save.<br>7. Open **Activity**. |
| Test Data | Expected attendance: 150 → 170 |
| Expected Result | 1. The warning names Marina Grand Hall and Bayview Meeting Room bookings, the VISUAL reservation and 3 registrations.<br>2. **Save changes** stays disabled until acknowledged.<br>3. After saving, Activity shows 150 → 170 with actor and time; bookings are not altered. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D2 (SCRUM-112) — Be warned before making a significant change. D2 AC1–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M054 — D2: Cancelling a significant change leaves the event untouched

| Item | Value |
| --- | --- |
| Test Case ID | TC-M054 |
| Test Scenario | Cancelling a significant change leaves the event untouched |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. Click **Edit event**; change the start time.<br>5. Close the editor without saving (**Cancel**).<br>6. Reopen the event. |
| Test Data | Start time: 10:00 → 09:00 |
| Expected Result | The warning appears; after cancelling, the start time is still 10:00 and nothing is in Activity. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D2 (SCRUM-112) — Be warned before making a significant change. D2 AC3. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M055 — D3: Event cannot move on while an arrangement is outstanding

| Item | Value |
| --- | --- |
| Test Case ID | TC-M055 |
| Test Scenario | Event cannot move on while an arrangement is outstanding |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Startup Pitch Night**, click **View request**. |
| Test Data | Seeded: Startup Pitch Night — Bayview Meeting Room PENDING, equipment request PENDING |
| Expected Result | **Send for safety check** is disabled with *This event cannot be confirmed yet. Still outstanding:* naming the Bayview Meeting Room booking, Audio × 2 and Visual × 1. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D3 (SCRUM-113) — Confirm an event once arrangements are in place. D3 AC1, AC2 (replaced by L1). Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M056 — D3: Confirmed only through a passed safety check

| Item | Value |
| --- | --- |
| Test Case ID | TC-M056 |
| Test Scenario | Confirmed only through a passed safety check |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Leadership Talk**, click **View request**.<br>4. Open **Activity**. |
| Test Data | Seeded: Leadership Talk (CONFIRMED) |
| Expected Result | Status CONFIRMED; Activity shows *Sent for safety check* then *Approved the safety check* with times; there is no Confirm button anywhere. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D3 (SCRUM-113) — Confirm an event once arrangements are in place. D3 AC3 (with L1 AC4). Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M057 — D4: Cancel needs a reason and a confirmation tick

| Item | Value |
| --- | --- |
| Test Case ID | TC-M057 |
| Test Scenario | Cancel needs a reason and a confirmation tick |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. Click **Cancel event**; enter a reason only.<br>5. Click **Keep event**. |
| Test Data | Reason: Client postponed indefinitely. |
| Expected Result | 1. **Confirm cancellation** stays disabled until the tick is set.<br>2. **Keep event** leaves it PLANNING. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D4 (SCRUM-114) — Cancel an event. D4 AC1. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M058 — D4: Cancelling releases venues and equipment and notifies people

| Item | Value |
| --- | --- |
| Test Case ID | TC-M058 |
| Test Scenario | Cancelling releases venues and equipment and notifies people |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. Click **Cancel event**, enter the reason, tick the confirmation, click **Confirm cancellation**.<br>5. Sign in as venuestaff1: **Booking requests** → Show *All requests*.<br>6. Sign in as tech: **Reservations**.<br>7. Sign in as organiser1 and attendee1 (Individuals): **Notifications**; organiser1 **My events**. |
| Test Data | Reason: Client postponed indefinitely. |
| Expected Result | 1. *Event cancelled and arrangements released.*; status CANCELLED.<br>2. Both Product Launch Gala bookings are no longer Approved (released).<br>3. The VISUAL reservation moves to *Past reservations*.<br>4. Organiser and registered attendees are notified with the reason; the event is still listed as CANCELLED. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D4 (SCRUM-114) — Cancel an event. D4 AC2–AC6. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M059 — D5: Completion refused before the event has ended

| Item | Value |
| --- | --- |
| Test Case ID | TC-M059 |
| Test Scenario | Completion refused before the event has ended |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Leadership Talk**, click **View request**.<br>4. Click **Mark completed**. |
| Test Data | Seeded: Leadership Talk, future date |
| Expected Result | Refused with *The event end date and time have not passed yet.*; status stays CONFIRMED. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D5 (SCRUM-115) — Close out an event after it has taken place. D5 AC1. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M060 — D5: Complete an event that has ended

| Item | Value |
| --- | --- |
| Test Case ID | TC-M060 |
| Test Scenario | Complete an event that has ended |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Quarterly Town Hall**, click **View request**.<br>4. Click **Mark completed**.<br>5. Open **Assigned events** (Active events).<br>6. Sign in as organiser1 and open the event. |
| Test Data | Seeded: Quarterly Town Hall dated 2 days ago (CONFIRMED) |
| Expected Result | 1. *Event marked completed.*; status COMPLETED.<br>2. It leaves the active list (visible under All statuses).<br>3. The organiser can still open it with its venue and decision. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D5 (SCRUM-115) — Close out an event after it has taken place. D5 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M061 — D6: Activity is chronological, newest first, read-only

| Item | Value |
| --- | --- |
| Test Case ID | TC-M061 |
| Test Scenario | Activity is chronological, newest first, read-only |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Leadership Talk**, click **View request**.<br>4. Open **Activity**. |
| Test Data | Seeded: Leadership Talk |
| Expected Result | 1. Entries: Event submitted, Assigned a coordinator, Started review, Approved the request, Approved a venue booking, Sent for safety check, Approved the safety check — newest at the top, each with actor and time.<br>2. No edit or delete control. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D6 (SCRUM-116) — See everything that happened to an event. D6 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M062 — D6: History remains on terminal events

| Item | Value |
| --- | --- |
| Test Case ID | TC-M062 |
| Test Scenario | History remains on terminal events |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Winter Craft Market**, click **View request**.<br>4. Open **Activity**.<br>5. Repeat for **Rooftop Fireworks Party**. |
| Test Data | Seeded cancelled and rejected events |
| Expected Result | Both show their full history including *Cancelled the event* / *Rejected the request* with the reason. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story D6 (SCRUM-116) — See everything that happened to an event. D6 AC2, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## E — Venue catalogue

### TC-M063 — E1: Venue Staff edit their own venue; others read-only

| Item | Value |
| --- | --- |
| Test Case ID | TC-M063 |
| Test Scenario | Venue Staff edit their own venue; others read-only |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Venue catalogue**.<br>3. Compare buttons on Marina Grand Hall and Fort Canning Garden Lawn.<br>4. On **Bayview Meeting Room** click **Update venue**. Check fields; set *Space availability for special requirements*; click **Save venue**. |
| Test Data | Special space: Quiet room next door on request. |
| Expected Result | 1. Own venues (Marina Grand Hall, Bayview Meeting Room) offer **Update venue**; Siti Rahman's venues offer only **View venue**.<br>2. The form holds name, building/location, maximum capacity, layouts, facilities, accessibility and operating hours; the save succeeds. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E1 (SCRUM-117) — Maintain the venue catalogue. E1 AC1, AC3, AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M064 — E1: Capacity of zero and no layout are refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M064 |
| Test Scenario | Capacity of zero and no layout are refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. Open **Venue catalogue**; On **Bayview Meeting Room** click **Update venue**.<br>2. Set Maximum capacity to 0; **Save venue**.<br>3. Set capacity 40, untick every layout; **Save venue**. |
| Test Data | Capacity 0; no layouts |
| Expected Result | Each save is refused with an error; the venue is unchanged. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E1 (SCRUM-117) — Maintain the venue catalogue. E1 AC2. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M065 — E1: Changing a venue's capacity leaves approved bookings unchanged

| Item | Value |
| --- | --- |
| Test Case ID | TC-M065 |
| Test Scenario | Changing a venue's capacity leaves approved bookings unchanged |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. Update **Bayview Meeting Room** capacity to 35 and save.<br>2. Open **Booking requests** → Show *All requests*; find Leadership Talk and Product Launch Gala (Bayview). |
| Test Data | Capacity 40 → 35 |
| Expected Result | Both bookings are still APPROVED. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E1 (SCRUM-117) — Maintain the venue catalogue. E1 AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M066 — E2: Coordinator browses the catalogue and opens a full record

| Item | Value |
| --- | --- |
| Test Case ID | TC-M066 |
| Test Scenario | Coordinator browses the catalogue and opens a full record |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Venue catalogue**; clear filters if any.<br>3. On **Marina Grand Hall** click **View venue**. |
| Test Data | Seeded venues: Marina Grand Hall, Bayview Meeting Room, Fort Canning Garden Lawn, East Coast Pavilion |
| Expected Result | 1. All four venues list with location, *Capacity N* and headline facilities.<br>2. The record shows layouts THEATRE, CLASSROOM, BANQUET, accessibility WHEELCHAIR_ACCESS, LIFT, ACCESSIBLE_TOILET, Mon–Fri 08:00–22:00, setup 30 and turnaround 30. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E2 (SCRUM-118) — Browse the venue catalogue. E2 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M067 — E2: Attendees and organisers have no catalogue

| Item | Value |
| --- | --- |
| Test Case ID | TC-M067 |
| Test Scenario | Attendees and organisers have no catalogue |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee1@manual.test`.<br>2. Look for Venue catalogue in the sidebar.<br>3. Repeat as organiser1. |
| Test Data | attendee1, organiser1 |
| Expected Result | Neither role is offered the Venue catalogue. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E2 (SCRUM-118) — Browse the venue catalogue. E2 AC3. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M068 — E3: Record an unavailability period and see it on the calendar

| Item | Value |
| --- | --- |
| Test Case ID | TC-M068 |
| Test Scenario | Record an unavailability period and see it on the calendar |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. Open **Venue catalogue** → **Update venue** on **Bayview Meeting Room**.<br>2. In *Block this venue* enter the test data and click **Add period**, then **Save changes**.<br>3. Open **Availability calendar**, choose Bayview Meeting Room and go to that day. |
| Test Data | Starts: a free weekday ~15 days ahead 06:00; Ends: same day 23:00; Reason: Maintenance |
| Expected Result | 1. The period is listed under the venue's unavailability.<br>2. The calendar shows that day as Blocked. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E3 (SCRUM-119) — Record when a venue cannot be used. E3 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M069 — E4: Calendar distinguishes free, booked, pending, held, blocked and closed

| Item | Value |
| --- | --- |
| Test Case ID | TC-M069 |
| Test Scenario | Calendar distinguishes free, booked, pending, held, blocked and closed |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Venue catalogue** → **View calendar**.<br>3. Read the legend; go to the month with the events listed. |
| Test Data | Marina Grand Hall: Open Day Tours (booked), Wellness Talk Series (held); Bayview: Startup Pitch Night (pending); Fort Canning Garden Lawn: maintenance block ~18 days ahead |
| Expected Result | 1. Legend shows Free, Booked, Pending, Blocked, Closed (and Held).<br>2. Each seeded booking appears in its state; the garden lawn shows Blocked over the maintenance days; weekends at Marina Grand Hall show Closed; booked blocks show the event name with setup/turnaround. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E4 (SCRUM-120) — See when a venue is free. E4 AC1–AC7. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M070 — E4: Calendar for a venue with no availability data

| Item | Value |
| --- | --- |
| Test Case ID | TC-M070 |
| Test Scenario | Calendar for a venue with no availability data |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as coordinator1@manual.test. |
| Test Steps | 1. Open the availability calendar and choose **East Coast Pavilion** for next month. |
| Test Data | East Coast Pavilion (only booking: Night Market Fest) |
| Expected Result | Free days are shown as free; a clear message or empty-state appears where no data exists rather than an error. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E4 (SCRUM-120) — See when a venue is free. E4 AC8. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M071 — E5: Search from an event is pre-filled and excludes small venues

| Item | Value |
| --- | --- |
| Test Case ID | TC-M071 |
| Test Scenario | Search from an event is pre-filled and excludes small venues |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. Click **Find venues**. |
| Test Data | Harbour Arts Showcase: 150 pax, 14:00–17:00 |
| Expected Result | 1. *Pre-filled from the event: <date> · 14:00–17:00 · 150 attending*.<br>2. Marina Grand Hall and Fort Canning Garden Lawn are listed; Bayview Meeting Room (40) and East Coast Pavilion (120) are not. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E5 (SCRUM-121) — Find venues that fit my event. E5 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M072 — E5: Zero results reports the criteria applied

| Item | Value |
| --- | --- |
| Test Case ID | TC-M072 |
| Test Scenario | Zero results reports the criteria applied |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As previous case, on the Venue catalogue opened from Harbour Arts Showcase. |
| Test Steps | 1. Set *Minimum capacity* to 10000. |
| Test Data | Minimum capacity 10000 |
| Expected Result | Result count reads *0 venues* with *No venues match the current criteria.* and the criteria with the number each excluded. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E5 (SCRUM-121) — Find venues that fit my event. E5 AC4. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M073 — E6: Filters combine, show as chips and clear in one action

| Item | Value |
| --- | --- |
| Test Case ID | TC-M073 |
| Test Scenario | Filters combine, show as chips and clear in one action |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Venue catalogue** (from the sidebar).<br>3. Tick facility STAGE; note the count.<br>4. Set Location *East*.<br>5. Click **Clear filters**. |
| Test Data | Facility STAGE; Location East |
| Expected Result | 1. STAGE: Marina Grand Hall and East Coast Pavilion; count updates.<br>2. Adding East leaves only East Coast Pavilion.<br>3. Active filters are visible; **Clear filters** restores all four. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E6 (SCRUM-122) — Narrow the shortlist. E6 AC1–AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M074 — E6: A combination no venue meets

| Item | Value |
| --- | --- |
| Test Case ID | TC-M074 |
| Test Scenario | A combination no venue meets |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as coordinator1@manual.test, Venue catalogue open. |
| Test Steps | 1. Tick STAGE and set Supported layout *OPEN_SPACE*. |
| Test Data | STAGE + OPEN_SPACE |
| Expected Result | *0 venues*. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E6 (SCRUM-122) — Narrow the shortlist. E6 AC2. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M075 — E7: A fully suitable venue is reported suitable

| Item | Value |
| --- | --- |
| Test Case ID | TC-M075 |
| Test Scenario | A fully suitable venue is reported suitable |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. Click **Find venues** → **Book venue** on **Marina Grand Hall**.<br>5. Read *Choose a venue*. |
| Test Data | Event needs THEATRE, STAGE, WIFI, WHEELCHAIR_ACCESS, 150 pax |
| Expected Result | Marina Grand Hall reads *Meets all requirements*; the criteria evaluated are shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E7 (SCRUM-123) — Know whether a venue actually suits the event. E7 AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M076 — E7: An unsuitable venue names every failing criterion

| Item | Value |
| --- | --- |
| Test Case ID | TC-M076 |
| Test Scenario | An unsuitable venue names every failing criterion |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As previous case. |
| Test Steps | 1. In *Choose a venue* select **Fort Canning Garden Lawn**, then **Bayview Meeting Room**. |
| Test Data | Same event |
| Expected Result | 1. Garden Lawn: fails layout (THEATRE), facilities STAGE and WIFI, accessibility WHEELCHAIR_ACCESS.<br>2. Bayview: fails capacity (40 < 150) plus STAGE and layout. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E7 (SCRUM-123) — Know whether a venue actually suits the event. E7 AC1–AC3. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M077 — E8: Booking a venue below attendance is blocked

| Item | Value |
| --- | --- |
| Test Case ID | TC-M077 |
| Test Scenario | Booking a venue below attendance is blocked |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. **Find venues** → **Book venue** on Marina Grand Hall.<br>5. Select **Bayview Meeting Room**. |
| Test Data | 150 pax vs 40 capacity |
| Expected Result | An alert is shown and **Request this venue** is disabled. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E8 (SCRUM-124) — Be stopped before booking an unsuitable venue. E8 AC1. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M078 — E8: Facility shortfall needs acknowledgement, which Venue Staff then see

| Item | Value |
| --- | --- |
| Test Case ID | TC-M078 |
| Test Scenario | Facility shortfall needs acknowledgement, which Venue Staff then see |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. **Find venues** → **Book venue**; select **Fort Canning Garden Lawn**.<br>5. Tick the acknowledgement; click **Request this venue**.<br>6. Sign in as venuestaff2; **Booking requests** → **View request** on Harbour Arts Showcase. |
| Test Data | Fort Canning Garden Lawn (500 seats, lacks STAGE/WIFI/THEATRE/WHEELCHAIR_ACCESS) |
| Expected Result | 1. Request is disabled until acknowledged, then *Booking request sent to Venue Staff.*<br>2. Venue Staff see *Known suitability shortfalls* listing the acknowledged criteria. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E8 (SCRUM-124) — Be stopped before booking an unsuitable venue. E8 AC2, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M079 — E9: Set setup and turnaround times

| Item | Value |
| --- | --- |
| Test Case ID | TC-M079 |
| Test Scenario | Set setup and turnaround times |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. **Update venue** on Bayview Meeting Room; set setup 20 and turnaround 25; **Save venue**.<br>2. Sign in as coordinator1; open the venue via **View venue**. |
| Test Data | Setup 20; Turnaround 25 |
| Expected Result | Save succeeds; the record shows setup 20 and turnaround 25 minutes. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E9 (SCRUM-171) — Set a venue's setup and turnaround time. E9 AC1, AC3, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M080 — E9: Negative or decimal minutes are refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M080 |
| Test Scenario | Negative or decimal minutes are refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. **Update venue** on Bayview Meeting Room; set setup -5; save.<br>2. Set setup 0 and turnaround 2.5; save.<br>3. Set setup 0 and turnaround 0; save. |
| Test Data | -5; 2.5; 0 |
| Expected Result | -5 and 2.5 are refused with a validation message; 0 and 0 are accepted. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E9 (SCRUM-171) — Set a venue's setup and turnaround time. E9 AC2. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M081 — E10: Venue Staff record safety information; Safety Officer reads it

| Item | Value |
| --- | --- |
| Test Case ID | TC-M081 |
| Test Scenario | Venue Staff record safety information; Safety Officer reads it |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. **Update venue** on Marina Grand Hall; change *Emergency access notes* and *Known restrictions*; **Save venue**.<br>2. Sign in as safety; **Venue safety information** → **View safety information** on Marina Grand Hall. |
| Test Data | Emergency: Fire engines via Gate B.; Restrictions: No open flames on stage. |
| Expected Result | Saved; the Safety Officer sees both new texts. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E10 (SCRUM-172) — Record a venue's safety information. E10 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M082 — E10: Other roles cannot edit safety information

| Item | Value |
| --- | --- |
| Test Case ID | TC-M082 |
| Test Scenario | Other roles cannot edit safety information |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. Open **Venue safety information**.<br>3. Sign in as coordinator1; open **Venue catalogue**. |
| Test Data | - |
| Expected Result | Neither offers **Update venue**; fields are read-only. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E10 (SCRUM-172) — Record a venue's safety information. E10 AC2. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M083 — E11: Block a venue over an approved booking: listed, confirmed, flagged, not cancelled

| Item | Value |
| --- | --- |
| Test Case ID | TC-M083 |
| Test Scenario | Block a venue over an approved booking: listed, confirmed, flagged, not cancelled |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. Note the date of **Product Launch Gala** (shown in Booking requests). |
| Test Steps | 1. **Update venue** on **Marina Grand Hall**; Block this venue from 06:00 to 22:00 on that date, Reason *Safety concern*; click **Add period**.<br>2. Read the warning; click **Confirm and add period**, then **Save changes**.<br>3. Sign in as coordinator1: **Venue bookings**, **Notifications**, and open the event. |
| Test Data | Day: Product Launch Gala's date; Reason: Safety concern |
| Expected Result | 1. Warning *This period overlaps approved bookings.* lists Product Launch Gala.<br>2. The Main programme booking is marked *Venue unavailable – replacement needed*; the event is not cancelled.<br>3. Chloe Ng is notified with event, venue, period and reason. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story E11 (SCRUM-173) — Take a venue out of use even when events are booked there. E11 AC1–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## F — Venue bookings

### TC-M084 — F1: Request a venue from an Approved event; it lands Pending

| Item | Value |
| --- | --- |
| Test Case ID | TC-M084 |
| Test Scenario | Request a venue from an Approved event; it lands Pending |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. **Find venues** → **Book venue** on **Marina Grand Hall**.<br>5. Check *Event details*; click **Request this venue**.<br>6. Sign in as venuestaff1; open **Booking requests**. |
| Test Data | Harbour Arts Showcase → Marina Grand Hall |
| Expected Result | 1. Event details show the date, 14:00–17:00, 150, THEATRE, STAGE and WIFI.<br>2. *Booking request sent to Venue Staff.*<br>3. It is PENDING in Ravi Kumar's queue. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F1 (SCRUM-125) — Request a venue for an event. F1 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M085 — F1: A second pending request for the same venue is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M085 |
| Test Scenario | A second pending request for the same venue is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Startup Pitch Night**, click **View request**.<br>4. **Find venues**; on the booking form choose **Bayview Meeting Room**. |
| Test Data | Startup Pitch Night already has a PENDING Bayview request |
| Expected Result | An alert says the event already has a pending/active request for this venue; the request cannot be sent. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F1 (SCRUM-125) — Request a venue for an event. F1 AC4. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M086 — F1: Venue requests only from Approved or Planning

| Item | Value |
| --- | --- |
| Test Case ID | TC-M086 |
| Test Scenario | Venue requests only from Approved or Planning |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Youth Coding Workshop**, click **View request**. |
| Test Data | Youth Coding Workshop (UNDER_REVIEW) |
| Expected Result | **Find venues** is disabled with *Venue requests are available only for events with Approved or Planning status.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F1 (SCRUM-125) — Request a venue for an event. F1 AC2. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M087 — F2: A request goes to the one staff member managing that venue

| Item | Value |
| --- | --- |
| Test Case ID | TC-M087 |
| Test Scenario | A request goes to the one staff member managing that venue |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. **Find venues**, clear filters, **Book venue** on **East Coast Pavilion** (acknowledge any warning) and request it.<br>5. Sign in as venuestaff2; open **Booking requests**.<br>6. Sign in as venuestaff1; open **Booking requests**. |
| Test Data | East Coast Pavilion is managed by Siti Rahman |
| Expected Result | Siti Rahman sees the request PENDING; Ravi Kumar does not. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F2 (SCRUM-126) — Have submitted event bookings assigned to a venue staff automatically. F2 AC1, AC2, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M088 — F3: Queue shows only my venues' requests with details and sorting

| Item | Value |
| --- | --- |
| Test Case ID | TC-M088 |
| Test Scenario | Queue shows only my venues' requests with details and sorting |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Booking requests**.<br>3. On Startup Pitch Night click **View request**.<br>4. Switch *Sort by* between *Submission time* and *Requested date*. |
| Test Data | Seeded pending: Startup Pitch Night (1 day ago), Founders Breakfast Roundtable (5 hours ago) |
| Expected Result | 1. Each row shows event, venue, date/window and *Submitted … ago*; detail shows expected attendance and occupied window.<br>2. Sorting reorders the list.<br>3. No Fort Canning or East Coast requests appear. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F3 (SCRUM-127) — See booking requests waiting on me. F3 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M089 — F3: The other staff member sees only their venues

| Item | Value |
| --- | --- |
| Test Case ID | TC-M089 |
| Test Scenario | The other staff member sees only their venues |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff2@manual.test`.<br>2. Open **Booking requests** → Show *All requests*. |
| Test Data | Siti Rahman manages Fort Canning Garden Lawn and East Coast Pavilion |
| Expected Result | Only Alumni Homecoming, Community Food Fair and Night Market Fest; no Marina or Bayview requests. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F3 (SCRUM-127) — See booking requests waiting on me. F3 AC1. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M090 — F4: Later of two competing requests cannot be approved first

| Item | Value |
| --- | --- |
| Test Case ID | TC-M090 |
| Test Scenario | Later of two competing requests cannot be approved first |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Booking requests**.<br>3. Click **Approve** on **Founders Breakfast Roundtable**. |
| Test Data | Both requests are for Bayview Meeting Room on the same evening; Startup Pitch Night was submitted first |
| Expected Result | Refused with *An earlier submitted request for this venue and time must be decided first.*; it stays PENDING. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F4 (SCRUM-128) — Approve a venue booking request. F4 AC4. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M091 — F4: Approve the earlier request; the overlapping one is refused naming the clash

| Item | Value |
| --- | --- |
| Test Case ID | TC-M091 |
| Test Scenario | Approve the earlier request; the overlapping one is refused naming the clash |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. Open **Booking requests**; **Approve** **Startup Pitch Night**.<br>2. **Approve** **Founders Breakfast Roundtable**. |
| Test Data | As above |
| Expected Result | 1. Startup Pitch Night becomes APPROVED (*Decided just now*).<br>2. Founders is refused with a clash message naming Startup Pitch Night; stays PENDING. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F4 (SCRUM-128) — Approve a venue booking request. F4 AC1–AC3. Normal + conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M092 — F5: Reject needs a reason; the coordinator reads it in full

| Item | Value |
| --- | --- |
| Test Case ID | TC-M092 |
| Test Scenario | Reject needs a reason; the coordinator reads it in full |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. On **Founders Breakfast Roundtable** click **Reject**, then **Confirm rejection** with an empty reason.<br>2. Enter the reason and **Confirm rejection**.<br>3. Sign in as coordinator1; **Venue bookings** → **View details** on it. |
| Test Data | Reason: The room is being repainted that week. |
| Expected Result | 1. Empty: error shown.<br>2. With reason: REJECTED.<br>3. Coordinator sees the full reason and decision time; no approve/override. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F5 (SCRUM-129) — Reject a venue booking request with a reason. F5 AC1, AC2, AC4. Normal + failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M093 — F5: The venue stays available after a rejection

| Item | Value |
| --- | --- |
| Test Case ID | TC-M093 |
| Test Scenario | The venue stays available after a rejection |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As previous case after rejecting Founders. |
| Test Steps | 1. **Approve** **Startup Pitch Night**. |
| Test Data | - |
| Expected Result | Startup Pitch Night is approved; the rejected request did not occupy the room. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F5 (SCRUM-129) — Reject a venue booking request with a reason. F5 AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M094 — F6: Occupied windows that only touch do not conflict

| Item | Value |
| --- | --- |
| Test Case ID | TC-M094 |
| Test Scenario | Occupied windows that only touch do not conflict |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As venuestaff1@manual.test, approve **Startup Pitch Night** in **Booking requests** (Bayview 18:00–21:00, occupied 17:45–21:15). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Riverside Book Fair**, click **View request**.<br>4. Click **Edit event**; set Proposed date to Startup Pitch Night's date and times to the test data; tick the acknowledgement; **Save changes**.<br>5. Click **Find venues**, then **Clear filters**. |
| Test Data | Riverside Book Fair new time: 21:30–21:45 (occupied at Bayview 21:15–22:00) |
| Expected Result | Bayview Meeting Room is listed as available: its occupied window starts exactly when Startup Pitch Night's ends. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F6 (SCRUM-130) — Never double-book a venue. F6 AC2, AC3. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M095 — F6: An overlapping window is caught

| Item | Value |
| --- | --- |
| Test Case ID | TC-M095 |
| Test Scenario | An overlapping window is caught |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As previous case (Startup Pitch Night approved). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Riverside Book Fair**, click **View request**.<br>4. **Edit event**: same date as Startup Pitch Night, times as test data; acknowledge; save.<br>5. **Find venues** → **Clear filters**. |
| Test Data | Riverside Book Fair new time: 20:30–21:45 |
| Expected Result | Bayview Meeting Room is excluded from the results. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F6 (SCRUM-130) — Never double-book a venue. F6 AC1, AC3. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M096 — F7: The event lists every booking with status, reason and time

| Item | Value |
| --- | --- |
| Test Case ID | TC-M096 |
| Test Scenario | The event lists every booking with status, reason and time |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Winter Craft Market**, click **View request**.<br>4. Open **Arrangements**.<br>5. Repeat for **Startup Pitch Night**; then go to **Event request**. |
| Test Data | Craft market: rejected Marina Grand Hall request; Pitch night: pending Bayview request |
| Expected Result | 1. Craft market shows Marina Grand Hall REJECTED with *Hall closed for a private function.* and decision time.<br>2. Pitch night shows Bayview PENDING and **Send for safety check** is disabled. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F7 (SCRUM-131) — Track the status of my booking requests. F7 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M097 — F8: Cancelling releases the window for others

| Item | Value |
| --- | --- |
| Test Case ID | TC-M097 |
| Test Scenario | Cancelling releases the window for others |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Open Day Tours**, click **View request**.<br>4. Cancel the event with a reason and the tick.<br>5. Open **Activity**.<br>6. Sign in as venuestaff1: **Booking requests** → Show *All requests*. |
| Test Data | Reason: Budget withdrawn. |
| Expected Result | 1. Status CANCELLED; Activity has a release entry with reason and time.<br>2. The Marina Grand Hall booking is no longer Approved, and the day is free on the calendar. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F8 (SCRUM-132) — Release a venue when it is no longer needed. F8 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M098 — F9: Occupied window includes setup and turnaround

| Item | Value |
| --- | --- |
| Test Case ID | TC-M098 |
| Test Scenario | Occupied window includes setup and turnaround |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Booking requests** → **View request** on **Leadership Talk**. |
| Test Data | Leadership Talk 13:00–15:00 at Bayview (setup 15, turnaround 15) |
| Expected Result | The occupied window reads 12:45 to 15:15. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F9 (SCRUM-174) — Count setup and turnaround time when checking for clashes. F9 AC1, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M099 — F9: Event times that do not overlap still clash through setup/turnaround

| Item | Value |
| --- | --- |
| Test Case ID | TC-M099 |
| Test Scenario | Event times that do not overlap still clash through setup/turnaround |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As venuestaff1@manual.test, approve **Startup Pitch Night** (ends 21:00; Bayview turnaround 15 min → occupied until 21:15). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Riverside Book Fair**, click **View request**.<br>4. **Edit event**: Proposed date = Startup Pitch Night's date; times as test data; acknowledge; save.<br>5. **Find venues** → **Clear filters**. |
| Test Data | Riverside Book Fair new time: 21:20–21:45 (occupied from 21:05) |
| Expected Result | Bayview Meeting Room is excluded even though 21:20 is after Startup Pitch Night's 21:00 end. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F9 (SCRUM-174) — Count setup and turnaround time when checking for clashes. F9 AC3, AC4. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M100 — F10: Longer turnaround flags existing bookings that now clash

| Item | Value |
| --- | --- |
| Test Case ID | TC-M100 |
| Test Scenario | Longer turnaround flags existing bookings that now clash |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as venuestaff1@manual.test. |
| Test Steps | 1. **Update venue** on **Bayview Meeting Room**; set Turnaround 60; **Save venue**.<br>2. Open **Booking requests** → Show *Clashes*.<br>3. Sign in as coordinator1 → **Notifications**. |
| Test Data | Bayview: Product Launch Gala Breakout 1 10:00–12:00 and Leadership Talk 13:00–15:00 on the same day |
| Expected Result | 1. Both show *Clash - review required* — *Overlaps Leadership Talk: 12:45–13:00*; both remain APPROVED.<br>2. Chloe Ng is notified of the clash. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F10 (SCRUM-175) — See existing bookings that now clash. F10 AC1–AC4, AC6. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M101 — F11: Replacement venue after a venue is taken out of use

| Item | Value |
| --- | --- |
| Test Case ID | TC-M101 |
| Test Scenario | Replacement venue after a venue is taken out of use |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. **Venue catalogue** → **Update venue** on **Bayview Meeting Room**; block it 06:00–22:00 on Leadership Talk's date, Reason *Maintenance*; **Add period** → **Confirm and add period** → **Save changes**.<br>3. Sign in as coordinator1; open Leadership Talk; check its status.<br>4. **Venue bookings** → **View details** on its Bayview booking → **Find replacement venue**.<br>5. **Book venue** on **Marina Grand Hall** → **Request this venue**.<br>6. Sign in as venuestaff1 and approve it; back as coordinator1 view **Venue bookings**. |
| Test Data | Leadership Talk (CONFIRMED, Bayview) |
| Expected Result | 1. Status returned to PLANNING; booking flagged for replacement.<br>2. Search is pre-filled and excludes Bayview.<br>3. After approval the original booking reads *Replaced*; event details unchanged. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F11 (SCRUM-176) — Find a replacement venue for an event that lost its venue. F11 AC1–AC6. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M102 — F12: Book a second venue with its own label and attendance

| Item | Value |
| --- | --- |
| Test Case ID | TC-M102 |
| Test Scenario | Book a second venue with its own label and attendance |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**.<br>4. Request **Marina Grand Hall** (as F1).<br>5. **Find venues** → **Book venue** on **East Coast Pavilion**; set Booking label and attendance as test data; request it.<br>6. Open **Arrangements**. |
| Test Data | Label: Breakout 1; Expected attendance for this venue: 25 |
| Expected Result | Both requests are listed with label, venue, window and status. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F12 (SCRUM-177) — Book more than one venue for an event. F12 AC1, AC2, AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M103 — F12: Per-venue attendance above the event's is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M103 |
| Test Scenario | Per-venue attendance above the event's is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As previous case, on the East Coast Pavilion booking form. |
| Test Steps | 1. Set *Expected attendance for this venue* to 151, then 0. |
| Test Data | 151; 0 |
| Expected Result | **Request this venue** is disabled for both. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F12 (SCRUM-177) — Book more than one venue for an event. F12 AC3. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M104 — F13: A rejected second venue leaves the first approved and blocks the safety check

| Item | Value |
| --- | --- |
| Test Case ID | TC-M104 |
| Test Scenario | A rejected second venue leaves the first approved and blocks the safety check |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Do F12 normal case, then sign in as venuestaff1 and approve the Marina Grand Hall request. |
| Test Steps | 1. Sign in as venuestaff2; **Reject** the East Coast Pavilion request with a reason.<br>2. Sign in as coordinator1; open the event → **Arrangements**, then **Event request**. |
| Test Data | Reason: Double-booked with a wedding. |
| Expected Result | 1. Marina Grand Hall still APPROVED; East Coast Pavilion REJECTED.<br>2. While any active booking is not approved, **Send for safety check** is disabled. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F13 (SCRUM-178) — Have each venue of an event checked on its own. F13 AC1–AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M105 — F14: Release one venue and keep the other

| Item | Value |
| --- | --- |
| Test Case ID | TC-M105 |
| Test Scenario | Release one venue and keep the other |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Venue bookings**; on Product Launch Gala *Breakout 1* click **View details** → **Release this venue**.<br>3. Enter the reason; click **Release venue**.<br>4. Open the event: **Arrangements** and **Activity**. |
| Test Data | Reason: Breakout sessions merged into the main hall. |
| Expected Result | 1. Breakout 1 released; Main programme stays APPROVED.<br>2. Activity shows the release with reason and time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F14 (SCRUM-179) — Release one venue without losing the others. F14 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M106 — F15: Place a hold; its expiry is set automatically

| Item | Value |
| --- | --- |
| Test Case ID | TC-M106 |
| Test Scenario | Place a hold; its expiry is set automatically |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Booking requests**; on **Startup Pitch Night** click **Place hold**.<br>3. Sign in as coordinator1: open the event and **Notifications**. |
| Test Data | Startup Pitch Night (Bayview, PENDING) |
| Expected Result | 1. Row shows HELD with *Held until <weekday date, time>* — 3 working days from now; no expiry is typed.<br>2. **Send for safety check** stays disabled (a hold is not a booking).<br>3. Coordinator is told the venue is held until that time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F15 (SCRUM-180) — Place a tentative hold on a venue. F15 AC1, AC2, AC5, AC6. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M107 — F15: An active hold blocks other requests for the same window

| Item | Value |
| --- | --- |
| Test Case ID | TC-M107 |
| Test Scenario | An active hold blocks other requests for the same window |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Riverside Book Fair**, click **View request**.<br>4. **Edit event**: Proposed date = Wellness Talk Series' date, times as test data; acknowledge; save.<br>5. **Find venues** → **Clear filters** → **Book venue** on any venue; in *Choose a venue* select **Marina Grand Hall**; click **Request this venue**. |
| Test Data | Riverside Book Fair new time: 12:00–14:00 (Wellness Talk Series holds Marina Grand Hall then) |
| Expected Result | The request is refused: *Marina Grand Hall is held for … until <expiry>, and cannot be requested for an overlapping time.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F15 (SCRUM-180) — Place a tentative hold on a venue. F15 AC3. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M108 — F15: Convert a hold into an approved booking

| Item | Value |
| --- | --- |
| Test Case ID | TC-M108 |
| Test Scenario | Convert a hold into an approved booking |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Booking requests** → Show *On hold*.<br>3. On **Wellness Talk Series** click **Convert to booking**.<br>4. Show *All requests*. |
| Test Data | Wellness Talk Series (HELD) |
| Expected Result | It becomes APPROVED, with no expiry shown. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F15 (SCRUM-180) — Place a tentative hold on a venue. F15 AC7. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M109 — F16: An expired hold is shown expired and the slot is free

| Item | Value |
| --- | --- |
| Test Case ID | TC-M109 |
| Test Scenario | An expired hold is shown expired and the slot is free |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `venuestaff1@manual.test`.<br>2. Open **Booking requests** → Show *All requests*.<br>3. Sign in as coordinator1; open **Riverside Book Fair** → **Find venues**. |
| Test Data | Riverside Book Fair: Marina Grand Hall hold expired 2 hours before seeding |
| Expected Result | 1. Row shows *HOLD EXPIRED*, not Approved, and has no Convert option.<br>2. Coordinator's Venue bookings shows EXPIRED; Marina Grand Hall is available in search. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story F16 (SCRUM-181) — Have unconfirmed holds expire on time. F16 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## G — Equipment

### TC-M110 — G1: Equipment request pre-filled from the organiser and amended

| Item | Value |
| --- | --- |
| Test Case ID | TC-M110 |
| Test Scenario | Equipment request pre-filled from the organiser and amended |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Equipment requests**; on **Harbour Arts Showcase** click **Create equipment request**.<br>3. Click **Add equipment line**; add the third line; click **Submit equipment request**.<br>4. Sign in as tech; **Equipment queue** → **Request details**. |
| Test Data | Pre-filled: AUDIO × 4, LIGHTING × 2. Added: OTHERS × 1, *Extension cords* |
| Expected Result | 1. Editor starts with the organiser's two lines.<br>2. Row becomes PENDING.<br>3. Technical Support see it PENDING with all three lines. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G1 (SCRUM-133) — Record the equipment an event needs. G1 AC1, AC2, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M111 — G1: Zero quantity and empty request are refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M111 |
| Test Scenario | Zero quantity and empty request are refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as coordinator1@manual.test. |
| Test Steps | 1. **Equipment requests** → **Create equipment request** on **Wellness Talk Series**.<br>2. Submit with no lines; then add AUDIO × 0 and submit. |
| Test Data | No lines; AUDIO × 0 |
| Expected Result | Both are refused with an error; nothing is sent. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G1 (SCRUM-133) — Record the equipment an event needs. G1 AC3. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M112 — G2: Technical Support see free quantity and a shortfall

| Item | Value |
| --- | --- |
| Test Case ID | TC-M112 |
| Test Scenario | Technical Support see free quantity and a shortfall |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `tech@manual.test`.<br>2. Open **Equipment catalogue**.<br>3. Open **Availability check**; on Startup Pitch Night click **Check availability**; set AUDIO quantity to 12. |
| Test Data | Stock: AUDIO 10, VISUAL 6 (2 reserved for Product Launch Gala) |
| Expected Result | 1. Catalogue shows *Held* and *free now* for each type.<br>2. The panel shows free quantity per line; for 12 AUDIO it states a shortfall of 2. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G2 (SCRUM-134) — Know whether enough equipment is free. G2 AC1, AC2. Normal + boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M113 — G3: Reserve the requested quantity

| Item | Value |
| --- | --- |
| Test Case ID | TC-M113 |
| Test Scenario | Reserve the requested quantity |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `tech@manual.test`.<br>2. **Availability check** → **Check availability** on Startup Pitch Night.<br>3. On the AUDIO line click **Reserve equipment**.<br>4. Open **Reservations**. |
| Test Data | AUDIO × 2 |
| Expected Result | 1. *AUDIO reserved for this event.*<br>2. Reservations lists Startup Pitch Night AUDIO · 2 with the occupied window including setup and turnaround. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G3 (SCRUM-135) — Reserve equipment for an event. G3 AC1, AC2, AC6, AC8, AC9. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M114 — G3: Quantity below one is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M114 |
| Test Scenario | Quantity below one is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as tech@manual.test, Availability check open for Startup Pitch Night. |
| Test Steps | 1. Set AUDIO quantity 0; click **Reserve equipment**. |
| Test Data | 0 |
| Expected Result | *Quantity must be a whole number greater than zero.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G3 (SCRUM-135) — Reserve equipment for an event. G3 AC3. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M115 — G3: Reserving more than is free fails with a reason

| Item | Value |
| --- | --- |
| Test Case ID | TC-M115 |
| Test Scenario | Reserving more than is free fails with a reason |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as tech@manual.test, Availability check open for Startup Pitch Night. |
| Test Steps | 1. Set AUDIO quantity 11 and **Reserve equipment**. |
| Test Data | 11 (only 10 held) |
| Expected Result | Reservation fails with a message that the quantity is unavailable. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G3 (SCRUM-135) — Reserve equipment for an event. G3 AC4, AC7. Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M116 — G4: Amend a line with a note

| Item | Value |
| --- | --- |
| Test Case ID | TC-M116 |
| Test Scenario | Amend a line with a note |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as tech@manual.test, Availability check open for Startup Pitch Night. |
| Test Steps | 1. Set AUDIO quantity 3, Amendment note as test data; **Save amendment**.<br>2. Sign in as coordinator1; open the event → **Arrangements**. |
| Test Data | Note: Adding a spare microphone. |
| Expected Result | *Amendment saved and visible to the coordinator.*; coordinator sees the amendment with actor and time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G4 (SCRUM-136) — Amend or refuse an equipment request. G4 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M117 — G4: Mark a line unable to be fulfilled needs a reason

| Item | Value |
| --- | --- |
| Test Case ID | TC-M117 |
| Test Scenario | Mark a line unable to be fulfilled needs a reason |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as tech@manual.test, Availability check open for Startup Pitch Night. |
| Test Steps | 1. Click **Mark unable to fulfil** on VISUAL with the reason empty.<br>2. Enter the reason and click again. |
| Test Data | Reason: All projectors are out for repair. |
| Expected Result | 1. Empty: refused.<br>2. With reason: *Line marked unable to be fulfilled with reason recorded.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G4 (SCRUM-136) — Amend or refuse an equipment request. G4 AC2. Normal + failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M118 — G5: Cancelling an event releases its equipment

| Item | Value |
| --- | --- |
| Test Case ID | TC-M118 |
| Test Scenario | Cancelling an event releases its equipment |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. **Cancel event** with a reason and the tick.<br>5. Sign in as tech; **Reservations**; **Equipment catalogue**. |
| Test Data | Product Launch Gala has VISUAL × 2 reserved; reason: Event called off. |
| Expected Result | The reservation moves to *Past reservations* with its release reason and time; VISUAL *Upcoming reservations* drops from 1 to 0. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G5 (SCRUM-137) — Release equipment when it is no longer needed. G5 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M119 — G6: A significant change flags equipment for reassessment without releasing it

| Item | Value |
| --- | --- |
| Test Case ID | TC-M119 |
| Test Scenario | A significant change flags equipment for reassessment without releasing it |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. **Edit event**; change start time to 09:30; acknowledge; **Save changes**.<br>5. Sign in as tech: **Reservations** and **Notifications**.<br>6. Click **Re-check availability**. |
| Test Data | Start 10:00 → 09:30 |
| Expected Result | 1. Reservation still listed, marked *Needs reassessment*; Technical Support notified.<br>2. Re-check shows availability for the new window with keep/amend/release options. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story G6 (SCRUM-138) — Reassess equipment after a significant change. G6 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## H — Attendee registration

### TC-M120 — H1: Organiser sets registration capacity and window

| Item | Value |
| --- | --- |
| Test Case ID | TC-M120 |
| Test Scenario | Organiser sets registration capacity and window |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. **My events** → **View details** on **Product Launch Gala** → **Registration** tab.<br>3. Change capacity; **Save registration settings**. |
| Test Data | Capacity 100 → 120 |
| Expected Result | *Registration settings saved.*; the tab shows Currently registered 3. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H1 (SCRUM-139) — Open registration for my event. H1 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M121 — H1: Capacity above the booked venue is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M121 |
| Test Scenario | Capacity above the booked venue is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. As previous case. |
| Test Steps | 1. Set capacity 500 and save. |
| Test Data | 500 (booked venues: Marina Grand Hall 200, Bayview Meeting Room 40) |
| Expected Result | An error refuses the capacity; settings unchanged. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H1 (SCRUM-139) — Open registration for my event. H1 AC3. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M122 — H1: Capacity below current registrations is refused

| Item | Value |
| --- | --- |
| Test Case ID | TC-M122 |
| Test Scenario | Capacity below current registrations is refused |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **Leadership Talk** → **Registration**.<br>3. Set capacity 1 and save. |
| Test Data | 2 registered |
| Expected Result | An error refuses it; capacity stays 2. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H1 (SCRUM-139) — Open registration for my event. H1 AC5. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M123 — H2: Browse lists only events open now, with details

| Item | Value |
| --- | --- |
| Test Case ID | TC-M123 |
| Test Scenario | Browse lists only events open now, with details |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee4@manual.test`.<br>2. Open **Browse events**. |
| Test Data | Open now: Open Day Tours, Product Launch Gala, Leadership Talk. Not open: Alumni Homecoming (closed), Harbour Arts Showcase (opens in 14 days), Winter Craft Market (cancelled), drafts and rejected |
| Expected Result | Exactly the three open events are listed, each with name, description, date, window, venue(s) and places left (Open Day 49, Launch 97, Leadership *Full*). |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H2 (SCRUM-140) — Find events I can register for. H2 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M124 — H2: Events not open are hidden

| Item | Value |
| --- | --- |
| Test Case ID | TC-M124 |
| Test Scenario | Events not open are hidden |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee2@manual.test`.<br>2. Open **Browse events**; search/scroll for the not-open events in the test data. |
| Test Data | Alumni Homecoming, Harbour Arts Showcase, Winter Craft Market, Rooftop Fireworks Party, Spring Poetry Reading |
| Expected Result | None are listed. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H2 (SCRUM-140) — Find events I can register for. H2 AC3. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M125 — H3: Register for an event with places

| Item | Value |
| --- | --- |
| Test Case ID | TC-M125 |
| Test Scenario | Register for an event with places |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee1@manual.test`.<br>2. **Browse events**; on **Open Day Tours** click **Register**.<br>3. Check the card; click **View details**. |
| Test Data | Open Day Tours: 49 places left |
| Expected Result | 1. *You are registered for Open Day Tours.*<br>2. Card shows REGISTERED, 48 places left, no Register button; details open. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H3 (SCRUM-141) — Register for an event. H3 AC1–AC4, AC7, AC8. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M126 — H3: A full event says so

| Item | Value |
| --- | --- |
| Test Case ID | TC-M126 |
| Test Scenario | A full event says so |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee4@manual.test`.<br>2. **Browse events**; look at **Leadership Talk**. |
| Test Data | Capacity 2, 2 registered |
| Expected Result | Shows FULL, *This event is full.* and **Join waiting list**, no Register. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H3 (SCRUM-141) — Register for an event. H3 AC5. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M127 — H3: Registration closed

| Item | Value |
| --- | --- |
| Test Case ID | TC-M127 |
| Test Scenario | Registration closed |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee2@manual.test`.<br>2. **Browse events**; look for **Alumni Homecoming**. |
| Test Data | Window closed yesterday |
| Expected Result | Not listed, cannot be registered for. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H3 (SCRUM-141) — Register for an event. H3 AC6. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M128 — H4: My registrations shows each event and status

| Item | Value |
| --- | --- |
| Test Case ID | TC-M128 |
| Test Scenario | My registrations shows each event and status |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee1@manual.test`.<br>2. Open **My registrations**.<br>3. Click **View details** on Leadership Talk. |
| Test Data | attendee1: registered for Leadership Talk, Product Launch Gala, Alumni Homecoming; Winter Craft Market cancelled |
| Expected Result | 1. Upcoming: three REGISTERED rows with date, window and venue.<br>2. *Past, withdrawn and cancelled*: Winter Craft Market marked CANCELLED.<br>3. Details show attendee-appropriate event information. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H4 (SCRUM-142) — See the status of my registrations. H4 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M129 — H4: Waitlisted status is shown

| Item | Value |
| --- | --- |
| Test Case ID | TC-M129 |
| Test Scenario | Waitlisted status is shown |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee3@manual.test`.<br>2. Open **My registrations**. |
| Test Data | attendee3 waitlisted on Leadership Talk |
| Expected Result | Leadership Talk shows WAITLISTED with *Position 1 on the waiting list*. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H4 (SCRUM-142) — See the status of my registrations. H4 AC1. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M130 — H5: Withdraw from an event

| Item | Value |
| --- | --- |
| Test Case ID | TC-M130 |
| Test Scenario | Withdraw from an event |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee4@manual.test`.<br>2. **My registrations** → **Withdraw** on **Open Day Tours** (confirm if asked).<br>3. **Browse events**. |
| Test Data | attendee4 registered for Open Day Tours (49 left) |
| Expected Result | 1. *You have withdrawn from Open Day Tours.*; it moves out of Upcoming, marked WITHDRAWN.<br>2. Open Day Tours shows 50 places left and Register again. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H5 (SCRUM-143) — Withdraw from an event. H5 AC1–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M131 — H5: Cannot withdraw where not registered

| Item | Value |
| --- | --- |
| Test Case ID | TC-M131 |
| Test Scenario | Cannot withdraw where not registered |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee3@manual.test`.<br>2. **My registrations**; look at Product Launch Gala (not registered). |
| Test Data | - |
| Expected Result | Product Launch Gala is not listed; no Withdraw offered for events not registered. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H5 (SCRUM-143) — Withdraw from an event. H5 AC6. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M132 — H6: Join the waiting list on a full event with FCFS position

| Item | Value |
| --- | --- |
| Test Case ID | TC-M132 |
| Test Scenario | Join the waiting list on a full event with FCFS position |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee4@manual.test`.<br>2. **Browse events** → **Join waiting list** on **Leadership Talk**.<br>3. Check the card. |
| Test Data | attendee3 already waitlisted |
| Expected Result | 1. *You are on the waiting list for Leadership Talk, at position 2.*<br>2. Card shows WAITLISTED, no Register. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H6 (SCRUM-144) — Join the waiting list when an event is full. H6 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M133 — H6: Registered attendee cannot also join the waiting list

| Item | Value |
| --- | --- |
| Test Case ID | TC-M133 |
| Test Scenario | Registered attendee cannot also join the waiting list |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee1@manual.test`.<br>2. **Browse events**; look at **Leadership Talk**. |
| Test Data | attendee1 registered |
| Expected Result | Card shows REGISTERED; no Join waiting list or Register. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H6 (SCRUM-144) — Join the waiting list when an event is full. H6 AC3. Conflict. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M134 — H7: Freed place invites the first waitlisted attendee, who accepts

| Item | Value |
| --- | --- |
| Test Case ID | TC-M134 |
| Test Scenario | Freed place invites the first waitlisted attendee, who accepts |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Individuals** tab and sign in as `attendee1@manual.test`.<br>2. **My registrations** → **Withdraw** on **Leadership Talk**.<br>3. Sign in as attendee3: **Notifications**, then **My registrations**.<br>4. Click **Accept place**. |
| Test Data | attendee3 first on the waiting list |
| Expected Result | 1. attendee3 is notified and sees *Place offered until <time ≈ 48h later>* with Accept place / Decline; still WAITLISTED until accepting.<br>2. *You are registered for Leadership Talk.*; status REGISTERED. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H7 (SCRUM-145) — Be invited to take a freed place. H7 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M135 — H7: Declining the invitation removes them from the list

| Item | Value |
| --- | --- |
| Test Case ID | TC-M135 |
| Test Scenario | Declining the invitation removes them from the list |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Do steps 1–2 of the previous case. |
| Test Steps | 1. As attendee3 click **Decline**. |
| Test Data | - |
| Expected Result | attendee3 becomes WITHDRAWN for Leadership Talk. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H7 (SCRUM-145) — Be invited to take a freed place. H7 AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M136 — H8: Organiser sees registrants and counts

| Item | Value |
| --- | --- |
| Test Case ID | TC-M136 |
| Test Scenario | Organiser sees registrants and counts |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. **My events** → **View details** on **Product Launch Gala** → **Registration**. |
| Test Data | Registered: Aaron Teo, Bella Chua, Dana Yeo |
| Expected Result | List shows each name, email/contact and registration time; counts show 3 registered, 0 waitlisted, 0 withdrawn; *Only you, as the organiser of this event, can see this list.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H8 (SCRUM-146) — See who has registered for my event. H8 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M137 — H8: Other organiser and other roles cannot see the list

| Item | Value |
| --- | --- |
| Test Case ID | TC-M137 |
| Test Scenario | Other organiser and other roles cannot see the list |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser2@manual.test`.<br>2. **My events**; search for Product Launch Gala.<br>3. Sign in as attendee1; check for any registrant list. |
| Test Data | - |
| Expected Result | Organiser 2 cannot see the event; attendees have no registrant list. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story H8 (SCRUM-146) — See who has registered for my event. H8 AC3. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## I — Change requests

### TC-M138 — I1: Raise a change request; it is Pending and the coordinator is notified

| Item | Value |
| --- | --- |
| Test Case ID | TC-M138 |
| Test Scenario | Raise a change request; it is Pending and the coordinator is notified |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **Change requests** and click **New change request**.<br>3. Event to change: **Harbour Arts Showcase**; tick **Purpose**; enter the new value and reason.<br>4. Click **Send change request**.<br>5. Raise a second request on Description.<br>6. Sign in as coordinator1 → **Notifications**. |
| Test Data | 1) Purpose → Leadership retreat; reason: The agenda changed.  2) Description → Now a two-hour retreat.; reason: More detail. |
| Expected Result | 1. Both requests are listed PENDING (no limit).<br>2. Chloe Ng is notified. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story I1 (SCRUM-147) — Request a change after submitting my event. I1 AC1–AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M139 — I1: Reason is mandatory and terminal events are not offered

| Item | Value |
| --- | --- |
| Test Case ID | TC-M139 |
| Test Scenario | Reason is mandatory and terminal events are not offered |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. **Change requests** → **New change request**.<br>3. Open the *Event to change* list.<br>4. Choose Harbour Arts Showcase, tick Purpose, enter a value, leave reason empty, send. |
| Test Data | - |
| Expected Result | 1. Draft, Completed, Cancelled and Rejected events are not offered.<br>2. Sending without a reason is refused. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story I1 (SCRUM-147) — Request a change after submitting my event. I1 AC1, AC2. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M140 — I2: Review side by side and accept

| Item | Value |
| --- | --- |
| Test Case ID | TC-M140 |
| Test Scenario | Review side by side and accept |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Change requests** → **Review change** on Startup Pitch Night.<br>3. Read the comparison; tick the acknowledgement if shown; click **Accept**.<br>4. Open the event. |
| Test Data | Seeded: attendance 35 → 38, reason *Three more founders confirmed.* |
| Expected Result | 1. Current 35 and proposed 38 shown with affected arrangements.<br>2. *Change accepted and applied. The organiser has been told.*<br>3. Event shows 38; Activity has old/new, actor, time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story I2 (SCRUM-148) — Decide on a requested change. I2 AC1, AC3, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M141 — I2: Declining needs a reason the organiser sees

| Item | Value |
| --- | --- |
| Test Case ID | TC-M141 |
| Test Scenario | Declining needs a reason the organiser sees |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Raise a change on Harbour Arts Showcase as organiser1 (I1 normal case). |
| Test Steps | 1. As coordinator1, **Review change** → **Decline change** with empty reason.<br>2. Enter reason in *Reason (required to decline)*; **Decline change**.<br>3. As organiser1 open **Change requests**. |
| Test Data | Reason: The purpose is final. |
| Expected Result | 1. Empty: refused.<br>2. *Change declined. The organiser has been told why.*<br>3. Organiser sees DECLINED with the reason. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story I2 (SCRUM-148) — Decide on a requested change. I2 AC2, AC4. Normal + failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M142 — I3: Accepted significant change sends a Confirmed event back to Planning

| Item | Value |
| --- | --- |
| Test Case ID | TC-M142 |
| Test Scenario | Accepted significant change sends a Confirmed event back to Planning |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Open **Change requests** and click **New change request**.<br>3. Event to change: **Leadership Talk**; tick **Expected attendance**; enter the new value and reason.<br>4. Click **Send change request**.<br>5. As coordinator1 review it, acknowledge, **Accept**.<br>6. Open the event → **Arrangements**.<br>7. Sign in as venuestaff1 → **Notifications**. |
| Test Data | Expected attendance 30 → 35; reason: More sign-ups. |
| Expected Result | 1. Status becomes PLANNING; Bayview booking kept (APPROVED) but marked for re-request.<br>2. Venue Staff are told the booking must be re-requested. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story I3 (SCRUM-149) — Have arrangements re-requested after a significant change. I3 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M143 — I3: Reducing capacity below registrations needs acknowledgement

| Item | Value |
| --- | --- |
| Test Case ID | TC-M143 |
| Test Scenario | Reducing capacity below registrations needs acknowledgement |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Raise a change on **Product Launch Gala** setting Expected attendance (or registration capacity) to 2.<br>3. As coordinator1 open **Review change**. |
| Test Data | 3 registered; new value 2 |
| Expected Result | The review warns that capacity falls below the 3 registered, and Accept requires explicit acknowledgement. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story I3 (SCRUM-149) — Have arrangements re-requested after a significant change. I3 AC4. Boundary. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## J — Notifications

### TC-M144 — J1: Inbox shows unread count; opening marks read; read stay listed

| Item | Value |
| --- | --- |
| Test Case ID | TC-M144 |
| Test Scenario | Inbox shows unread count; opening marks read; read stay listed |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser1@manual.test`.<br>2. Note the Notifications badge.<br>3. Open **Notifications**; click **View** on the Community Choir Concert notice.<br>4. Return to **Notifications**. |
| Test Data | organiser1 has 2 unread, 1 read seeded |
| Expected Result | 1. Badge shows 2 unread.<br>2. Each notice shows message, event and time; unread ones say Unread.<br>3. After opening, it is read, the badge drops to 1, and it stays listed. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J1 (SCRUM-150) — Have one place where things needing my attention appear. J1 AC1, AC3, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M145 — J1: Users receive only notices for their events

| Item | Value |
| --- | --- |
| Test Case ID | TC-M145 |
| Test Scenario | Users receive only notices for their events |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `organiser2@manual.test`.<br>2. Open **Notifications**. |
| Test Data | - |
| Expected Result | None of Olivia Tan's events (e.g. Community Choir Concert, Youth Coding Workshop) appear. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J1 (SCRUM-150) — Have one place where things needing my attention appear. J1 AC2. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M146 — J2: Organiser is told at each step, with reasons

| Item | Value |
| --- | --- |
| Test Case ID | TC-M146 |
| Test Scenario | Organiser is told at each step, with reasons |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Do C4 normal case and C7 normal case (or C6) as coordinator1.<br>2. Sign in as organiser1 → **Notifications**. |
| Test Data | - |
| Expected Result | Notices for the clarification (with its message), the rejection (with its reason) or approval; each names the event and links to it. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J2 (SCRUM-151) — Be told how my request is progressing. J2 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M147 — J3: Coordinator told about assignment and change requests

| Item | Value |
| --- | --- |
| Test Case ID | TC-M147 |
| Test Scenario | Coordinator told about assignment and change requests |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. As lead assign **Community Choir Concert** to Chloe Ng.<br>2. As organiser1 raise a change on Harbour Arts Showcase (I1).<br>3. Sign in as coordinator1 → **Notifications**. |
| Test Data | - |
| Expected Result | Both an assignment notice and a change-request notice appear. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J3 (SCRUM-152) — Be told when work arrives for me. J3 AC1, AC2. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M148 — J4: Venue Staff told about a booking request for their venue only

| Item | Value |
| --- | --- |
| Test Case ID | TC-M148 |
| Test Scenario | Venue Staff told about a booking request for their venue only |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Do F1 normal case (Harbour Arts Showcase → Marina Grand Hall).<br>2. Sign in as venuestaff1 → **Notifications**; then venuestaff2. |
| Test Data | - |
| Expected Result | Ravi Kumar is notified naming the event; Siti Rahman is not. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J4 (SCRUM-153) — Be told when work arrives for me. J4 AC1. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M149 — J5: Technical Support told about a request and on-site support

| Item | Value |
| --- | --- |
| Test Case ID | TC-M149 |
| Test Scenario | Technical Support told about a request and on-site support |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. **Equipment requests** → **Create equipment request** on Harbour Arts Showcase; tick *On-site support needed* and enter details; submit.<br>3. Sign in as tech → **Notifications**.<br>4. As coordinator1 edit and re-save without changes; check tech's inbox again. |
| Test Data | Details: A technician for sound checks. |
| Expected Result | 1. Tech is told of the request and the on-site need.<br>2. Re-saving unchanged sends no new notice. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J5 (SCRUM-154) — Be told when work arrives for me. J5 AC1, AC2, AC7. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M150 — J6: Coordinator told of booking and equipment outcomes and can open them

| Item | Value |
| --- | --- |
| Test Case ID | TC-M150 |
| Test Scenario | Coordinator told of booking and equipment outcomes and can open them |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. As venuestaff1 approve **Startup Pitch Night**; as tech reserve both its AUDIO and VISUAL lines in **Availability check**.<br>2. Sign in as coordinator1 → **Notifications**; click **View** on the booking notice. |
| Test Data | - |
| Expected Result | 1. Notices for booking approved and equipment reserved/arranged.<br>2. View opens the booking/event with the correct date and time. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J6 (SCRUM-155) — Be told the outcome of my booking and equipment requests. J6 AC1–AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M151 — J7: Registered attendees told of registration and cancellation

| Item | Value |
| --- | --- |
| Test Case ID | TC-M151 |
| Test Scenario | Registered attendees told of registration and cancellation |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Do H3 normal case (attendee1 registers for Open Day Tours).<br>2. As coordinator1 cancel **Open Day Tours** with a reason.<br>3. Sign in as attendee1 and attendee4 → **Notifications**. |
| Test Data | Reason: Speaker unavailable. |
| Expected Result | 1. attendee1: registration confirmation and cancellation notices naming the event.<br>2. attendee4: cancellation notice; opening marks read and the badge drops. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J7 (SCRUM-156) — Be told about changes to events I registered for. J7 AC1, AC3, AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M152 — J8: Lead told when an event enters the unassigned queue

| Item | Value |
| --- | --- |
| Test Case ID | TC-M152 |
| Test Scenario | Lead told when an event enters the unassigned queue |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `lead@manual.test`.<br>2. Note the badge; open **Notifications**.<br>3. Click a notice for **Charity Fun Run Briefing**. |
| Test Data | 2 unread seeded |
| Expected Result | 1. Badge shows unread; notices name event, organiser, date, submission time.<br>2. Opening goes to the event in the Unassigned queue and marks it read. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J8 (SCRUM-191) — Be told when an event is waiting for a coordinator. J8 AC1, AC2, AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M153 — J8: Opening a notice for an already-assigned event shows its coordinator

| Item | Value |
| --- | --- |
| Test Case ID | TC-M153 |
| Test Scenario | Opening a notice for an already-assigned event shows its coordinator |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Assign **Charity Fun Run Briefing** to Daniel Koh.<br>2. Open **Notifications** and open its notice. |
| Test Data | - |
| Expected Result | The view shows its coordinator; no **Assign** button. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J8 (SCRUM-191) — Be told when an event is waiting for a coordinator. J8 AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M154 — J9: Safety Officer told when an event enters Safety Review

| Item | Value |
| --- | --- |
| Test Case ID | TC-M154 |
| Test Scenario | Safety Officer told when an event enters Safety Review |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. As coordinator1 send **Product Launch Gala** for its safety check (L1 normal case).<br>2. Sign in as safety → **Notifications**; open it. |
| Test Data | - |
| Expected Result | Unread notice names the event, date, venues and attendance; opening shows the *Record outcome* review. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J9 (SCRUM-192) — Be told when an event is waiting for its safety check. J9 AC1, AC2, AC6. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M155 — J9: Resent event says it has been checked before

| Item | Value |
| --- | --- |
| Test Case ID | TC-M155 |
| Test Scenario | Resent event says it has been checked before |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. Open **Notifications**; read the Night Market Fest notice. |
| Test Data | Seeded resend notice |
| Expected Result | It states the event has been checked before. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story J9 (SCRUM-192) — Be told when an event is waiting for its safety check. J9 AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## K — Coordinator assignment

### TC-M156 — K1: Unassigned queue, oldest first, Lead only

| Item | Value |
| --- | --- |
| Test Case ID | TC-M156 |
| Test Scenario | Unassigned queue, oldest first, Lead only |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `lead@manual.test`.<br>2. Open **Unassigned queue**.<br>3. Log out; sign in as coordinator1 and look for an Unassigned queue; open **Review queue**. |
| Test Data | Seeded unassigned: Charity Fun Run Briefing (submitted 2 days ago), Community Choir Concert (3 hrs ago) |
| Expected Result | 1. Rows show name, organiser, proposed date, *Expected N* and *Submitted … ago*; Charity Fun Run Briefing is first.<br>2. The coordinator has no Unassigned queue and neither event is in their Review queue. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K1 (SCRUM-182) — See newly submitted events waiting for a coordinator. K1 AC1–AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M157 — K1: An event leaves the queue once assigned

| Item | Value |
| --- | --- |
| Test Case ID | TC-M157 |
| Test Scenario | An event leaves the queue once assigned |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Open **Unassigned queue**.<br>2. On **Community Choir Concert** choose *Chloe Ng* and click **Assign**. |
| Test Data | Event: Community Choir Concert |
| Expected Result | *Assigned to Chloe Ng.*; the event is no longer in the queue. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K1 (SCRUM-182) — See newly submitted events waiting for a coordinator. K1 AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M158 — K2: Lead reads the summary and assigns with active-event counts

| Item | Value |
| --- | --- |
| Test Case ID | TC-M158 |
| Test Scenario | Lead reads the summary and assigns with active-event counts |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Open **Unassigned queue**; on **Charity Fun Run Briefing** click **View details**.<br>2. Open the **Assign to** list.<br>3. Choose *Daniel Koh*, click **Assign**.<br>4. Open **Oversight** and find the event.<br>5. Sign in as coordinator2 and as organiser2 and open **Notifications**. |
| Test Data | Event: Charity Fun Run Briefing (Marcus Lim) |
| Expected Result | 1. Summary shows purpose, 18:00 – 20:00, *Expected 120* and organiser Marcus Lim, with no edit controls.<br>2. Options read *Chloe Ng (N active)* and *Daniel Koh (N active)*.<br>3. *Assigned to Daniel Koh.*<br>4. Oversight shows *Coordinator: Daniel Koh* with a **Reassign** button (no Assign).<br>5. Both Daniel Koh and Marcus Lim are notified. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K2 (SCRUM-183) — Assign an event to a coordinator. K2 AC1–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M159 — K2: The initial assignment action is not offered for an assigned event

| Item | Value |
| --- | --- |
| Test Case ID | TC-M159 |
| Test Scenario | The initial assignment action is not offered for an assigned event |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Open **Unassigned queue** and look for **Tech Careers Fair**.<br>2. Open **Oversight** and find it. |
| Test Data | Seeded: Tech Careers Fair, assigned to Chloe Ng |
| Expected Result | Not in the Unassigned queue; Oversight offers only **Reassign**. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K2 (SCRUM-183) — Assign an event to a coordinator. K2 AC5. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M160 — K3: Reassign; the current coordinator is not a choice

| Item | Value |
| --- | --- |
| Test Case ID | TC-M160 |
| Test Scenario | Reassign; the current coordinator is not a choice |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Open **Oversight**; open the **Reassign to** list on **Startup Pitch Night**.<br>2. Choose *Daniel Koh* and click **Reassign**.<br>3. Sign in as coordinator1; open the event from **Assigned events** (All statuses).<br>4. Check **Notifications** for coordinator1, coordinator2 and organiser1. |
| Test Data | Event: Startup Pitch Night (Chloe Ng) |
| Expected Result | 1. Chloe Ng is not offered.<br>2. *Reassigned to Daniel Koh.*; row reads *Coordinator: Daniel Koh*.<br>3. Chloe Ng can no longer act on it (no **Edit event**, or it is no longer listed).<br>4. All three are notified. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K3 (SCRUM-184) — Reassign an event to another coordinator. K3 AC1–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M161 — K3: Completed, cancelled and rejected events cannot be reassigned

| Item | Value |
| --- | --- |
| Test Case ID | TC-M161 |
| Test Scenario | Completed, cancelled and rejected events cannot be reassigned |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Open **Oversight**; set the status filter through every option.<br>2. Look for Autumn Networking Evening, Winter Craft Market, Rooftop Fireworks Party. |
| Test Data | Seeded terminal events as named |
| Expected Result | The status filter offers only active statuses and none of the three events appears. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K3 (SCRUM-184) — Reassign an event to another coordinator. K3 AC1. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M162 — K4: Oversight of every active event, with filters and per-coordinator counts

| Item | Value |
| --- | --- |
| Test Case ID | TC-M162 |
| Test Scenario | Oversight of every active event, with filters and per-coordinator counts |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as lead@manual.test. |
| Test Steps | 1. Open **Oversight**.<br>2. Read the *Active events per coordinator* summary.<br>3. Filter by coordinator *Daniel Koh*; then status *Safety review*.<br>4. Look for any Edit control. |
| Test Data | Seeded active events for Chloe Ng and Daniel Koh |
| Expected Result | 1. Each active event shows coordinator (or *Unassigned*), status, proposed date and *Last activity*.<br>2. Summary shows Chloe Ng and Daniel Koh with their counts.<br>3. Filters narrow the list (Daniel Koh: Night Market Fest, Marathon Expo).<br>4. No edit control exists. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K4 (SCRUM-185) — Oversee all coordinators' assignments. K4 AC1–AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M163 — K5: A coordinator's lists hold only events assigned to them

| Item | Value |
| --- | --- |
| Test Case ID | TC-M163 |
| Test Scenario | A coordinator's lists hold only events assigned to them |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Review queue**, **Assigned events** (All statuses), **Venue bookings** and **Change requests**. |
| Test Data | Daniel Koh's events: Night Market Fest, Marathon Expo, Autumn Networking Evening |
| Expected Result | None of Daniel Koh's events appears on any of Chloe Ng's screens. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K5 (SCRUM-186) — Manage only the events assigned to me. K5 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M164 — K5: Outgoing coordinator is refused after reassignment

| Item | Value |
| --- | --- |
| Test Case ID | TC-M164 |
| Test Scenario | Outgoing coordinator is refused after reassignment |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`).<br>2. Signed in as coordinator1@manual.test in one browser window, with **Wellness Talk Series** open via **View request**. |
| Test Steps | 1. In a private window sign in as lead@manual.test and reassign **Wellness Talk Series** to Daniel Koh.<br>2. Back in the first window, click **Edit event** (or **Cancel event**) and save/confirm. |
| Test Data | Event: Wellness Talk Series |
| Expected Result | The action is refused with an error; the event is unchanged. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story K5 (SCRUM-186) — Manage only the events assigned to me. K5 AC2 (server-side refusal). Failure. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |


## L — Operational safety check

### TC-M165 — L1: Send a fully arranged event for its safety check

| Item | Value |
| --- | --- |
| Test Case ID | TC-M165 |
| Test Scenario | Send a fully arranged event for its safety check |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Product Launch Gala**, click **View request**.<br>4. Click **Send for safety check**.<br>5. Sign in as safety → **Safety reviews**. |
| Test Data | Both venues approved; VISUAL reserved |
| Expected Result | 1. *Event sent for its safety check.*; status SAFETY_REVIEW.<br>2. It appears in the Safety Officer's queue. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story L1 (SCRUM-187) — Send an event for its safety check. L1 AC1, AC3. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M166 — L1: Unavailable while an arrangement is missing

| Item | Value |
| --- | --- |
| Test Case ID | TC-M166 |
| Test Scenario | Unavailable while an arrangement is missing |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `coordinator1@manual.test`.<br>2. Open **Assigned events** in the sidebar (choose *All statuses* in the status filter if the event is not listed).<br>3. On **Harbour Arts Showcase**, click **View request**. |
| Test Data | No bookings |
| Expected Result | **Send for safety check** disabled; *Still outstanding: an approved venue booking.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story L1 (SCRUM-187) — Send an event for its safety check. L1 AC1, AC2. Negative. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M167 — L2: Safety queue and review show everything needed

| Item | Value |
| --- | --- |
| Test Case ID | TC-M167 |
| Test Scenario | Safety queue and review show everything needed |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. Open **Safety reviews**.<br>3. **Review safety** on **Night Market Fest**. |
| Test Data | Seeded: Community Food Fair, Night Market Fest |
| Expected Result | 1. Queue oldest first with name, date, *Venues:* and *Expected attendance:*.<br>2. Review shows 100 of 120, layout BANQUET, emergency access and restrictions, accessibility, equipment, placement/crowd notes, and *Previous safety checks*: Request changes — *Add marshals at both exits and a queue lane.* |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story L2 (SCRUM-188) — Review an event's operational safety. L2 AC1–AC4. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M168 — L3: Approve confirms the event

| Item | Value |
| --- | --- |
| Test Case ID | TC-M168 |
| Test Scenario | Approve confirms the event |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. **Review safety** on **Community Food Fair**; choose **Approve**; **Record outcome**.<br>3. Sign in as coordinator1 and organiser2 → **Notifications**. |
| Test Data | - |
| Expected Result | 1. *Safety outcome recorded: Approve.*; event CONFIRMED and leaves the queue.<br>2. Coordinator and organiser notified. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story L3 (SCRUM-189) — Record the outcome of a safety check. L3 AC1, AC3–AC5. Normal. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M169 — L3: Reject without a comment is refused; with a comment returns to Planning

| Item | Value |
| --- | --- |
| Test Case ID | TC-M169 |
| Test Scenario | Reject without a comment is refused; with a comment returns to Planning |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. **Review safety** on **Community Food Fair**; choose **Reject** with no comment; **Record outcome**.<br>3. Enter the comment; **Record outcome**. |
| Test Data | Comment: Crowd capacity too high for the exits. |
| Expected Result | 1. No comment: error, nothing recorded.<br>2. With comment: outcome recorded; status PLANNING; all arrangements flagged *Review required*. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story L3 (SCRUM-189) — Record the outcome of a safety check. L3 AC2, L4 AC2. Failure + normal. Seed check 02/11/2026: recording Reject was refused with a Firestore permission error (`equipment_requests` get as Safety Officer). |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |

### TC-M170 — L4: Request changes returns the event to Planning with flagged arrangements

| Item | Value |
| --- | --- |
| Test Case ID | TC-M170 |
| Test Scenario | Request changes returns the event to Planning with flagged arrangements |
| Pre-conditions | 1. Baseline loaded: run `npm run manual:seed` immediately before this test (app running via `npm run manual:start`). |
| Test Steps | 1. Open http://localhost:3000, choose the **Corporate** tab and sign in as `safety@manual.test`.<br>2. **Review safety** on **Community Food Fair**; choose **Request changes**; tick **Venue**; enter comment; **Record outcome**.<br>3. As coordinator1: open the event and **Notifications**.<br>4. Try **Send for safety check**. |
| Test Data | Comment: Fire exit at the rear is obstructed. |
| Expected Result | 1. Status PLANNING; only the venue booking is *Review required*; equipment unchanged.<br>2. Coordinator notified with the comment; Venue Staff notified.<br>3. Cannot resend until the flagged booking is reviewed. |
| Actual Result |  |
| Pass/Fail/Not Executed/Blocked |  |
| Remarks | Story L4 (SCRUM-190) — Return an event to planning after a safety concern. L4 AC1–AC5. Seed check 02/11/2026: Request changes was refused with a Firestore permission error, as for L3 Reject. |
| Created By* | Christy G. |
| Date of Creation* | 02/11/2026 |
| Executed By* |  |
| Date of Execution* |  |
