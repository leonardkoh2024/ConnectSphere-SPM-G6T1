import { test, expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { logInAs } from "../helpers/login.js";

test.describe("[A3] Sign in and sign out", { tag: ["@A3", "@SCRUM-84"] }, () => {

  test("TC-717 an organiser signs in and out", async ({ page }) => {
    await test.step("AC1: signs in with their email and password", async () => {
      await logInAs(page, USERS.organiser);
    });

    await test.step("AC2: lands in their own role's workspace", async () => {
      await expect(page.getByText("Event Organiser")).toBeVisible();
      await expect(page.getByText(USERS.organiser.email)).toBeVisible();
    });

    await test.step("AC3: signs out and returns to the login page", async () => {
      await page.getByRole("button", { name: "Log out" }).click();
      await expect(page.getByRole("tab", { name: /Corporate/ })).toBeVisible();
    });
  });

  test("TC-718 an attendee cannot use the staff portal", async ({ page }) => {
    await test.step("tries to sign in on the Corporate tab", async () => {
      await page.goto("/");
      await page.getByRole("tab", { name: /Corporate/ }).click();
      await page.getByLabel("Email").fill(USERS.attendee.email);
      await page.getByLabel("Password", { exact: true }).fill(USERS.attendee.password);
      await page.getByRole("button", { name: /^Log in to/ }).click();
    });

    await test.step("is told to use the correct sign-in area", async () => {
      await expect(page.getByRole("alert")).toContainText("cannot be used in this portal");
    });
  });
});