// Shared steps for the story specs: moving around the workspace and creating the
// records a story needs, through the same screens a user would use.
import { expect } from "@playwright/test";

export { logInAs } from "./login.js";

let counter = 0;

// Every test makes its own records, named so they never collide with another
// test's in the shared emulator database.
export const uniqueName = (prefix) => `${prefix} ${Date.now().toString(36)}${(counter++).toString(36)}`;

// A date `days` from today as YYYY-MM-DD, the value a date input takes.
export const isoDate = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA");
};

// A future date no other test's event is likely to share, so venue bookings
// made by different tests never clash. Stories about clashes pass a date.
export const freeDate = () => isoDate(30 + (Math.floor(Date.now() / 1500) % 900));

export const sidebar =(page) => page.getByRole("navigation", { name: "Your screens" });

// A sidebar item by its screen name. Matched on its title because a badge
// (unread count, clash count) adds to the button's accessible name.
export const screenButton = (page, name) => sidebar(page).getByTitle(name, { exact: true });

export async function openScreen(page, name) {
  await screenButton(page, name).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

export async function logOut(page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("tab", { name: /Corporate/ })).toBeVisible();
}

export const toast = (page) => page.locator(".cs-toasts");

// The organiser's form for a new request, opened from the header button.
export async function openNewRequest(page) {
  await openScreen(page, "My events");
  await page.locator("header.cs-panel-head").getByRole("button", { name: "Create new event request" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New event request" })).toBeVisible();
}

const field = (page, name) => page.locator("label.cs-field").filter({ has: page.locator(".cs-field-name", { hasText: name }) }).locator("input, textarea, select").first();
export { field };

const answer = (page, question, value) => page.locator("fieldset.cs-yesno").filter({ hasText: question }).getByLabel(value, { exact: true }).check();
export { answer };

// Fills every section of the request. Anything in `overrides` replaces the
// default; pass `null` for a field to leave it empty.
export async function fillEventRequest(page, overrides = {}) {
  const values = {
    name: uniqueName("E2E event"),
    purpose: "Team offsite",
    description: "An event created by the end-to-end tests.",
    date: freeDate(),
    start: "10:00",
    end: "12:00",
    attendance: "40",
    location: "CENTRAL",
    layout: "THEATRE",
    facilities: [],
    equipment: [],
    registration: null,
    accessibility: [],
    ...overrides
  };
  const fill = async (name, value) => { if (value != null) await field(page, name).fill(value); };
  await fill("Event name", values.name);
  await fill("Purpose", values.purpose);
  await fill("Expected attendance", values.attendance);
  await fill("Description", values.description);
  await fill("Proposed date", values.date);
  await fill("Start time", values.start);
  await fill("End time", values.end);
  if (values.location) await field(page, "Preferred location or area").selectOption(values.location);
  if (values.layout) await field(page, "Required layout").selectOption(values.layout);

  if (values.facilities) {
    await answer(page, "Does your event need facilities", values.facilities.length ? "Yes" : "No");
    for (const item of values.facilities) await page.getByLabel(item.replaceAll("_", " "), { exact: true }).check();
  }
  if (values.equipment) {
    await answer(page, "Does your event need equipment", values.equipment.length ? "Yes" : "No");
    for (const [index, line] of values.equipment.entries()) {
      if (index > 0) await page.getByRole("button", { name: "Add equipment line" }).click();
      await page.getByLabel(`Equipment type ${index + 1}`).selectOption(line.type);
      await page.getByLabel(`Quantity ${index + 1}`).fill(String(line.quantity));
      if (line.note) await page.getByLabel(`Technical note ${index + 1}`).fill(line.note);
    }
  }
  if (values.registration) {
    const r = values.registration;
    await answer(page, "Do attendees need to register", "Yes");
    await field(page, "Registration capacity").fill(String(r.capacity));
    await field(page, "Registration open date").fill(r.openDate);
    await field(page, "Registration open time").fill(r.openTime);
    await field(page, "Registration close date").fill(r.closeDate);
    await field(page, "Registration close time").fill(r.closeTime);
  }
  if (values.accessibility) {
    await answer(page, "Does your event have accessibility needs", values.accessibility.length ? "Yes" : "No");
    for (const item of values.accessibility) await page.getByLabel(item.replaceAll("_", " "), { exact: true }).check();
  }
  return values;
}

// Creates and submits a complete request as the signed-in organiser. Returns
// the event's name and the reference number the confirmation shows.
export async function submitEventRequest(page, overrides = {}) {
  await openNewRequest(page);
  const values = await fillEventRequest(page, overrides);
  await page.getByRole("button", { name: "Submit request" }).click();
  const confirmation = toast(page).getByText(/Event request .+ submitted for coordinator review/);
  // Submitting writes the event, its requirements and the Lead's notices; on the
  // emulator, with a busy database, that can take well over the usual wait.
  await expect(confirmation).toBeVisible({ timeout: 30_000 });
  const referenceNo = (await confirmation.textContent()).match(/Event request (\S+) submitted/)[1];
  return { ...values, referenceNo };
}

// One event's card in a record list.
export const record = (page, text) => page.locator(".cs-record-list > *").filter({ hasText: text });
