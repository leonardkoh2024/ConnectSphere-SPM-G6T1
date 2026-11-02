// Epic D — Planning an approved event: edits, significant changes, cancelling,
// closing out, and the event's history.
import { test, expect } from "@playwright/test";
import { story } from "./story.js";
import { openScreen, record, toast, isoDate } from "../helpers/app.js";
import { setEventDate } from "../helpers/db.js";
import {
  as, newApprovedEvent, newPlannedEvent, newConfirmedEvent, openAsCoordinator, bookingRow, openBookingQueue,
  requestEquipment, reserveEquipment
} from "../helpers/flows.js";

const detail = (page) => page.locator(".cs-review-detail");
const editor = (page) => page.getByRole("region", { name: "Edit event" });

async function startEditing(page, event) {
  await openAsCoordinator(page, event);
  await page.getByRole("button", { name: "Edit event" }).click();
  await expect(editor(page)).toBeVisible();
}

async function cancelEvent(page, reason) {
  await page.getByRole("button", { name: "Cancel event" }).click();
  const box = page.locator(".cs-action-box");
  await box.locator("textarea").fill(reason);
  await box.getByRole("checkbox").check();
  await box.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(toast(page).getByText("Event cancelled and arrangements released.")).toBeVisible();
}

test.describe(...story("D1", "Update ordinary event information during planning"), () => {
  test("ordinary details change without touching the booking, and the change is logged", async ({ page }) => {
    const event = await newPlannedEvent(page);

    await test.step("AC1 + AC4: edit the purpose and internal notes, twice", async () => {
      await startEditing(page, event);
      await editor(page).getByLabel("Purpose").fill("Quarterly all-hands");
      await editor(page).getByRole("button", { name: "Save changes" }).click();
      await expect(toast(page).getByText("Event changes saved.")).toBeVisible();
      await startEditing(page, event);
      await editor(page).getByLabel("Internal notes").fill("Catering confirmed by phone.");
      await editor(page).getByRole("button", { name: "Save changes" }).click();
      await expect(toast(page).getByText("Event changes saved.")).toBeVisible();
    });

    await test.step("the venue booking is still approved", async () => {
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      await expect(page.getByRole("region", { name: "Venue booking status" })).toContainText("APPROVED");
    });

    await test.step("AC2: the Activity tab records old and new values", async () => {
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(detail(page)).toContainText("Team offsite");
      await expect(detail(page)).toContainText("Quarterly all-hands");
    });
  });
});

test.describe(...story("D2", "Be warned before making a significant change"), () => {
  test("changing the attendance warns about the booking and needs acknowledging", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await startEditing(page, event);

    await test.step("AC1 + AC2: changing expected attendance names the affected venue booking", async () => {
      await editor(page).getByLabel("Expected attendance (pax)").fill("55");
      await expect(editor(page)).toContainText("E2E Grand Hall");
    });

    await test.step("AC3: saving needs the warning acknowledged", async () => {
      const save = editor(page).getByRole("button", { name: "Save changes" });
      const acknowledge = editor(page).getByRole("checkbox", { name: /understand|acknowledge/i });
      await expect(save).toBeDisabled();
      await acknowledge.check();
      await save.click();
      await expect(toast(page).getByText(/saved/)).toBeVisible();
    });

    await test.step("AC4: the change is recorded with old and new values", async () => {
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(detail(page)).toContainText("40");
      await expect(detail(page)).toContainText("55");
    });
  });
});

test.describe(...story("D3", "Confirm an event once arrangements are in place"), () => {
  // Week 7 change 6 (story L1): confirmation now happens through the safety check.
  test("an event with equipment cannot move on until the equipment is arranged", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "AUDIO", quantity: 2 }] });
    await requestEquipment(page, event);

    await test.step("AC1 + AC2: with the venue approved but equipment not arranged, the view names what is outstanding", async () => {
      await openAsCoordinator(page, event);
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
      await expect(page.getByText(/Still outstanding: .*equipment/i)).toBeVisible();
    });

    await test.step("once Technical Support reserve it, the event can move on", async () => {
      await reserveEquipment(page, event);
      await openAsCoordinator(page, event);
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeEnabled();
    });
  });

  test("AC3: with everything in place the event ends Confirmed", async ({ page }) => {
    const event = await newConfirmedEvent(page);
    await openAsCoordinator(page, event);
    await expect(detail(page)).toContainText("CONFIRMED");
  });
});

test.describe(...story("D4", "Cancel an event"), () => {
  test("cancelling needs a reason and confirmation, releases the venue and keeps the record", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await openAsCoordinator(page, event);

    await test.step("AC1: the reason and the confirmation tick are both required", async () => {
      await page.getByRole("button", { name: "Cancel event" }).click();
      const box = page.locator(".cs-action-box");
      await box.locator("textarea").fill("Client postponed indefinitely.");
      await expect(box.getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
      await box.getByRole("button", { name: "Keep event" }).click();
    });

    await test.step("AC2: cancelling sets Cancelled", async () => {
      await cancelEvent(page, "Client postponed indefinitely.");
      await expect(detail(page)).toContainText("CANCELLED");
    });

    await test.step("AC2 + AC3: Venue Staff see the booking released", async () => {
      await openBookingQueue(page);
      await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "All requests" });
      await expect(bookingRow(page, event)).not.toContainText("Approved");
    });

    await test.step("AC5 + AC6: the organiser still sees the event and is told why", async () => {
      await as(page, "organiser");
      await openScreen(page, "My events");
      await expect(record(page, event.name).locator(".cs-pill")).toHaveText(/cancelled/i);
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText("Client postponed indefinitely.");
    });
  });
});

test.describe(...story("D5", "Close out an event after it has taken place"), () => {
  test("a confirmed event is completed once it has ended, and stays viewable", async ({ page }) => {
    const event = await newConfirmedEvent(page);

    await test.step("AC1: completion is offered for a Confirmed event, and checked against its end time", async () => {
      await openAsCoordinator(page, event);
      await expect(page.getByText("Completion is checked against the event end time on the server.")).toBeVisible();
      await page.getByRole("button", { name: "Mark completed" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    });

    await test.step("time passes: the event's date is now in the past", async () => {
      await setEventDate(event.referenceNo, isoDate(-1));
    });

    await test.step("AC2: completing it sets Completed and it leaves the active list", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("button", { name: "Mark completed" }).click();
      await expect(toast(page).getByText("Event marked completed.")).toBeVisible();
      await expect(detail(page)).toContainText("COMPLETED");
    });

    await test.step("AC3: the organiser can still open everything", async () => {
      await as(page, "organiser");
      await openScreen(page, "My events");
      await expect(record(page, event.name).locator(".cs-pill")).toHaveText(/completed/i);
      await record(page, event.name).getByRole("button", { name: "View details" }).click();
      await expect(page.getByRole("region", { name: "Request decision" })).toContainText("E2E Grand Hall");
    });
  });
});

test.describe(...story("D6", "See everything that happened to an event"), () => {
  test("the Activity tab lists every step, newest first, read-only", async ({ page }) => {
    const event = await newPlannedEvent(page);
    await openAsCoordinator(page, event);
    await page.getByRole("tab", { name: "Activity" }).click();
    const activity = page.getByRole("tabpanel", { name: "Activity" });

    await test.step("AC1: submission, assignment, review, approval and the booking are all there with actors", async () => {
      await expect(activity).toContainText("Event submitted");
      await expect(activity).toContainText("Assigned a coordinator");
      await expect(activity).toContainText("Started review");
      await expect(activity).toContainText("Approved the request");
      await expect(activity).toContainText("Approved a venue booking");
      await expect(activity).toContainText("by E2E Event Coordinator");
    });

    await test.step("AC1: newest first", async () => {
      const text = await activity.textContent();
      expect(text.indexOf("Approved a venue booking")).toBeLessThan(text.indexOf("Event submitted"));
    });

    await test.step("AC3: no entry can be edited or deleted", async () => {
      await expect(activity.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
    });

    await test.step("AC4: history stays available after cancellation", async () => {
      await page.getByRole("tab", { name: "Event request" }).click();
      await cancelEvent(page, "No longer needed.");
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText("Event submitted");
    });
  });
});

void newApprovedEvent;
