// Moving an event along its workflow through the real screens, one role at a
// time. A story that needs an event in a later state calls these to get it
// there, then carries out its own step on top.
import { expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { logInAs, logOut, openScreen, record, submitEventRequest, toast, isoDate } from "./app.js";

// Switches the page to another user, signing the current one out first.
export async function as(page, key) {
  if (await page.getByRole("button", { name: "Log out" }).count()) await logOut(page);
  await logInAs(page, USERS[key]);
}

// Organiser: a complete request, submitted. Leaves the organiser signed in.
export async function newSubmittedEvent(page, overrides = {}) {
  await as(page, "organiser");
  return submitEventRequest(page, overrides);
}

// Lead: assigns the event from the Unassigned queue.
export async function assignCoordinator(page, event, coordinatorKey = "coordinator") {
  await as(page, "lead");
  await openScreen(page, "Unassigned queue");
  const row = record(page, event.name);
  await row.getByRole("combobox").selectOption(USERS[coordinatorKey].uid);
  await row.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(toast(page).getByText(`Assigned to ${USERS[coordinatorKey].name}.`)).toBeVisible();
}

// Coordinator: opens the event from Review queue (Submitted/Under Review) or
// Assigned events (everything else).
export async function openAsCoordinator(page, event, { screen = "Assigned events", coordinatorKey = "coordinator" } = {}) {
  await as(page, coordinatorKey);
  await openScreen(page, screen);
  // Assigned events lists active events by default; a cancelled or completed
  // one is under "All statuses".
  const filter = page.getByLabel("Filter by status");
  await expect(record(page, event.name).or(page.locator(".cs-record-list, .cs-empty").first()).first()).toBeVisible();
  if (!(await record(page, event.name).count()) && (await filter.count())) await filter.selectOption({ label: "All statuses" });
  await record(page, event.name).getByRole("button", { name: "View request" }).click();
  await expect(page.locator(".cs-review-heading h2", { hasText: event.name })).toBeVisible();
}

// Coordinator: one of the reason/message action boxes (approve, reject,
// clarify, cancel), filled and confirmed.
export async function decide(page, action, message) {
  const buttons = {
    approve: ["Approve", "Approve event", "Event request approved."],
    reject: ["Reject request", "Reject event", "Event request rejected."],
    clarify: ["Request clarification", "Send request", "Clarification request sent."]
  }[action];
  if (action === "clarify") await page.getByRole("tab", { name: /Clarifications/ }).click();
  await page.getByRole("button", { name: buttons[0], exact: true }).click();
  await page.locator(".cs-action-box textarea").fill(message);
  await page.getByRole("button", { name: buttons[1], exact: true }).click();
  await expect(toast(page).getByText(buttons[2])).toBeVisible({ timeout: 30_000 });
}

// Submitted → assigned → reviewed → Approved. Leaves the coordinator on the event.
export async function newApprovedEvent(page, overrides = {}) {
  const event = await newSubmittedEvent(page, overrides);
  await assignCoordinator(page, event);
  await openAsCoordinator(page, event, { screen: "Review queue" });
  await decide(page, "approve", "Everything we need is here.");
  return event;
}

// Coordinator, on the event: Find venues → Book venue → Request this venue.
// `venueName` is a venue's display name from e2e/catalogue.js.
export async function requestVenue(page, event, venueName) {
  await openAsCoordinator(page, event);
  await page.getByRole("button", { name: "Find venues" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Venue catalogue" })).toBeVisible();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: venueName, exact: true }) })
    .getByRole("button", { name: "Book venue" }).click();
  await expect(page.getByRole("radio", { name: venueName })).toBeChecked();
  await page.getByRole("button", { name: "Request this venue" }).click();
  await expect(page.getByText("Booking request sent to Venue Staff.")).toBeVisible();
}

// Venue Staff: the event's request in their Booking requests queue.
export const bookingRow = (page, event) => page.getByRole("region", { name: "Venue booking requests" })
  .locator("article").filter({ has: page.getByRole("heading", { name: event.name, exact: true }) });

export async function openBookingQueue(page, staffKey = "venueStaff") {
  await as(page, staffKey);
  await openScreen(page, "Booking requests");
  await expect(page.getByRole("region", { name: "Venue booking requests" })).toBeVisible();
}

// Approves the event's pending request (an event with several venues has one row
// per booking, so the row is picked by its Approve button, then found again by venue).
export async function approveBooking(page, event, staffKey = "venueStaff") {
  await openBookingQueue(page, staffKey);
  const pending = bookingRow(page, event).filter({ has: page.getByRole("button", { name: "Approve" }) }).first();
  const venue = (await pending.locator("p").first().textContent()).trim();
  await pending.getByRole("button", { name: "Approve" }).click();
  await expect(bookingRow(page, event).filter({ hasText: venue }).first()).toContainText("Approved", { timeout: 20_000 });
}

// Coordinator: sends a fully arranged event for its safety check.
export async function sendForSafetyCheck(page, event) {
  await openAsCoordinator(page, event);
  await page.getByRole("button", { name: "Send for safety check" }).click();
  await expect(toast(page).getByText("Event sent for its safety check.")).toBeVisible();
}

// Safety Officer: opens the event's review and records an outcome.
export async function openSafetyReview(page, event) {
  await as(page, "safetyOfficer");
  await openScreen(page, "Safety reviews");
  await page.locator("article").filter({ has: page.getByRole("heading", { name: event.name, exact: true }) })
    .getByRole("button", { name: "Review safety" }).click();
  await expect(page.getByRole("region", { name: "Record outcome" })).toBeVisible();
}

// `outcome` is the radio label: Approve, Reject or Request changes. `review` lists
// the arrangements to flag on Request changes ("Venue", "Technical").
export async function recordSafetyOutcome(page, outcome, comment, { review = [], expectRecorded = true } = {}) {
  const box = page.getByRole("region", { name: "Record outcome" });
  await box.getByLabel(outcome, { exact: true }).check();
  for (const item of review) await box.getByRole("checkbox", { name: item, exact: true }).check();
  if (comment) await box.getByLabel("Comment").fill(comment);
  await box.getByRole("button", { name: "Record outcome" }).click();
  if (expectRecorded) await expect(toast(page).getByText(`Safety outcome recorded: ${outcome}.`)).toBeVisible();
}

// Approved event with an approved booking at `venueName` — ready for its safety check.
export async function newPlannedEvent(page, overrides = {}, venueName = "E2E Grand Hall") {
  const event = await newApprovedEvent(page, overrides);
  await requestVenue(page, event, venueName);
  await approveBooking(page, event);
  return event;
}

// Coordinator: sends the equipment request, pre-filled from the organiser's lines.
export async function requestEquipment(page, event, { edit } = {}) {
  await as(page, "coordinator");
  await openScreen(page, "Equipment requests");
  const row = page.locator("article").filter({ has: page.getByRole("heading", { name: event.name, exact: true }) });
  await row.getByRole("button", { name: "Create equipment request" }).click();
  const editor = page.getByRole("region", { name: "Equipment request editor" });
  await expect(editor).toBeVisible();
  if (edit) await edit(editor);
  await editor.getByRole("button", { name: "Submit equipment request" }).click();
  await expect(row).toContainText("Pending");
}

// Technical Support: the event's panel on the Availability check screen.
export const availabilityPanel = (page, event) => page.getByRole("region", { name: `${event.name} equipment availability` });

export async function openAvailabilityCheck(page, event) {
  await as(page, "techSupport");
  await openScreen(page, "Availability check");
  await availabilityPanel(page, event).getByRole("button", { name: /Check availability|Refresh availability/ }).click();
}

// Once every line is settled the request is no longer Pending and its panel
// leaves the screen, so success is either the "Reserved" line or the panel going.
export async function panelSettled(page, event, text) {
  const panel = availabilityPanel(page, event);
  await expect.poll(async () => (await panel.count()) === 0 || (await panel.getByText(text).count()) > 0, { timeout: 10_000 }).toBe(true);
}

export async function reserveEquipment(page, event) {
  await openAvailabilityCheck(page, event);
  await availabilityPanel(page, event).getByRole("button", { name: "Reserve equipment" }).first().click();
  await panelSettled(page, event, "Reserved for this event.");
}

// A registration window that is open now and closes well before the event.
export const openRegistration = (capacity) => ({
  capacity, openDate: isoDate(-1), openTime: "09:00", closeDate: isoDate(20), closeTime: "18:00"
});

// A Confirmed event open for registration, with `capacity` places.
export async function newRegistrationEvent(page, capacity = 50, overrides = {}) {
  return newConfirmedEvent(page, { attendance: "100", registration: openRegistration(capacity), ...overrides });
}

// Attendee: the event's card on Browse events.
export async function browseEvent(page, key, event) {
  await as(page, key);
  await openScreen(page, "Browse events");
  return page.getByLabel("Events open for registration").locator("article")
    .filter({ has: page.getByRole("heading", { name: event.name, exact: true }) });
}

export async function register(page, key, event) {
  const card = await browseEvent(page, key, event);
  await card.getByRole("button", { name: "Register" }).click();
  await expect(toast(page).getByText(`You are registered for ${event.name}.`)).toBeVisible();
  return card;
}

// All the way to Confirmed: booked, sent for the safety check, approved.
export async function newConfirmedEvent(page, overrides = {}, venueName = "E2E Grand Hall") {
  const event = await newPlannedEvent(page, overrides, venueName);
  await sendForSafetyCheck(page, event);
  await openSafetyReview(page, event);
  await recordSafetyOutcome(page, "Approve", "Exits and capacity checked.");
  await expect(page.locator("main")).not.toContainText(event.name, { timeout: 10_000 }).catch(() => {});
  return event;
}
