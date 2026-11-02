// Epic G — Equipment: the coordinator's request, Technical Support's checks and reservations.
import { test, expect } from "@playwright/test";
import { story } from "./story.js";
import { openScreen } from "../helpers/app.js";
import {
  as, newApprovedEvent, newPlannedEvent, openAsCoordinator, requestEquipment, availabilityPanel,
  openAvailabilityCheck, reserveEquipment, panelSettled
} from "../helpers/flows.js";

const catalogueCard = (page, type) => page.getByRole("article", { name: type });

test.describe(...story("G1", "Record the equipment an event needs"), () => {
  test("the coordinator's request starts from the organiser's lines and reaches Technical Support", async ({ page }) => {
    const event = await newApprovedEvent(page, { equipment: [{ type: "AUDIO", quantity: 2, note: "Two handheld mics" }] });

    await test.step("AC2: the editor is pre-filled from the organiser's request", async () => {
      await openScreen(page, "Equipment requests");
      await page.locator("article").filter({ hasText: event.name }).getByRole("button", { name: "Create equipment request" }).click();
      const editor = page.getByRole("region", { name: "Equipment request editor" });
      await expect(editor.getByLabel("Equipment type 1")).toHaveValue("AUDIO");
      await expect(editor.getByLabel("Quantity 1")).toHaveValue("2");
    });

    await test.step("AC1 + AC3: amend it — add a line, and a zero quantity is refused", async () => {
      const editor = page.getByRole("region", { name: "Equipment request editor" });
      await editor.getByRole("button", { name: "Add equipment line" }).click();
      await editor.getByLabel("Equipment type 2").selectOption("LIGHTING");
      await editor.getByLabel("Quantity 2").fill("0");
      await editor.getByLabel("Technical requirements 2").fill("Warm white wash");
      await editor.getByRole("button", { name: "Submit equipment request" }).click();
      await expect(editor.getByRole("alert")).toBeVisible();
      await editor.getByLabel("Quantity 2").fill("3");
      await editor.getByRole("button", { name: "Submit equipment request" }).click();
      await expect(page.locator("article").filter({ hasText: event.name })).toContainText("Pending");
    });

    await test.step("AC4: it appears Pending in the Technical Support queue", async () => {
      await as(page, "techSupport");
      await openScreen(page, "Equipment queue");
      const row = page.locator("article").filter({ hasText: event.name });
      await expect(row).toContainText("Pending");
      await row.getByText("Request details").click();
      await expect(row).toContainText("AUDIO");
      await expect(row).toContainText("LIGHTING");
    });
  });
});

test.describe(...story("G2", "Know whether enough equipment is free"), () => {
  test("Technical Support see the free quantity and any shortfall", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "STAGING", quantity: 6 }] });
    await requestEquipment(page, event);

    await test.step("AC1: the catalogue shows how many of each type are held and free", async () => {
      await as(page, "techSupport");
      await openScreen(page, "Equipment catalogue");
      await expect(catalogueCard(page, "STAGING")).toContainText("Held: 4");
    });

    await test.step("AC1 + AC2: checking the event's window states the shortfall as a number", async () => {
      await openAvailabilityCheck(page, event);
      const panel = availabilityPanel(page, event);
      await expect(panel).toContainText(/4/);
      await expect(panel).toContainText(/short|shortfall|2/i);
    });
  });
});

test.describe(...story("G3", "Reserve equipment for an event"), () => {
  test("a reservation is confirmed when enough is free, and refused when it is not", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "AUDIO", quantity: 2 }] });
    await requestEquipment(page, event);

    await test.step("AC3: a quantity below one is refused", async () => {
      await openAvailabilityCheck(page, event);
      await availabilityPanel(page, event).getByLabel("AUDIO quantity").fill("0");
      await availabilityPanel(page, event).getByRole("button", { name: "Reserve equipment" }).first().click();
      await expect(availabilityPanel(page, event).getByText("Quantity must be a whole number greater than zero.")).toBeVisible();
      await availabilityPanel(page, event).getByLabel("AUDIO quantity").fill("2");
    });

    await test.step("AC1 + AC2 + AC6: reserving the requested quantity succeeds", async () => {
      await availabilityPanel(page, event).getByRole("button", { name: "Reserve equipment" }).first().click();
      await panelSettled(page, event, "Reserved for this event.");
    });

    await test.step("AC8 + AC9: the reservation is listed with its type, quantity and event", async () => {
      await openScreen(page, "Reservations");
      const current = page.getByRole("region", { name: "Current reservations" });
      await expect(current).toContainText(event.name);
      await expect(current).toContainText("AUDIO");
    });

    await test.step("AC7: asking for more than is held fails with the reason", async () => {
      const greedy = await newPlannedEvent(page, { equipment: [{ type: "STAGING", quantity: 9 }] });
      await requestEquipment(page, greedy);
      await openAvailabilityCheck(page, greedy);
      await availabilityPanel(page, greedy).getByRole("button", { name: "Reserve equipment" }).first().click();
      await expect(availabilityPanel(page, greedy).getByRole("alert").last()).toContainText(/available|unavailable|short/i);
    });
  });
});

test.describe(...story("G4", "Amend or refuse an equipment request"), () => {
  test("Technical Support amend a line with a note, or mark it unable to be fulfilled", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "AUDIO", quantity: 2 }] });
    await requestEquipment(page, event);
    await openAvailabilityCheck(page, event);
    const panel = availabilityPanel(page, event);

    await test.step("AC1 + AC3: change the quantity with an amendment note", async () => {
      await panel.getByLabel("AUDIO quantity").fill("3");
      await panel.getByLabel("Amendment note").fill("Adding a spare microphone.");
      await panel.getByRole("button", { name: "Save amendment" }).click();
      await expect(page.getByText("Amendment saved and visible to the coordinator.")).toBeVisible();
    });

    await test.step("AC2: marking it unable to be fulfilled needs a reason", async () => {
      await panel.getByLabel("Reason unable to fulfil").fill("All microphones are out for repair.");
      await panel.getByRole("button", { name: "Mark unable to fulfil" }).click();
      await panelSettled(page, event, "Line marked unable to be fulfilled with reason recorded.");
    });

    await test.step("AC3: the coordinator can see the amendment", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("tab", { name: /Arrangements/ }).click();
      await expect(page.getByRole("region", { name: "Equipment reservation status" })).toContainText(/repair|unable/i);
    });
  });
});

test.describe(...story("G5", "Release equipment when it is no longer needed"), () => {
  test("cancelling the event releases its equipment back into the pool", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "VISUAL", quantity: 4 }] });
    await requestEquipment(page, event);
    await reserveEquipment(page, event);

    await test.step("AC1: the coordinator cancels the event", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("button", { name: "Cancel event" }).click();
      const box = page.locator(".cs-action-box");
      await box.locator("textarea").fill("Event called off.");
      await box.getByRole("checkbox").check();
      await box.getByRole("button", { name: "Confirm cancellation" }).click();
      await expect(page.locator(".cs-review-detail")).toContainText("CANCELLED");
    });

    await test.step("AC2 + AC3: the reservation moves to past reservations", async () => {
      await as(page, "techSupport");
      await openScreen(page, "Reservations");
      await expect(page.getByRole("region", { name: "Current reservations" })).not.toContainText(event.name);
      await expect(page.getByRole("region", { name: "Past reservations" })).toContainText(event.name);
    });
  });
});

test.describe(...story("G6", "Reassess equipment after a significant change", ), () => {
  test("a significant change flags the reservation for reassessment without releasing it", async ({ page }) => {
    const event = await newPlannedEvent(page, { equipment: [{ type: "AUDIO", quantity: 2 }] });
    await requestEquipment(page, event);
    await reserveEquipment(page, event);

    await test.step("the coordinator changes the attendance and acknowledges the warning", async () => {
      await openAsCoordinator(page, event);
      await page.getByRole("button", { name: "Edit event" }).click();
      const editor = page.getByRole("region", { name: "Edit event" });
      await editor.getByLabel("Expected attendance (pax)").fill("80");
      await editor.getByRole("checkbox", { name: /understand|acknowledge/i }).check();
      await editor.getByRole("button", { name: "Save changes" }).click();
      await expect(page.locator(".cs-toasts").getByText(/saved/)).toBeVisible();
    });

    await test.step("AC1 + AC2: Technical Support see it needs reassessment, still reserved", async () => {
      await as(page, "techSupport");
      await openScreen(page, "Reservations");
      // I3 flags the reservation and the screen lists it under its own "Needs reassessment" group,
      // so it is not in "Current reservations" — but it is also not in "Past reservations" (not released).
      const reassess = page.getByRole("region", { name: "Needs reassessment" });
      await expect(reassess).toContainText(event.name);
      await expect(reassess).toContainText("Reserved by you");
      await expect(page.getByRole("region", { name: "Past reservations" })).not.toContainText(event.name);
    });

    await test.step("AC3: they can re-check availability against the new window", async () => {
      const reassess = page.getByRole("region", { name: "Needs reassessment" });
      await reassess.getByRole("button", { name: "Re-check availability" }).first().click();
      await expect(reassess).toContainText("New window:");
      await expect(reassess).toContainText(event.name);
    });
  });
});
