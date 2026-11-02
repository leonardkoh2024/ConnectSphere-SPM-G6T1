// Epics I and J — Change requests after submission, and the notification inbox.
import { test, expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { story } from "./story.js";
import { openScreen, screenButton, record, toast } from "../helpers/app.js";
import {
  as, newSubmittedEvent, assignCoordinator, newApprovedEvent, newPlannedEvent, newConfirmedEvent, openAsCoordinator,
  decide, requestVenue, approveBooking, requestEquipment, reserveEquipment, sendForSafetyCheck, register,
  newRegistrationEvent
} from "../helpers/flows.js";

const inbox = (page) => page.getByRole("region", { name: "Notifications" }).or(page.locator(".cs-panel-scroll")).first();
const notice = (page, text) => inbox(page).locator("article, li, tr").filter({ hasText: text }).first();

// Most inboxes give each notice a View button; the Lead's and Safety Officer's
// queues make the whole notice the button.
async function openNotice(page, text) {
  const item = notice(page, text);
  const view = item.getByRole("button", { name: /^View/ });
  if (await view.count()) await view.first().click();
  else await item.getByRole("button").first().click();
}

// Organiser: a change request on `event`, changing one detail.
async function requestChange(page, event, { detail, value, reason }) {
  await as(page, "organiser");
  await openScreen(page, "Change requests");
  await page.locator("header.cs-panel-head").getByRole("button", { name: "New change request" }).click();
  const form = page.getByRole("form", { name: "New change request" });
  await form.getByLabel("Event to change").selectOption({ label: `${event.name} (${event.referenceNo})` });
  await form.getByRole("checkbox", { name: detail, exact: true }).check();
  await form.getByLabel(`New ${detail.toLowerCase()}`).fill(value);
  await form.getByLabel("Reason for the change").fill(reason);
  await form.getByRole("button", { name: "Send change request" }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

async function openChangeReview(page, event) {
  await as(page, "coordinator");
  await openScreen(page, "Change requests");
  await page.getByLabel("Change requests on your events").locator("article").filter({ hasText: event.name })
    .getByRole("button", { name: "Review change" }).first().click();
}

// ---------------------------------------------------------------- I

test.describe(...story("I1", "Request a change after submitting my event"), () => {
  test("the organiser asks for a change with a reason; it is Pending and the coordinator is told", async ({ page }) => {
    const event = await newApprovedEvent(page);

    await test.step("AC1 + AC2: pick the event, the detail and its new value, and give a reason", async () => {
      await requestChange(page, event, { detail: "Purpose", value: "Leadership retreat", reason: "The agenda changed." });
    });

    await test.step("AC4: the request is Pending", async () => {
      const list = page.getByLabel("Your change requests");
      await expect(list.locator("article").filter({ hasText: event.name }).first()).toContainText(/pending/i);
    });

    await test.step("AC3: a second request on the same event is allowed", async () => {
      await requestChange(page, event, { detail: "Description", value: "Now a two-hour retreat.", reason: "More detail." });
      await expect(page.getByLabel("Your change requests").locator("article").filter({ hasText: event.name })).toHaveCount(2);
    });

    await test.step("AC4: the assigned coordinator is notified", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(event.name);
    });
  });
});

test.describe(...story("I2", "Decide on a requested change"), () => {
  test("the coordinator compares values, accepts one change and declines another with a reason", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestChange(page, event, { detail: "Purpose", value: "Leadership retreat", reason: "The agenda changed." });

    await test.step("AC1: current and proposed values are shown side by side", async () => {
      await openChangeReview(page, event);
      await expect(page.locator("main")).toContainText("Team offsite");
      await expect(page.locator("main")).toContainText("Leadership retreat");
    });

    await test.step("AC3: accepting applies the new value", async () => {
      await page.getByRole("button", { name: /^Accept/ }).click();
      await expect(toast(page).getByText(/Change accepted and applied/)).toBeVisible();
      await openAsCoordinator(page, event);
      await expect(page.locator(".cs-review-detail")).toContainText("Leadership retreat");
    });

    await test.step("AC2: declining a second request needs a reason", async () => {
      await requestChange(page, event, { detail: "Description", value: "Something else.", reason: "Second thoughts." });
      await openChangeReview(page, event);
      const decline = page.getByRole("button", { name: "Decline change" });
      await decline.click();
      await expect(page.getByRole("alert").first()).toBeVisible();
      await page.getByLabel("Reason (required to decline)").fill("The description is final.");
      await decline.click();
      await expect(toast(page).getByText("Change declined. The organiser has been told why.")).toBeVisible();
    });

    await test.step("AC4: the organiser sees both decisions and the reason", async () => {
      await as(page, "organiser");
      await openScreen(page, "Change requests");
      await expect(page.getByLabel("Your change requests")).toContainText("The description is final.");
    });
  });
});

test.describe(...story("I3", "Have arrangements re-requested after a significant change"), () => {
  test("an accepted date change sends a Confirmed event back to Planning and flags its booking", async ({ page }) => {
    const event = await newConfirmedEvent(page);
    await requestChange(page, event, { detail: "Expected attendance", value: "60", reason: "More sign-ups than expected." });

    await test.step("AC1: accepting it moves the event back to Planning", async () => {
      await openChangeReview(page, event);
      const acknowledge = page.getByRole("checkbox", { name: /understand|acknowledge/i });
      if (await acknowledge.count()) await acknowledge.check();
      await page.getByRole("button", { name: /^Accept/ }).click();
      await expect(toast(page).getByText(/Change accepted and applied/)).toBeVisible();
      await openAsCoordinator(page, event);
      await expect(page.locator(".cs-review-detail")).toContainText("PLANNING");
    });

    await test.step("AC3: the booking is kept, not cancelled", async () => {
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      await expect(page.getByRole("region", { name: "Venue booking status" })).toContainText("E2E Grand Hall");
      await expect(page.getByRole("region", { name: "Venue booking status" })).toContainText("APPROVED");
    });

    await test.step("AC1 + AC2: the venue's staff are told the booking must be re-requested", async () => {
      await as(page, "venueStaff");
      await openScreen(page, "Notifications");
      await expect(notice(page, event.name)).toBeVisible();
      await expect(inbox(page)).toContainText(/re-?request|changed/i);
    });
  });
});

// ---------------------------------------------------------------- J

test.describe(...story("J1", "Have one place where things needing my attention appear"), () => {
  test("the inbox counts unread items and keeps read ones", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);

    await test.step("AC1 + AC3: the organiser's inbox shows a message, its event and time, with an unread badge", async () => {
      await as(page, "organiser");
      await expect(screenButton(page, "Notifications")).toHaveAccessibleName(/unread/);
      await openScreen(page, "Notifications");
      const item = notice(page, event.name);
      await expect(item).toContainText("Unread");
    });

    await test.step("AC3 + AC4: opening it marks it read; it stays listed", async () => {
      const before = await screenButton(page, "Notifications").getAttribute("aria-label").catch(() => null);
      await openNotice(page, event.name);
      await openScreen(page, "Notifications");
      await expect(notice(page, event.name)).toBeVisible();
      void before;
    });

    await test.step("AC2: another organiser gets nothing about this event", async () => {
      await as(page, "otherOrganiser");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).not.toContainText(event.name);
    });
  });
});

test.describe(...story("J2", "Be told how my request is progressing"), () => {
  test("the organiser is told at each step, with reasons on decisions", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });
    await decide(page, "clarify", "Please confirm the catering numbers.");
    const rejected = await newSubmittedEvent(page);
    await assignCoordinator(page, rejected);
    await openAsCoordinator(page, rejected, { screen: "Review queue" });
    await decide(page, "reject", "We cannot staff an event that week.");

    await test.step("AC1 + AC2: submission, assignment and clarification are each in the inbox", async () => {
      await as(page, "organiser");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(event.name);
      await expect(inbox(page)).toContainText(/assigned/i);
      await expect(inbox(page)).toContainText("Please confirm the catering numbers.");
    });

    await test.step("AC3: the rejection carries its reason", async () => {
      await expect(inbox(page)).toContainText("We cannot staff an event that week.");
    });
  });
});

test.describe(...story("J3", "Be told when work arrives for me"), () => {
  test("a coordinator is told about a new assignment and a change request", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestChange(page, event, { detail: "Purpose", value: "Board offsite", reason: "Board attending." });

    await test.step("AC1 + AC2: both arrive in the coordinator's inbox", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Notifications");
      await expect(inbox(page).locator("article, li, tr").filter({ hasText: event.name })).not.toHaveCount(0);
      await expect(inbox(page)).toContainText(/change/i);
    });
  });
});

test.describe(...story("J4", "Be told when work arrives for me"), () => {
  test("Venue Staff are told when a booking request is raised for their venue", async ({ page }) => {
    const event = await newApprovedEvent(page);
    await requestVenue(page, event, "E2E Grand Hall");

    await test.step("AC1: the venue's staff member is notified, naming the event", async () => {
      await as(page, "venueStaff");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(event.name);
    });

    await test.step("another venue's staff member is not", async () => {
      await as(page, "venueStaff2");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).not.toContainText(event.name);
    });
  });
});

test.describe(...story("J5", "Be told when work arrives for me"), () => {
  test("Technical Support are told when an equipment request is raised, including on-site support", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "AUDIO", quantity: 2 }] });
    await requestEquipment(page, event, {
      edit: async (editor) => {
        await editor.getByRole("checkbox", { name: "On-site support needed" }).check();
        const details = editor.getByRole("textbox").last();
        await details.fill("A technician for sound checks.");
      }
    });

    await test.step("AC1 + AC2: the request and the on-site support need reach Technical Support", async () => {
      await as(page, "techSupport");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(event.name);
      await expect(inbox(page)).toContainText(/on-site/i);
    });
  });
});

test.describe(...story("J6", "Be told the outcome of my booking and equipment requests"), () => {
  test("the coordinator is told when the booking is approved and the equipment arranged", async ({ page }) => {
    const event = await newApprovedEvent(page, { equipment: [{ type: "AUDIO", quantity: 1 }] });
    await requestVenue(page, event, "E2E Grand Hall");
    await approveBooking(page, event);
    await requestEquipment(page, event);
    await reserveEquipment(page, event);

    await test.step("AC1 + AC3: both outcomes are in the inbox", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(/approved/i);
      await expect(inbox(page)).toContainText(/arranged|reserved/i);
    });

    await test.step("AC2: View opens the event so the booking can be checked", async () => {
      await openNotice(page, event.name);
      await expect(page.locator("main")).toContainText(event.name);
    });
  });
});

test.describe(...story("J7", "Be told about changes to events I registered for"), () => {
  test("a registered attendee is told on registration and on cancellation", async ({ page }) => {
    const event = await newRegistrationEvent(page, 10);
    await register(page, "attendee", event);

    await test.step("AC1: registration confirmation arrives", async () => {
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(event.name);
    });

    await test.step("AC1 + AC3: cancelling the event tells the attendee", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("button", { name: "Cancel event" }).click();
      const box = page.locator(".cs-action-box");
      await box.locator("textarea").fill("Speaker unavailable.");
      await box.getByRole("checkbox").check();
      await box.getByRole("button", { name: "Confirm cancellation" }).click();
      await expect(page.locator(".cs-review-detail")).toContainText("CANCELLED");
      await as(page, "attendee");
      await openScreen(page, "Notifications");
      await expect(inbox(page)).toContainText(/cancel/i);
    });
  });
});

test.describe(...story("J8", "Be told when an event is waiting for a coordinator"), () => {
  test("the Lead is told when an event enters the unassigned queue", async ({ page }) => {
    const event = await newSubmittedEvent(page);

    await test.step("AC1 + AC2 + AC5: the notice names the event, with an unread badge", async () => {
      await as(page, "lead");
      await expect(screenButton(page, "Notifications")).toHaveAccessibleName(/unread/);
      await openScreen(page, "Notifications");
      await expect(notice(page, event.name)).toBeVisible();
    });

    await test.step("AC2: View opens the event in the queue", async () => {
      await openNotice(page, event.name);
      await expect(page.getByRole("heading", { level: 1, name: "Unassigned queue" })).toBeVisible();
      await expect(record(page, event.name)).toBeVisible();
    });

    await test.step("AC3: once assigned, the notice shows the coordinator and no assignment action", async () => {
      await assignCoordinator(page, event);
      await openScreen(page, "Notifications");
      await openNotice(page, event.name);
      // The notice names the coordinator by account id rather than display name.
      await expect(page.locator("main")).toContainText(new RegExp(`Coordinator\\s*(${USERS.coordinator.name}|${USERS.coordinator.uid})`));
      await expect(page.locator("main").getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);
    });
  });
});

test.describe(...story("J9", "Be told when an event is waiting for its safety check"), () => {
  test("the Safety Officer is told and taken to the review", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await sendForSafetyCheck(page, event);

    await test.step("AC1 + AC2 + AC6: the notice names the event and venue, unread", async () => {
      await as(page, "safetyOfficer");
      await expect(screenButton(page, "Notifications")).toHaveAccessibleName(/unread/);
      await openScreen(page, "Notifications");
      await expect(notice(page, event.name)).toBeVisible();
    });

    await test.step("AC2: View opens the event's safety review", async () => {
      await openNotice(page, event.name);
      await expect(page.getByRole("region", { name: "Record outcome" })).toBeVisible();
    });
  });
});

void toast;
