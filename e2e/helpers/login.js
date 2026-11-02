import { expect } from "@playwright/test";

export async function logInAs(page, user) {
  await page.goto("/");
  const tab = user.portal === "corporate" ? /Corporate/ : /Individuals/;
  await page.getByRole("tab", { name: tab }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: /^Log in to/ }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
}