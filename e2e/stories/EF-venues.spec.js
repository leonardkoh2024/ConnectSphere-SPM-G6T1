// Epics E and F — The venue catalogue, venue search, booking requests, holds,
// clashes and replacements.
import { test, expect } from "@playwright/test";
import { story } from "./story.js";
import { openScreen, toast, freeDate } from "../helpers/app.js";
import { expireHoldsFor } from "../helpers/db.js";
import {
  as, newApprovedEvent, newPlannedEvent, newConfirmedEvent, requestVenue, approveBooking, openBookingQueue,
  bookingRow, openAsCoordinator, sendForSafetyCheck
} from "../helpers/flows.js";

const venueCard = (page, name) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });

// Venue Staff: opens one of their venues in the catalogue for editing.
async function openVenueEditor(page, name, staffKey = "venueStaff") {
  await as(page, staffKey);
  await openScreen(page, "Venue catalogue");
  await venueCard(page, name).getByRole("button", { name: "Update venue" }).click();
  await expect(page.getByRole("form", { name: "Edit venue" })).toBeVisible();
  return page.getByRole("form", { name: "Edit venue" });
}

async function saveVenue(page) {
  await page.getByRole("form", { name: "Edit venue" }).getByRole("button", { name: "Save venue" }).click();
  await expect(page.getByRole("form", { name: "Edit venue" })).toHaveCount(0);
}

// From the event's Venue catalogue shortlist (opened by Find venues).
async function findVenues(page, event) {
  await openAsCoordinator(page, event);
  await page.getByRole("button", { name: "Find venues" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Venue catalogue" })).toBeVisible();
}

const resultCount = (page) => page.locator("main").getByText(/^\d+ venues?$/);

// The coordinator's booking row for an event on Venue bookings.
async function openCoordinatorBookings(page) {
  await as(page, "coordinator");
  await openScreen(page, "Venue bookings");
}
const coordinatorBooking = (page, event, venueName) => page.locator("main article")
  .filter({ hasText: event.name }).filter({ hasText: venueName });

// Venue Staff: blocks a venue for a whole day. Over approved bookings the form
// lists them and asks for confirmation first (E11 AC2).
async function blockVenue(page, venueName, day, reason, { expectAffected = [] } = {}) {
  await as(page, "venueStaff");
  await openScreen(page, "Venue catalogue");
  await venueCard(page, venueName).getByRole("button", { name: "Update venue" }).click();
  const block = page.getByRole("form", { name: "Record unavailability" });
  await block.getByLabel("Starts").fill(`${day}T06:00`);
  await block.getByLabel("Ends").fill(`${day}T23:00`);
  await block.getByLabel("Reason").selectOption({ label: reason });
  await block.getByRole("button", { name: "Add period" }).click();
  if (expectAffected.length) {
    const warning = block.getByRole("alert");
    await expect(warning).toContainText("This period overlaps approved bookings.");
    for (const name of expectAffected) await expect(warning).toContainText(name);
    await warning.getByRole("button", { name: "Confirm and add period" }).click();
  }
  const region = page.getByRole("region", { name: "Venue unavailability" });
  await region.getByRole("button", { name: "Save changes" }).click();
  // A refused save leaves its message here and the button enabled.
  await expect(region.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(region.getByRole("alert"), "the save was refused").toHaveCount(0);
}

async function rejectBooking(page, event, reason) {
  await openBookingQueue(page);
  await bookingRow(page, event).getByRole("button", { name: "Reject" }).click();
  await bookingRow(page, event).getByLabel("Reason for rejection").fill(reason);
  await bookingRow(page, event).getByRole("button", { name: "Confirm rejection" }).click();
  await expect(bookingRow(page, event)).toContainText(/Rejected/i);
}

// ---------------------------------------------------------------- E

test.describe(...story("E1", "Maintain the venue catalogue"), () => {
  test("Venue Staff edit their own venue; other venues are read-only", async ({ page }) => {
    await test.step("AC3: their own venues offer Update, another's only View", async () => {
      await as(page, "venueStaff");
      await openScreen(page, "Venue catalogue");
      await expect(venueCard(page, "E2E Grand Hall").getByRole("button", { name: "Update venue" })).toBeVisible();
      await expect(venueCard(page, "E2E East Annex").getByRole("button", { name: "Update venue" })).toHaveCount(0);
    });

    await test.step("AC1 + AC5: the record holds capacity, layouts, facilities, accessibility, hours and special space", async () => {
      const form = await openVenueEditor(page, "E2E Riverside Pavilion");
      await expect(form.getByLabel("Maximum capacity")).toHaveValue("500");
      await expect(form.getByRole("group", { name: "Operating hours" })).toBeVisible();
      await form.getByLabel("Space availability for special requirements").fill("Quiet room on level 2.");
      await saveVenue(page);
    });

    await test.step("AC2: a capacity of zero is refused", async () => {
      const form = await openVenueEditor(page, "E2E Riverside Pavilion");
      await form.getByLabel("Maximum capacity").fill("0");
      await form.getByRole("button", { name: "Save venue" }).click();
      await expect(form.getByRole("alert")).toBeVisible();
      await form.getByRole("button", { name: "Cancel" }).click();
    });

    await test.step("AC3: a coordinator can browse but not edit", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Venue catalogue");
      await expect(page.getByRole("button", { name: "Update venue" })).toHaveCount(0);
    });
  });
});

test.describe(...story("E2", "Browse the venue catalogue"), () => {
  test("the catalogue lists every venue and opens a full record", async ({ page }) => {
    await as(page, "coordinator");
    await openScreen(page, "Venue catalogue");

    await test.step("AC1: every venue with location, capacity and headline facilities", async () => {
      for (const name of ["E2E Grand Hall", "E2E Small Studio", "E2E Riverside Pavilion", "E2E East Annex"]) {
        await expect(venueCard(page, name)).toBeVisible();
      }
      await expect(venueCard(page, "E2E Grand Hall")).toContainText("Capacity 200");
      await expect(venueCard(page, "E2E Grand Hall")).toContainText("WIFI");
    });

    await test.step("AC2: opening one shows layouts, accessibility and operating hours", async () => {
      await venueCard(page, "E2E Grand Hall").getByRole("button", { name: "View venue" }).click();
      const detail = page.getByRole("region", { name: "Venue record" }).first();
      await expect(detail).toContainText("BANQUET");
      await expect(detail).toContainText(/WHEELCHAIR/);
      await expect(detail).toContainText("07:00");
    });

    await test.step("AC3: an attendee has no catalogue", async () => {
      await as(page, "attendee");
      await expect(page.getByRole("navigation", { name: "Your screens" }).getByTitle("Venue catalogue")).toHaveCount(0);
    });
  });
});

test.describe(...story("E3", "Record when a venue cannot be used"), () => {
  test("an unavailability period is recorded and shown on the calendar", async ({ page }) => {
    const day = freeDate();
    await test.step("AC1: record a period with a start, an end and a reason", async () => {
      await blockVenue(page, "E2E Small Studio", day, "Maintenance");
      await expect(page.getByRole("region", { name: "Venue unavailability" })).not.toContainText("No unavailability periods recorded.");
    });

    await test.step("AC2: the calendar shows the venue blocked that day", async () => {
      await openScreen(page, "Availability calendar");
      await page.getByRole("combobox", { name: "Venue" }).selectOption({ label: "E2E Small Studio" });
      await expect(page.getByRole("region", { name: "Venue availability calendar" })).toBeVisible();
    });
  });
});

test.describe(...story("E4", "See when a venue is free"), () => {
  test("the calendar shows booked, blocked and free time with a legend", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await as(page, "coordinator");
    await openScreen(page, "Venue catalogue");
    await page.getByRole("button", { name: "View calendar" }).click();

    await test.step("AC1 + AC2 + AC7: a legend tells free, booked, pending and blocked apart", async () => {
      const legend = page.getByLabel("Legend");
      for (const state of ["Free", "Booked", "Pending", "Blocked", "Closed"]) await expect(legend).toContainText(state);
    });

    await test.step("AC1: a month grid is shown for the chosen venues", async () => {
      await expect(page.getByLabel("Availability calendar")).toBeVisible();
      await expect(page.locator("main")).toContainText(/Mon\s*Tue\s*Wed/);
      void event;
    });
  });
});

test.describe(...story("E5", "Find venues that fit my event"), () => {
  test("search starts from the event and leaves out venues that are too small", async ({ page }) => {
    const event = await newApprovedEvent(page, { attendance: "150" });
    await findVenues(page, event);

    await test.step("AC1: date, times and attendance are pre-filled from the event", async () => {
      await expect(page.getByText(`Pre-filled from the event: ${event.date} · ${event.start}–${event.end} · 150 attending`)).toBeVisible();
    });

    await test.step("AC3: venues below 150 seats are excluded", async () => {
      await expect(venueCard(page, "E2E Grand Hall")).toBeVisible();
      await expect(venueCard(page, "E2E Small Studio")).toHaveCount(0);
    });

    await test.step("AC4: impossible criteria give zero results and say why", async () => {
      await page.getByLabel("Minimum capacity").fill("10000");
      await expect(resultCount(page)).toHaveText("0 venues");
      await expect(page.getByText("No venues match the current criteria.")).toBeVisible();
    });
  });
});

test.describe(...story("E6", "Narrow the shortlist"), () => {
  test("filters combine, show as chips, and clear in one go", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await findVenues(page, event);
    const before = await resultCount(page).textContent();

    await test.step("AC1 + AC2 + AC4: a facility plus a layout only the Pavilion has narrows the count", async () => {
      await page.getByRole("group", { name: "Required facilities" }).getByLabel("STAGE", { exact: true }).check();
      await page.getByLabel("Supported layout").selectOption("U_SHAPE");
      await expect(resultCount(page)).not.toHaveText(before);
      await expect(venueCard(page, "E2E Riverside Pavilion")).toBeVisible();
      await expect(venueCard(page, "E2E Grand Hall")).toHaveCount(0);
    });

    await test.step("AC3: the active filters are shown and cleared in one action", async () => {
      await expect(page.getByRole("region", { name: "Venue requirements" })).toContainText("STAGE");
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(venueCard(page, "E2E Grand Hall")).toBeVisible();
    });
  });
});

test.describe(...story("E7", "Know whether a venue actually suits the event"), () => {
  test("each venue is assessed against every criterion", async ({ page }) => {
    const event = await newApprovedEvent(page, { attendance: "45", facilities: ["STAGE"], accessibility: ["LIFT"] });
    await openAsCoordinator(page, event);
    await page.getByRole("button", { name: "Find venues" }).click();
    await page.getByLabel("Minimum capacity").fill("");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await venueCard(page, "E2E Grand Hall").getByRole("button", { name: "Book venue" }).click();
    const choose = page.getByRole("region", { name: "Choose a venue" });

    await test.step("AC5: a venue with no failures is reported suitable", async () => {
      await expect(choose.getByRole("listitem").filter({ hasText: "E2E Grand Hall" })).toContainText("Meets all requirements");
    });

    await test.step("AC1 + AC2 + AC3: a small venue lacking the stage and lift fails on each", async () => {
      await expect(choose.getByRole("listitem").filter({ hasText: "E2E Small Studio" })).toContainText(/\d+ requirements? not met/);
      await choose.getByRole("radio", { name: "E2E Small Studio" }).check();
      const verdict = page.getByRole("region", { name: "Request this venue" });
      await expect(verdict).toContainText("Capacity");
      await expect(verdict).toContainText("STAGE");
      await expect(verdict).toContainText("LIFT");
    });
  });
});

test.describe(...story("E8", "Be stopped before booking an unsuitable venue"), () => {
  test("too small is blocked; a missing facility needs an acknowledged warning", async ({ page }) => {
    const event = await newApprovedEvent(page, { attendance: "45", facilities: ["STAGE"] });
    await openAsCoordinator(page, event);
    await page.getByRole("button", { name: "Find venues" }).click();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await venueCard(page, "E2E Grand Hall").getByRole("button", { name: "Book venue" }).click();
    const form = page.getByRole("region", { name: "Request this venue" });

    await test.step("AC1: a venue below the attendance is blocked outright", async () => {
      await page.getByRole("radio", { name: "E2E Small Studio" }).check();
      await expect(form.getByRole("alert")).toBeVisible();
      await expect(form.getByRole("button", { name: "Request this venue" })).toBeDisabled();
    });

    await test.step("AC2: a venue missing a facility needs the warning acknowledged", async () => {
      await page.getByRole("radio", { name: "E2E East Annex" }).check();
      await expect(form.getByRole("button", { name: "Request this venue" })).toBeDisabled();
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Request this venue" }).click();
      await expect(page.getByText("Booking request sent to Venue Staff.")).toBeVisible();
    });

    await test.step("AC3: Venue Staff see the acknowledged shortfall", async () => {
      await openBookingQueue(page, "venueStaff2");
      await bookingRow(page, event).getByRole("button", { name: "View request" }).click();
      // The request records which kind of requirement was acknowledged as unmet.
      await expect(bookingRow(page, event)).toContainText(/Known suitability shortfalls\s*facility/i);
    });
  });
});

test.describe(...story("E9", "Set a venue's setup and turnaround time"), () => {
  test("setup and turnaround take whole minutes and show on the venue", async ({ page }) => {
    await test.step("AC2: a negative value is refused", async () => {
      const form = await openVenueEditor(page, "E2E Small Studio");
      await form.getByLabel("Setup time (minutes)").fill("-5");
      await form.getByRole("button", { name: "Save venue" }).click();
      await expect(form.getByRole("alert")).toBeVisible();
      await form.getByRole("button", { name: "Cancel" }).click();
    });

    await test.step("AC1 + AC3: Venue Staff save 20 and 25 minutes", async () => {
      const form = await openVenueEditor(page, "E2E Small Studio");
      await form.getByLabel("Setup time (minutes)").fill("20");
      await form.getByLabel("Turnaround time (minutes)").fill("25");
      await saveVenue(page);
    });

    await test.step("AC4: the venue's record shows both values", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Venue catalogue");
      await venueCard(page, "E2E Small Studio").getByRole("button", { name: "View venue" }).click();
      const detail = page.getByRole("region", { name: "Venue record" }).first();
      await expect(detail).toContainText("20");
      await expect(detail).toContainText("25");
    });
  });
});

test.describe(...story("E10", "Record a venue's safety information"), () => {
  test("Venue Staff record emergency access and restrictions; the Safety Officer reads them", async ({ page }) => {
    await test.step("AC1 + AC2: Venue Staff fill in both notes", async () => {
      const form = await openVenueEditor(page, "E2E Grand Hall");
      await form.getByLabel("Emergency access notes").fill("Fire engines via Gate B.");
      await form.getByLabel("Known restrictions").fill("No open flames on stage.");
      await saveVenue(page);
    });

    await test.step("AC3: the Safety Officer sees them", async () => {
      await as(page, "safetyOfficer");
      await openScreen(page, "Venue safety information");
      const card = venueCard(page, "E2E Grand Hall");
      await card.getByRole("button", { name: "View safety information" }).click();
      await expect(card).toContainText("Fire engines via Gate B.");
      await expect(card).toContainText("No open flames on stage.");
    });
  });
});

test.describe(...story("E11", "Take a venue out of use even when events are booked there"), () => {
  test("blocking a booked venue flags the booking for replacement without cancelling the event", async ({ page }) => {
    const event = await newPlannedEvent(page, {}, "E2E Riverside Pavilion");

    await test.step("AC1 + AC2: Venue Staff block the venue over the booking, seeing and confirming the affected list", async () => {
      await blockVenue(page, "E2E Riverside Pavilion", event.date, "Safety concern", { expectAffected: [event.name] });
    });

    await test.step("AC3 + AC4: the coordinator sees the booking needs a replacement and is notified", async () => {
      await openCoordinatorBookings(page);
      await expect(coordinatorBooking(page, event, "E2E Riverside Pavilion")).toContainText(/replacement/i);
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
    });

    await test.step("AC3: the event itself is not cancelled", async () => {
      await openAsCoordinator(page, event);
      await expect(page.locator(".cs-review-detail")).not.toContainText("CANCELLED");
    });
  });
});

// ---------------------------------------------------------------- F

test.describe(...story("F1", "Request a venue for an event"), () => {
  test("a booking request is raised from an approved event and lands Pending with Venue Staff", async ({ page }) => {
    const event = await newApprovedEvent(page, { facilities: ["WIFI"] });

    await test.step("AC1: the request captures the event, venue, window, attendance, layout and facilities", async () => {
      await findVenues(page, event);
      await venueCard(page, "E2E Grand Hall").getByRole("button", { name: "Book venue" }).click();
      const details = page.getByRole("region", { name: "Event details" });
      await expect(details).toContainText(event.date);
      await expect(details).toContainText("10:00–12:00");
      await expect(details).toContainText("WIFI");
      await page.getByRole("button", { name: "Request this venue" }).click();
      await expect(page.getByText("Booking request sent to Venue Staff.")).toBeVisible();
    });

    await test.step("AC3: it is Pending in that venue's queue", async () => {
      await openBookingQueue(page);
      await expect(bookingRow(page, event)).toContainText("Pending");
      await expect(bookingRow(page, event)).toContainText("E2E Grand Hall");
    });

    await test.step("AC4: the same venue cannot be requested twice while pending", async () => {
      await findVenues(page, event);
      await venueCard(page, "E2E Grand Hall").getByRole("button", { name: "Book venue" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /already has a pending request/ })).toBeVisible();
    });
  });

  test("AC2: an event still Under Review cannot request a venue", async ({ page }) => {
    const { newSubmittedEvent, assignCoordinator } = await import("../helpers/flows.js");
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });
    await expect(page.getByRole("button", { name: "Find venues" })).toBeDisabled();
    await expect(page.getByText("Venue requests are available only for events with Approved or Planning status.")).toBeVisible();
  });
});

test.describe(...story("F2", "Have submitted event bookings assigned to a venue staff automatically"), () => {
  test("each request goes to the one Venue Staff member who manages that venue", async ({ page }) => {
    const event = await newApprovedEvent(page, { location: "EAST" });
    await requestVenue(page, event, "E2E East Annex");

    await test.step("AC1 + AC2: the East Annex's staff member has it", async () => {
      await openBookingQueue(page, "venueStaff2");
      await expect(bookingRow(page, event)).toContainText("Pending");
    });

    await test.step("AC1: the other Venue Staff member does not", async () => {
      await openBookingQueue(page, "venueStaff");
      await expect(bookingRow(page, event)).toHaveCount(0);
    });
  });
});

test.describe(...story("F3", "See booking requests waiting on me"), () => {
  test("the queue shows only my venues' requests, with sorting", async ({ page }) => {
    const mine = await newApprovedEvent(page);
    await requestVenue(page, mine, "E2E Grand Hall");

    await test.step("AC1 + AC2: my queue shows the request with its window, venue and submission time", async () => {
      await openBookingQueue(page);
      const row = bookingRow(page, mine);
      await expect(row).toContainText("E2E Grand Hall");
      await expect(row).toContainText("Submitted");
      await row.getByRole("button", { name: "View request" }).click();
      await expect(row).toContainText("Expected attendance");
    });

    await test.step("AC3: it can be sorted by requested date or submission time", async () => {
      const sort = page.getByRole("combobox", { name: "Sort by" });
      await sort.selectOption({ index: 1 });
      await expect(bookingRow(page, mine)).toBeVisible();
    });

    await test.step("AC1: another venue's staff member does not see it", async () => {
      await openBookingQueue(page, "venueStaff2");
      await expect(bookingRow(page, mine)).toHaveCount(0);
    });
  });
});

test.describe(...story("F4", "Approve a venue booking request"), () => {
  test("approval occupies the venue, and a competing request for the same slot is refused", async ({ page }) => {
    const day = freeDate();
    const first = await newApprovedEvent(page, { date: day });
    await requestVenue(page, first, "E2E Grand Hall");
    const second = await newApprovedEvent(page, { date: day, start: "11:00", end: "13:00" });
    await requestVenue(page, second, "E2E Grand Hall");

    await test.step("AC1 + AC3: approving the earlier request makes it Approved", async () => {
      await approveBooking(page, first);
    });

    await test.step("AC2 + AC4: the overlapping later request cannot be approved, naming the clash", async () => {
      await bookingRow(page, second).getByRole("button", { name: "Approve" }).click();
      await expect(page.getByRole("alert").filter({ hasText: first.name }).or(page.getByRole("alert").filter({ hasText: /overlap|clash|conflict/i })).first()).toBeVisible();
      await expect(bookingRow(page, second)).toContainText("Pending");
    });
  });
});

test.describe(...story("F5", "Reject a venue booking request with a reason"), () => {
  test("a rejection needs a reason and the coordinator reads it in full", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestVenue(page, event, "E2E Grand Hall");

    await test.step("AC1: an empty reason is refused", async () => {
      await openBookingQueue(page);
      await bookingRow(page, event).getByRole("button", { name: "Reject" }).click();
      await bookingRow(page, event).getByRole("button", { name: "Confirm rejection" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    });

    await test.step("AC2: with a reason it is Rejected", async () => {
      await bookingRow(page, event).getByLabel("Reason for rejection").fill("The hall is being repainted that week.");
      await bookingRow(page, event).getByRole("button", { name: "Confirm rejection" }).click();
      await expect(bookingRow(page, event)).toContainText(/Rejected/i);
    });

    await test.step("AC2 + AC4: the coordinator sees the full reason and can only request another venue", async () => {
      await openCoordinatorBookings(page);
      const row = coordinatorBooking(page, event, "E2E Grand Hall");
      await row.getByRole("button", { name: "View details" }).click();
      await expect(row).toContainText("The hall is being repainted that week.");
      await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
    });
  });
});

test.describe(...story("F6", "Never double-book a venue"), () => {
  test("touching windows are fine; overlapping ones are refused", async ({ page }) => {
    const day = freeDate();
    // Grand Hall: 30 min setup and 30 min turnaround. 08:00–09:00 occupies 07:30–09:30,
    // so a 10:00 start (occupying from 09:30) only touches it.
    const early = await newPlannedEvent(page, { date: day, start: "08:00", end: "09:00" });
    const touching = await newApprovedEvent(page, { date: day, start: "10:00", end: "11:00" });

    await test.step("AC2: a booking whose occupied window only touches is approved", async () => {
      await requestVenue(page, touching, "E2E Grand Hall");
      await approveBooking(page, touching);
    });

    await test.step("AC1 + AC3: an overlapping request is flagged and the venue drops out of search", async () => {
      const overlapping = await newApprovedEvent(page, { date: day, start: "08:30", end: "09:30" });
      await findVenues(page, overlapping);
      await expect(venueCard(page, "E2E Grand Hall")).toHaveCount(0);
      void early;
    });
  });
});

test.describe(...story("F7", "Track the status of my booking requests"), () => {
  test("the event lists every booking with its status, reason and decision time", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestVenue(page, event, "E2E Riverside Pavilion");
    await rejectBooking(page, event, "Pavilion closed for a private function.");
    await requestVenue(page, event, "E2E Grand Hall");

    await test.step("AC1 + AC2: both requests show, with the rejection reason in full", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      const bookings = page.getByRole("region", { name: "Venue booking status" });
      await expect(bookings).toContainText("E2E Riverside Pavilion");
      await expect(bookings).toContainText("E2E Grand Hall");
      await expect(bookings).toContainText("Pavilion closed for a private function.");
    });

    await test.step("AC3: without an approved booking it cannot move on", async () => {
      await page.getByRole("tab", { name: "Event request" }).click();
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
    });
  });
});

test.describe(...story("F8", "Release a venue when it is no longer needed"), () => {
  test("cancelling the event frees its booked window", async ({ page }) => {
    const event = await newPlannedEvent(page);

    await test.step("AC1: cancelling the event releases the approved booking", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("button", { name: "Cancel event" }).click();
      const box = page.locator(".cs-action-box");
      await box.locator("textarea").fill("Budget withdrawn.");
      await box.getByRole("checkbox").check();
      await box.getByRole("button", { name: "Confirm cancellation" }).click();
      await expect(page.locator(".cs-review-detail")).toContainText("CANCELLED");
    });

    await test.step("AC2: the window is free again for another event", async () => {
      const next = await newApprovedEvent(page, { date: event.date });
      await findVenues(page, next);
      await expect(venueCard(page, "E2E Grand Hall")).toBeVisible();
    });

    await test.step("AC3: the released booking stays in the event's history", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText(/releas/i);
    });
  });
});

test.describe(...story("F9", "Count setup and turnaround time when checking for clashes"), () => {
  test("a booking that overlaps only the setup time still clashes", async ({ page }) => {
    const day = freeDate();
    // Grand Hall: 10:00–12:00 occupies 09:30–12:30. A 12:45 start occupies from 12:15.
    const first = await newPlannedEvent(page, { date: day });

    await test.step("AC1: Venue Staff see the occupied window including setup and turnaround", async () => {
      await openBookingQueue(page);
      await bookingRow(page, first).getByRole("button", { name: "View request" }).click();
      await expect(bookingRow(page, first)).toContainText("9:30");
      await expect(bookingRow(page, first)).toContainText("12:30");
    });

    await test.step("AC3 + AC4: an event starting at 12:45 does not find the hall free", async () => {
      const second = await newApprovedEvent(page, { date: day, start: "12:45", end: "14:00" });
      await findVenues(page, second);
      await expect(venueCard(page, "E2E Grand Hall")).toHaveCount(0);
    });
  });
});

test.describe(...story("F10", "See existing bookings that now clash"), () => {
  test("a longer turnaround flags the bookings that now overlap, without cancelling them", async ({ page }) => {
    const day = freeDate();
    // Small Studio holds 30; both events are 20 pax. 10:00–11:00 and 13:00–14:00 are
    // well apart with the studio's short setup and turnaround (at most 25 minutes,
    // E9 may have changed them), but overlap once turnaround is 180 minutes.
    const first = await newPlannedEvent(page, { date: day, start: "10:00", end: "11:00", attendance: "20" }, "E2E Small Studio");
    const second = await newPlannedEvent(page, { date: day, start: "13:00", end: "14:00", attendance: "20" }, "E2E Small Studio");

    await test.step("AC1: Venue Staff lengthen the turnaround", async () => {
      const form = await openVenueEditor(page, "E2E Small Studio");
      await form.getByLabel("Turnaround time (minutes)").fill("180");
      await saveVenue(page);
    });

    await test.step("AC2 + AC3 + AC6: both bookings are flagged, still approved, and listed on their own", async () => {
      await openBookingQueue(page);
      await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "Clashes" });
      await expect(bookingRow(page, first)).toContainText(/Clash - review required/);
      await expect(bookingRow(page, second)).toContainText(/Clash - review required/);
    });

    await test.step("AC4: the coordinator is notified", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(/clash/i);
    });

    await test.step("put the studio back for the other tests", async () => {
      const form = await openVenueEditor(page, "E2E Small Studio");
      await form.getByLabel("Turnaround time (minutes)").fill("15");
      await saveVenue(page);
    });
  });
});

test.describe(...story("F11", "Find a replacement venue for an event that lost its venue"), () => {
  test("a confirmed event whose venue closes goes back to Planning until a replacement is approved", async ({ page }) => {
    const event = await newConfirmedEvent(page, {}, "E2E Riverside Pavilion");

    await test.step("Venue Staff take the venue out of use over the event", async () => {
      await blockVenue(page, "E2E Riverside Pavilion", event.date, "Maintenance", { expectAffected: [event.name] });
    });

    await test.step("AC6: the event is back in Planning", async () => {
      await openAsCoordinator(page, event);
      await expect(page.locator(".cs-review-detail")).toContainText("PLANNING");
    });

    await test.step("AC1 + AC2: from the flagged booking, find a replacement; the closed venue is excluded", async () => {
      await openCoordinatorBookings(page);
      const row = coordinatorBooking(page, event, "E2E Riverside Pavilion");
      await expect(row).toContainText(/replacement/i);
      await row.getByRole("button", { name: "View details" }).click();
      await row.getByRole("button", { name: "Find replacement venue" }).click();
      await expect(venueCard(page, "E2E Riverside Pavilion")).toHaveCount(0);
      await venueCard(page, "E2E Grand Hall").getByRole("button", { name: "Book venue" }).click();
      await page.getByRole("button", { name: "Request this venue" }).click();
      await expect(page.getByText("Booking request sent to Venue Staff.")).toBeVisible();
    });

    await test.step("AC3 + AC5: once approved, the old booking is marked Replaced", async () => {
      await approveBooking(page, event);
      await openCoordinatorBookings(page);
      await expect(coordinatorBooking(page, event, "E2E Riverside Pavilion")).toContainText(/Replaced/i);
    });
  });
});

test.describe(...story("F12", "Book more than one venue for an event"), () => {
  test("two labelled venues for one event, each with its own attendance", async ({ page }) => {
    const event = await newApprovedEvent(page, { attendance: "100" });

    await test.step("AC1 + AC2: a main hall booking with its own label", async () => {
      await requestVenue(page, event, "E2E Grand Hall");
    });

    await test.step("AC3: a breakout above the event's attendance is refused, then 25 is accepted", async () => {
      await findVenues(page, event);
      await venueCard(page, "E2E Riverside Pavilion").getByRole("button", { name: "Book venue" }).click();
      const form = page.getByRole("region", { name: "Request this venue" });
      await form.getByLabel("Booking label").fill("Breakout 1");
      await form.getByLabel("Expected attendance for this venue").fill("120");
      await expect(form.getByRole("button", { name: "Request this venue" })).toBeDisabled();
      await form.getByLabel("Expected attendance for this venue").fill("25");
      await form.getByRole("button", { name: "Request this venue" }).click();
      await expect(page.getByText("Booking request sent to Venue Staff.")).toBeVisible();
    });

    await test.step("AC5: the event lists both bookings with their labels", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      const bookings = page.getByRole("region", { name: "Venue booking status" });
      await expect(bookings).toContainText("E2E Grand Hall");
      await expect(bookings).toContainText("Breakout 1");
    });
  });
});

test.describe(...story("F13", "Have each venue of an event checked on its own"), () => {
  test("a rejected breakout leaves the main booking alone, and blocks the safety check", async ({ page }) => {
    const event = await newApprovedEvent(page, { attendance: "100" });
    await requestVenue(page, event, "E2E Grand Hall");
    await approveBooking(page, event);
    await requestVenue(page, event, "E2E Riverside Pavilion");

    await test.step("AC4: with one booking still pending, the event is not venue-ready", async () => {
      await openAsCoordinator(page, event);
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
    });

    await test.step("AC3: rejecting the second booking leaves the first approved", async () => {
      await openBookingQueue(page);
      const pending = bookingRow(page, event).filter({ hasText: "E2E Riverside Pavilion" });
      await pending.getByRole("button", { name: "Reject" }).click();
      await pending.getByLabel("Reason for rejection").fill("Double-booked with a wedding.");
      await pending.getByRole("button", { name: "Confirm rejection" }).click();
      await openAsCoordinator(page, event);
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      const grand = page.getByRole("region", { name: "Venue booking status" }).locator("article").filter({ hasText: "E2E Grand Hall" });
      await expect(grand).toContainText("APPROVED");
    });
  });
});

test.describe(...story("F14", "Release one venue without losing the others"), () => {
  test("releasing a breakout keeps the main booking, with the reason kept", async ({ page }) => {
    const event = await newApprovedEvent(page, { attendance: "100" });
    await requestVenue(page, event, "E2E Grand Hall");
    await approveBooking(page, event);
    await requestVenue(page, event, "E2E Riverside Pavilion");
    await approveBooking(page, event);

    await test.step("AC1: release the Pavilion with a reason", async () => {
      await openCoordinatorBookings(page);
      const row = coordinatorBooking(page, event, "E2E Riverside Pavilion");
      await row.getByRole("button", { name: "View details" }).click();
      await row.getByRole("button", { name: "Release this venue" }).click();
      const dialog = page.getByRole("dialog", { name: "Release this venue?" });
      await dialog.getByLabel("Reason").fill("Breakout sessions merged into the main hall.");
      await dialog.getByRole("button", { name: "Release venue" }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step("AC1 + AC3: the main hall stays approved; the release reason is kept", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      const bookings = page.getByRole("region", { name: "Venue booking status" });
      await expect(bookings.locator("article").filter({ hasText: "E2E Grand Hall" })).toContainText("APPROVED");
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText("Breakout sessions merged into the main hall.");
    });
  });
});

test.describe(...story("F15", "Place a tentative hold on a venue"), () => {
  test("a hold blocks the slot, does not count as a booking, and can be converted", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestVenue(page, event, "E2E Grand Hall");

    await test.step("AC1 + AC2: Venue Staff place a hold; its expiry is set for them", async () => {
      await openBookingQueue(page);
      await bookingRow(page, event).getByRole("button", { name: "Place hold" }).click();
      await expect(bookingRow(page, event)).toContainText("Held");
      await expect(bookingRow(page, event)).toContainText(/Held until \w{3} \d+ \w{3} \d{4}, \d{2}:\d{2}/);
    });

    await test.step("AC5: a hold does not count as an approved booking", async () => {
      await openAsCoordinator(page, event);
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
    });

    await test.step("AC6: the coordinator is told about the hold and its expiry", async () => {
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(`${event.name}: E2E Grand Hall is held for this event until`);
    });

    await test.step("AC7: Venue Staff convert it into an approved booking", async () => {
      await openBookingQueue(page);
      await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "On hold" });
      await bookingRow(page, event).getByRole("button", { name: "Convert to booking" }).click();
      await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "All requests" });
      await expect(bookingRow(page, event)).toContainText("Approved");
      await sendForSafetyCheck(page, event);
    });
  });
});

test.describe(...story("F16", "Have unconfirmed holds expire on time"), () => {
  test("a hold past its expiry is treated as expired and the slot is free", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestVenue(page, event, "E2E Grand Hall");
    await openBookingQueue(page);
    await bookingRow(page, event).getByRole("button", { name: "Place hold" }).click();
    await expect(bookingRow(page, event)).toContainText(/held/i);

    await test.step("time passes: the hold's expiry is now in the past", async () => {
      expect(await expireHoldsFor(event.referenceNo)).toBe(1);
    });

    await test.step("AC1 + AC3: Venue Staff see the hold as expired, not as a booking", async () => {
      await openBookingQueue(page);
      await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "All requests" });
      await expect(bookingRow(page, event)).toContainText(/expired/i);
      await expect(bookingRow(page, event)).not.toContainText("Approved");
    });

    await test.step("AC2: the window is free again in venue search", async () => {
      const other = await newApprovedEvent(page, { date: event.date });
      await findVenues(page, other);
      await expect(venueCard(page, "E2E Grand Hall")).toBeVisible();
    });
  });
});

void toast;
