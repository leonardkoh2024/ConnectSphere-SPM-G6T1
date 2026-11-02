// Epic H — Attendee registration: opening it, registering, withdrawing, the waiting list.
import { test, expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { story } from "./story.js";
import { openScreen, record, toast } from "../helpers/app.js";
import {
  as, newRegistrationEvent, newConfirmedEvent, newApprovedEvent, openAsCoordinator, approveBooking, browseEvent, register,
  openRegistration
} from "../helpers/flows.js";

// How the attendee screens write a date: "2 May 2029".
const shownDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const myRegistration =(page, event) => page.locator("main article").filter({ has: page.getByRole("heading", { name: event.name, exact: true }) });

async function openOrganiserRegistration(page, event) {
  await as(page, "organiser");
  await openScreen(page, "My events");
  await record(page, event.name).getByRole("button", { name: "View details" }).click();
  await page.getByRole("tab", { name: "Registration" }).click();
}

// Each story here first takes an event all the way to Confirmed.
test.describe.configure({ timeout: 240_000 });

test.describe(...story("H1", "Open registration for my event"), () => {
  test("the organiser sets capacity and window, within the venue's capacity", async ({ page }) => {
    // 300 expected overall, of whom 180 are booked into the 200-seat Grand Hall.
    const event = await newApprovedEvent(page, { attendance: "300", registration: openRegistration(100) });
    await openAsCoordinator(page, event);
    await page.getByRole("button", { name: "Find venues" }).click();
    // Search hides the hall (it seats fewer than 300), so pick it from the booking form's venue list.
    await page.locator("article").filter({ has: page.getByRole("heading", { name: "E2E Riverside Pavilion", exact: true }) })
      .getByRole("button", { name: "Book venue" }).click();
    await page.getByRole("radio", { name: "E2E Grand Hall" }).check();
    await page.getByLabel("Expected attendance for this venue").fill("180");
    await page.getByRole("button", { name: "Request this venue" }).click();
    await expect(page.getByText("Booking request sent to Venue Staff.")).toBeVisible();
    await approveBooking(page, event);
    await openOrganiserRegistration(page, event);
    const panel = page.getByRole("tabpanel", { name: "Registration" });

    await test.step("AC3: a capacity above the booked venue's 200 seats is refused", async () => {
      await panel.getByLabel("Registration capacity").fill("250");
      await panel.getByRole("button", { name: "Save registration settings" }).click();
      await expect(panel.getByRole("alert").first()).toBeVisible();
    });

    await test.step("AC1 + AC2: a capacity within it is saved", async () => {
      await panel.getByLabel("Registration capacity").fill("150");
      await panel.getByRole("button", { name: "Save registration settings" }).click();
      await expect(toast(page).getByText("Registration settings saved.")).toBeVisible();
    });
  });
});

test.describe(...story("H2", "Find events I can register for"), () => {
  test("only events open for registration are listed, with their details", async ({ page }) => {
    const open = await newRegistrationEvent(page, 40, { description: "Hands-on product workshop." });
    const card = await browseEvent(page, "attendee", open);

    await test.step("AC1 + AC2: the open event shows name, description, date, venue and places left", async () => {
      await expect(card).toContainText("Hands-on product workshop.");
      await expect(card).toContainText(shownDate(open.date));
      await expect(card).toContainText("E2E Grand Hall");
      await expect(card).toContainText("40");
    });

    await test.step("AC3: a confirmed event without registration is not listed", async () => {
      const closed = await newConfirmedEvent(page);
      const notListed = await browseEvent(page, "attendee", closed);
      await expect(notListed).toHaveCount(0);
    });
  });
});

test.describe(...story("H3", "Register for an event"), () => {
  test("registering takes a place, can't be repeated, and a full event says so", async ({ page }) => {
    const event = await newRegistrationEvent(page, 1);

    await test.step("AC1 + AC2 + AC3: the attendee registers and is told so", async () => {
      await register(page, "attendee", event);
    });

    await test.step("AC4 + AC8: the card now shows the registration and no second Register", async () => {
      const card = await browseEvent(page, "attendee", event);
      await expect(card).toContainText("Registered");
      await expect(card.getByRole("button", { name: "Register" })).toHaveCount(0);
      await expect(card.getByRole("button", { name: "View details" })).toBeVisible();
    });

    await test.step("AC5 + AC7: the one place is taken, so the next attendee sees it is full", async () => {
      const card = await browseEvent(page, "attendee2", event);
      await expect(card).toContainText("Full");
      await expect(card.getByRole("button", { name: "Register" })).toHaveCount(0);
    });
  });
});

test.describe(...story("H4", "See the status of my registrations"), () => {
  test("My registrations lists each event with its status", async ({ page }) => {
    const event = await newRegistrationEvent(page, 10);
    await register(page, "attendee", event);

    await test.step("AC1: the registration is listed with date and status", async () => {
      await openScreen(page, "My registrations");
      await expect(myRegistration(page, event)).toContainText(shownDate(event.date));
      await expect(myRegistration(page, event)).toContainText("Registered");
    });

    await test.step("AC2: opening it shows the event information", async () => {
      await myRegistration(page, event).getByRole("button", { name: "View details" }).click();
      await expect(page.locator("main")).toContainText("E2E Grand Hall");
    });
  });
});

test.describe(...story("H5", "Withdraw from an event"), () => {
  test("withdrawing frees the place and moves the event out of upcoming", async ({ page }) => {
    const event = await newRegistrationEvent(page, 1);
    await register(page, "attendee", event);

    await test.step("AC1 + AC2 + AC3: withdraw from My registrations and see it confirmed", async () => {
      await openScreen(page, "My registrations");
      await myRegistration(page, event).getByRole("button", { name: "Withdraw" }).click();
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) await dialog.getByRole("button", { name: /withdraw/i }).last().click();
      await expect(toast(page).getByText(/withdr/i)).toBeVisible();
    });

    await test.step("AC5: it is no longer among upcoming registrations", async () => {
      await expect(page.getByRole("region", { name: "Upcoming" }).or(page.locator("main")).first()).toContainText(/Withdrawn|no upcoming/i);
    });

    await test.step("AC4: the place is free for another attendee", async () => {
      await register(page, "attendee2", event);
    });
  });
});

test.describe(...story("H6", "Join the waiting list when an event is full"), () => {
  test("a full event offers the waiting list with a position", async ({ page }) => {
    const event = await newRegistrationEvent(page, 1);
    await register(page, "attendee", event);

    await test.step("AC1 + AC2: the next attendee joins and is told their position", async () => {
      const card = await browseEvent(page, "attendee2", event);
      await card.getByRole("button", { name: "Join waiting list" }).click();
      await expect(toast(page).getByText(`You are on the waiting list for ${event.name}, at position 1.`)).toBeVisible();
    });

    await test.step("a third attendee is second in line", async () => {
      const card = await browseEvent(page, "attendee3", event);
      await card.getByRole("button", { name: "Join waiting list" }).click();
      await expect(toast(page).getByText(`You are on the waiting list for ${event.name}, at position 2.`)).toBeVisible();
    });

    await test.step("AC3: a waitlisted attendee cannot also register", async () => {
      const card = await browseEvent(page, "attendee2", event);
      await expect(card).toContainText("Waitlisted");
      await expect(card.getByRole("button", { name: "Register" })).toHaveCount(0);
    });
  });
});

test.describe(...story("H7", "Be invited to take a freed place"), () => {
  test("when a place frees up, the first on the list is invited and must accept", async ({ page }) => {
    const event = await newRegistrationEvent(page, 1);
    await register(page, "attendee", event);
    const card = await browseEvent(page, "attendee2", event);
    await card.getByRole("button", { name: "Join waiting list" }).click();
    await expect(toast(page).getByText(/waiting list/)).toBeVisible();

    await test.step("the registered attendee withdraws", async () => {
      await as(page, "attendee");
      await openScreen(page, "My registrations");
      await myRegistration(page, event).getByRole("button", { name: "Withdraw" }).click();
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) await dialog.getByRole("button", { name: /withdraw/i }).last().click();
    });

    await test.step("AC1: the first waitlisted attendee is notified and offered the place", async () => {
      await as(page, "attendee2");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
      await openScreen(page, "My registrations");
      await expect(myRegistration(page, event)).toContainText("Place offered until");
    });

    await test.step("AC2: they are not registered until they accept", async () => {
      await myRegistration(page, event).getByRole("button", { name: "Accept place" }).click();
      await expect(toast(page).getByText(`You are registered for ${event.name}.`)).toBeVisible();
      await expect(myRegistration(page, event)).toContainText("Registered");
    });
  });
});

test.describe(...story("H8", "See who has registered for my event"), () => {
  test("the organiser sees names, contact details and counts", async ({ page }) => {
    const event = await newRegistrationEvent(page, 10);
    await register(page, "attendee", event);
    await register(page, "attendee2", event);

    await test.step("AC1 + AC2: the list shows each attendee and the counts", async () => {
      await openOrganiserRegistration(page, event);
      const list = page.getByRole("region", { name: "Registered attendees" }).or(page.getByRole("table", { name: "Registered attendees" })).first();
      await expect(list).toContainText(USERS.attendee.name);
      await expect(list).toContainText(USERS.attendee2.email);
      await expect(page.getByLabel("Registration counts")).toContainText("2");
      await expect(page.getByText("Only you, as the organiser of this event, can see this list.")).toBeVisible();
    });

    await test.step("AC3: another organiser cannot see the event at all", async () => {
      await as(page, "otherOrganiser");
      await openScreen(page, "My events");
      await expect(record(page, event.name)).toHaveCount(0);
    });
  });
});
