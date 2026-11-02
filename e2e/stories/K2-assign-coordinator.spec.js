import { test, expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { logInAs } from "../helpers/login.js";

test.describe("K2; SCRUM-xx; Assign a coordinator", { tag: ["@K2"] }, () => {
  test("TC-719 the Lead assigns a submitted event", async ({ browser }) => {
    // Each role gets its own separate browser window.
    const organiser = await (await browser.newContext()).newPage();
    const lead = await (await browser.newContext()).newPage();
    const coordinator = await (await browser.newContext()).newPage();

    await test.step("organiser submits an event", async () => {
      await logInAs(organiser, USERS.organiser);
      // TODO: fill in the event form and click Submit, using your screen's button names
    });

    await test.step("Lead sees it in the unassigned queue and assigns a coordinator", async () => {
      await logInAs(lead, USERS.lead);
      // TODO: open the queue, pick the event, choose the coordinator, confirm
    });

    await test.step("coordinator now sees the event", async () => {
      await logInAs(coordinator, USERS.coordinator);
      // TODO: expect the event's name to be visible in their list
    });
  });
});