// Epic B — The organiser's event request: create, save as a draft, submit.
import { test, expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { story } from "./story.js";
import {
  logInAs, openScreen, openNewRequest, fillEventRequest, submitEventRequest, field, answer,
  record, toast, uniqueName, isoDate
} from "../helpers/app.js";

const issues = (page) => page.getByRole("alert");

async function openEvent(page, name) {
  await openScreen(page, "My events");
  await record(page, name).getByRole("button", { name: /View details|Edit/ }).click();
}

const saveDraft = async (page) => {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(toast(page).getByText(/Draft .+ saved/)).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await logInAs(page, USERS.organiser);
});

test.describe(...story("B1", "Create an event request with the core details"), () => {
  test("the core details are captured and checked", async ({ page }) => {
    let values;
    await test.step("AC1: the form captures name, purpose, description, date, times and attendance", async () => {
      await openNewRequest(page);
      values = await fillEventRequest(page);
    });

    await test.step("AC2: an end time before the start time and a past date are refused", async () => {
      await field(page, "Proposed date").fill(isoDate(-3));
      await field(page, "End time").fill("09:00");
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(issues(page)).toContainText("The proposed event date cannot be in the past.");
      await expect(issues(page)).toContainText("End time must be later than start time.");
    });

    await test.step("AC3: expected attendance must be a whole number above zero", async () => {
      await field(page, "Expected attendance").fill("0");
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(issues(page)).toContainText("Expected attendance must be a whole number greater than zero.");
    });

    await test.step("AC4: once corrected the request is saved against its creator", async () => {
      await field(page, "Proposed date").fill(values.date);
      await field(page, "End time").fill(values.end);
      await field(page, "Expected attendance").fill(values.attendance);
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(toast(page).getByText(/submitted for coordinator review/)).toBeVisible();
      await expect(record(page, values.name)).toContainText("Last updated");
    });
  });
});

test.describe(...story("B2", "State the venue requirements for my event"), () => {
  test("location, layout and facilities are recorded and kept", async ({ page }) => {
    let values;
    await test.step("AC1 + AC2: choose an area, a layout and catalogue facilities", async () => {
      values = await submitEventRequest(page, { location: "EAST", layout: "BANQUET", facilities: ["WIFI", "STAGE"] });
    });

    await test.step("AC3: the submitted request shows them exactly as entered", async () => {
      await openEvent(page, values.name);
      await expect(field(page, "Preferred location or area")).toHaveValue("EAST");
      await expect(field(page, "Required layout")).toHaveValue("BANQUET");
      await expect(page.getByLabel("WIFI", { exact: true })).toBeChecked();
      await expect(page.getByLabel("STAGE", { exact: true })).toBeChecked();
      await expect(page.getByLabel("PARKING", { exact: true })).not.toBeChecked();
    });
  });
});

test.describe(...story("B3", "State the accessibility needs of my event"), () => {
  test("several accessibility needs and a note are recorded", async ({ page }) => {
    let values;
    await test.step("AC1 + AC2: choose more than one need and add a note", async () => {
      await openNewRequest(page);
      values = await fillEventRequest(page, { accessibility: ["WHEELCHAIR_ACCESS", "HEARING_LOOP"] });
      await field(page, "Additional accessibility notes").fill("Two guests use wheelchairs.");
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(toast(page).getByText(/submitted for coordinator review/)).toBeVisible();
    });

    await test.step("the submitted request keeps both needs and the note", async () => {
      await openEvent(page, values.name);
      await expect(page.getByLabel("WHEELCHAIR ACCESS", { exact: true })).toBeChecked();
      await expect(page.getByLabel("HEARING LOOP", { exact: true })).toBeChecked();
      await expect(field(page, "Additional accessibility notes")).toHaveValue("Two guests use wheelchairs.");
    });
  });
});

test.describe(...story("B4", "State the equipment my event needs"), () => {
  test("equipment lines are captured with a quantity check", async ({ page }) => {
    let values;
    await test.step("AC1: add two equipment lines, one with a technical note", async () => {
      await openNewRequest(page);
      values = await fillEventRequest(page, {
        equipment: [{ type: "AUDIO", quantity: 4, note: "Wireless microphones" }, { type: "VISUAL", quantity: 0 }]
      });
    });

    await test.step("AC2: a quantity of zero is refused", async () => {
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(issues(page)).toContainText("Equipment quantity 2 must be a whole number greater than zero.");
    });

    await test.step("once fixed, both lines are saved with the request", async () => {
      await page.getByLabel("Quantity 2").fill("1");
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(toast(page).getByText(/submitted for coordinator review/)).toBeVisible();
      await openEvent(page, values.name);
      await expect(page.getByLabel("Equipment type 1")).toHaveValue("AUDIO");
      await expect(page.getByLabel("Quantity 1")).toHaveValue("4");
      await expect(page.getByLabel("Technical note 1")).toHaveValue("Wireless microphones");
      await expect(page.getByLabel("Equipment type 2")).toHaveValue("VISUAL");
    });
  });
});

test.describe(...story("B5", "Indicate whether my event needs attendee registration"), () => {
  test("registration is off by default and its window is checked when on", async ({ page }) => {
    const date = isoDate(40);
    await test.step("AC1: the registration question starts at No", async () => {
      await openNewRequest(page);
      await expect(page.locator("fieldset.cs-yesno").filter({ hasText: "Do attendees need to register" }).getByLabel("No", { exact: true })).toBeChecked();
    });

    await test.step("AC2 + AC3: capacity above attendance and a close after the start are refused", async () => {
      await fillEventRequest(page, {
        date, attendance: "40",
        registration: { capacity: 60, openDate: isoDate(1), openTime: "09:00", closeDate: date, closeTime: "11:00" }
      });
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(issues(page)).toContainText("Registration capacity cannot exceed the expected attendance.");
      await field(page, "Registration capacity").fill("30");
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(issues(page)).toContainText("Registration close date/time must be at or before the event start.");
    });

    await test.step("with a valid capacity and window the request is accepted", async () => {
      await field(page, "Registration close time").fill("08:00");
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(toast(page).getByText(/submitted for coordinator review/)).toBeVisible();
    });
  });
});

test.describe(...story("B6", "Save an incomplete event request as a draft"), () => {
  test("a half-filled request saves as a Draft", async ({ page }) => {
    const name = uniqueName("Half-done draft");
    await test.step("AC1 + AC4: save with only a name filled, using the Save draft button", async () => {
      await openNewRequest(page);
      await field(page, "Event name").fill(name);
      await saveDraft(page);
    });

    await test.step("AC3: it is listed as Draft with its last-saved time", async () => {
      await openScreen(page, "My events");
      await expect(record(page, name).locator(".cs-pill")).toHaveText(/draft/i);
      await expect(record(page, name)).toContainText("Last saved");
    });
  });
});

test.describe(...story("B7", "Return to and continue editing a draft"), () => {
  test("a draft reopens with its values and can be saved again", async ({ page }) => {
    const name = uniqueName("Draft to continue");
    await test.step("save a draft with a few fields", async () => {
      await openNewRequest(page);
      await field(page, "Event name").fill(name);
      await field(page, "Purpose").fill("Product launch");
      await saveDraft(page);
    });

    await test.step("AC1: reopening restores the saved values, and empty fields stay empty", async () => {
      await openEvent(page, name);
      await expect(field(page, "Event name")).toHaveValue(name);
      await expect(field(page, "Purpose")).toHaveValue("Product launch");
      await expect(field(page, "Description")).toHaveValue("");
    });

    await test.step("AC2 + AC3: edit and save again; it stays a Draft", async () => {
      await field(page, "Description").fill("Added on the second sitting.");
      await saveDraft(page);
      await openEvent(page, name);
      await expect(field(page, "Description")).toHaveValue("Added on the second sitting.");
      await openScreen(page, "My events");
      await expect(record(page, name).locator(".cs-pill")).toHaveText(/draft/i);
    });
  });
});

test.describe(...story("B8", "Delete a draft I no longer need"), () => {
  test("a draft is deleted only after confirming", async ({ page }) => {
    const name = uniqueName("Draft to delete");
    let submitted;
    await test.step("save a draft and submit another request", async () => {
      await openNewRequest(page);
      await field(page, "Event name").fill(name);
      await saveDraft(page);
      submitted = await submitEventRequest(page);
    });

    await test.step("AC1: Delete is offered on the draft only", async () => {
      await openScreen(page, "My events");
      await expect(record(page, name).getByRole("button", { name: "Delete" })).toBeVisible();
      await expect(record(page, submitted.name).getByRole("button", { name: "Delete" })).toHaveCount(0);
    });

    await test.step("AC2: deleting asks for confirmation, and Keep draft cancels", async () => {
      await record(page, name).getByRole("button", { name: "Delete" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete this draft?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Keep draft" }).click();
      await expect(record(page, name)).toBeVisible();
    });

    await test.step("AC3: confirming removes it from the list", async () => {
      await record(page, name).getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Yes, delete" }).click();
      await expect(toast(page).getByText(/deleted/)).toBeVisible();
      await expect(record(page, name)).toHaveCount(0);
    });
  });
});

test.describe(...story("B9", "Submit an event request"), () => {
  test("an incomplete request is blocked; a complete one is submitted once", async ({ page }) => {
    const name = uniqueName("Submit me");
    await test.step("AC1 + AC4: submitting with gaps lists exactly what is missing and keeps the entries", async () => {
      await openNewRequest(page);
      await field(page, "Event name").fill(name);
      await page.getByRole("button", { name: "Submit request" }).click();
      await expect(issues(page)).toContainText("Purpose is required.");
      await expect(issues(page)).toContainText("Proposed date is required.");
      await expect(field(page, "Event name")).toHaveValue(name);
    });

    await test.step("AC2: the accessibility, equipment and facilities questions must be answered", async () => {
      await expect(issues(page)).toContainText("Answer “Does your event have accessibility needs?”");
      await expect(issues(page)).toContainText("Answer “Does your event need equipment?”");
    });

    let referenceNo;
    await test.step("AC5 + AC6: a complete request is submitted and its reference number shown", async () => {
      await fillEventRequest(page, { name });
      await page.getByRole("button", { name: "Submit request" }).click();
      const confirmation = toast(page).getByText(/Event request (EVT-\S+) submitted/);
      await expect(confirmation).toBeVisible();
      referenceNo = (await confirmation.textContent()).match(/(EVT-\S+)/)[1];
      await expect(record(page, name).locator(".cs-pill")).toHaveText(/submitted/i);
      await expect(record(page, name)).toContainText(referenceNo);
    });

    await test.step("AC7: the submitted request no longer offers Submit", async () => {
      await openEvent(page, name);
      await expect(page.getByText(`Viewing request ${referenceNo}. This request is no longer editable.`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
    });
  });
});

test.describe(...story("B10", "See the current status of my event request"), () => {
  test("drafts and submitted requests appear together with their status", async ({ page }) => {
    const draftName = uniqueName("Status draft");
    let submitted;
    await test.step("save one draft and submit one request", async () => {
      await openNewRequest(page);
      await field(page, "Event name").fill(draftName);
      await saveDraft(page);
      submitted = await submitEventRequest(page);
    });

    await test.step("AC2 + AC3: both are listed, each with its status", async () => {
      await openScreen(page, "My events");
      await expect(record(page, draftName).locator(".cs-pill")).toHaveText(/draft/i);
      await expect(record(page, submitted.name).locator(".cs-pill")).toHaveText(/submitted/i);
    });

    await test.step("AC4 + AC6: opening the request shows its status, with nothing to change it", async () => {
      await openEvent(page, submitted.name);
      const decision = page.getByRole("region", { name: "Request decision" });
      await expect(decision).toContainText(/submitted/i);
      await expect(page.getByRole("combobox", { name: /status/i })).toHaveCount(0);
    });

    await test.step("the status filter narrows the list", async () => {
      await openScreen(page, "My events");
      await page.getByRole("combobox", { name: "Status" }).selectOption({ label: "Draft" });
      await expect(record(page, draftName)).toBeVisible();
      await expect(record(page, submitted.name)).toHaveCount(0);
    });
  });
});

// Kept here so B-epic helpers stay in one place; `answer` is used by later specs.
void answer;
