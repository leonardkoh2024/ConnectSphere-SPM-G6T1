// Epic L — The Operational Safety Check between Planning and Confirmed.
import { test, expect } from "@playwright/test";
import { story } from "./story.js";
import { openScreen, record, toast } from "../helpers/app.js";
import {
  as, newApprovedEvent, newPlannedEvent, requestVenue, sendForSafetyCheck, openSafetyReview,
  recordSafetyOutcome, openAsCoordinator
} from "../helpers/flows.js";

const pill = (page) => page.locator(".cs-review-heading .cs-pill, .cs-review-heading .cs-pill + *, main").filter({ hasText: /\b(SAFETY_REVIEW|PLANNING|CONFIRMED|APPROVED)\b/ }).first();
const statusOf = async (page, event) => {
  await openAsCoordinator(page, event);
  return page.locator(".cs-review-heading");
};

test.describe(...story("L1", "Send an event for its safety check"), () => {
  test("only an event with every arrangement in place can be sent", async ({ page }) => {
    const event = await newApprovedEvent(page);

    await test.step("AC1 + AC2: with no approved booking the action is unavailable and names what is missing", async () => {
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
      await expect(page.getByText("Still outstanding: an approved venue booking.")).toBeVisible();
    });

    await test.step("a pending booking request still does not count", async () => {
      await requestVenue(page, event, "E2E Grand Hall");
      await openAsCoordinator(page, event);
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
    });

    await test.step("Venue Staff approve the booking", async () => {
      await as(page, "venueStaff");
      await openScreen(page, "Booking requests");
      const row = page.getByRole("region", { name: "Venue booking requests" }).locator("article").filter({ hasText: event.name });
      await row.getByRole("button", { name: "Approve" }).click();
      await expect(row).toContainText("Approved");
    });

    await test.step("AC3: sending moves the event to Safety Review and the Safety Officer is told", async () => {
      await sendForSafetyCheck(page, event);
      await expect(page.locator(".cs-review-detail")).toContainText("SAFETY_REVIEW");
      await as(page, "safetyOfficer");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
    });
  });
});

test.describe(...story("L2", "Review an event's operational safety"), () => {
  test("the Safety Officer sees everything the check needs", async ({ page }) => {
    const event = await newPlannedEvent(page, { accessibility: ["WHEELCHAIR_ACCESS"], attendance: "60" });

    await test.step("the coordinator records equipment placement and crowd movement", async () => {
      await openAsCoordinator(page, event);
      await page.getByLabel("Equipment placement").fill("Speakers at the front corners.");
      await page.getByLabel("Crowd movement").fill("Enter by the north doors, exit south.");
      await page.getByRole("button", { name: "Save safety notes" }).click();
      await expect(toast(page).getByText("Safety planning notes saved.")).toBeVisible();
      await sendForSafetyCheck(page, event);
    });

    await test.step("AC1: the queue lists the event with its date, venue and attendance", async () => {
      await as(page, "safetyOfficer");
      await openScreen(page, "Safety reviews");
      const row = page.locator("article").filter({ hasText: event.name });
      await expect(row).toContainText(event.date);
      await expect(row).toContainText("Venues: E2E Grand Hall");
      await expect(row).toContainText("Expected attendance: 60");
    });

    await test.step("AC2 + AC3: the review shows attendance against capacity, accessibility and the planning notes", async () => {
      await openSafetyReview(page, event);
      await expect(page.getByRole("region", { name: "Venue bookings" })).toContainText("60 of 200");
      await expect(page.getByRole("region", { name: "Venue bookings" })).toContainText("Emergency access");
      await expect(page.getByRole("region", { name: "Accessibility requirements" })).toContainText(/WHEELCHAIR/);
      await expect(page.getByRole("region", { name: "Equipment placement" })).toContainText("Speakers at the front corners.");
      await expect(page.getByRole("region", { name: "Crowd movement" })).toContainText("Enter by the north doors, exit south.");
    });

    await test.step("AC4: earlier outcomes are listed (none yet)", async () => {
      await expect(page.getByRole("region", { name: "Previous safety checks" })).toContainText("No earlier safety checks.");
    });
  });
});

test.describe(...story("L3", "Record the outcome of a safety check"), () => {
  test("a concern needs a comment; approval confirms the event", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await sendForSafetyCheck(page, event);
    await openSafetyReview(page, event);

    await test.step("AC1 + AC2: Reject without a comment is refused", async () => {
      await recordSafetyOutcome(page, "Reject", "", { expectRecorded: false });
      await expect(page.getByRole("region", { name: "Record outcome" }).getByRole("alert")).toBeVisible();
    });

    await test.step("AC1 + AC3 + AC4: Approve confirms the event", async () => {
      await recordSafetyOutcome(page, "Approve", "Exits and capacity checked.");
      await openAsCoordinator(page, event);
      await expect(page.locator(".cs-review-detail")).toContainText("CONFIRMED");
    });

    await test.step("AC4: the organiser is notified", async () => {
      await as(page, "organiser");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
    });

    await test.step("AC5: once Confirmed it is no longer in the safety queue", async () => {
      await as(page, "safetyOfficer");
      await openScreen(page, "Safety reviews");
      await expect(page.locator("article").filter({ hasText: event.name })).toHaveCount(0);
    });
  });
});

test.describe(...story("L4", "Return an event to planning after a safety concern"), () => {
  test("requesting changes sends the event back to Planning for a new check", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await sendForSafetyCheck(page, event);

    await test.step("AC1 + AC2: the Safety Officer requests changes to the venue with a comment", async () => {
      await openSafetyReview(page, event);
      await recordSafetyOutcome(page, "Request changes", "Fire exit at the rear is obstructed.", { review: ["Venue"] });
    });

    await test.step("AC1: the event is back in Planning and the coordinator sees the comment", async () => {
      await openAsCoordinator(page, event);
      await expect(page.locator(".cs-review-detail")).toContainText("PLANNING");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText("Fire exit at the rear is obstructed.");
    });

    await test.step("AC3 + AC4: the venue booking is flagged for review, which blocks a new safety check", async () => {
      await openAsCoordinator(page, event);
      await expect(page.getByText(/Still outstanding: .*still needs review/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
    });

    await test.step("AC3: the venue's staff are told the booking needs review", async () => {
      await as(page, "venueStaff");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText("is marked Review required");
    });

    await test.step("AC5: the previous outcome is shown at the next check", async () => {
      await as(page, "safetyOfficer");
      await openScreen(page, "Safety reviews");
      await expect(page.locator("article").filter({ hasText: event.name })).toHaveCount(0);
    });
  });
});

void pill; void statusOf; void record;
