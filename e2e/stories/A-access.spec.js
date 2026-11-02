// Epic A — Access, identity and authorisation. A3 has its own spec.
import { test, expect } from "@playwright/test";
import { ROLES, ROLE_META } from "../../frontend/src/domain/roles.js";
import { screenHash } from "../../frontend/src/app/routes.js";
import { USERS } from "../test-users.js";
import { story } from "./story.js";
import { logInAs, logOut, openScreen, sidebar, submitEventRequest, record, uniqueName } from "../helpers/app.js";

const STRONG_PASSWORD = "e2e-Password-123";

async function openRegistration(page, portal) {
  await page.goto("/");
  await page.getByRole("tab", { name: portal === "corporate" ? /Corporate/ : /Individuals/ }).click();
  await page.getByRole("button", { name: "Create an account" }).click();
}

async function fillRegistration(page, { name, organisation, email, mobile = "91234567", password = STRONG_PASSWORD }) {
  await page.getByLabel("Full name").fill(name);
  if (organisation != null) await page.getByLabel("Organisation name").fill(organisation);
  await page.getByLabel("Mobile number").fill(mobile);
  // "Preferred contact method" offers an Email option, so the field is found by role.
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
}

const uniqueEmail = (who) => `${uniqueName(who).replace(/\s+/g, ".").toLowerCase()}@e2e.test`;

test.describe(...story("A1", "Self-register as an Event Organiser"), () => {
  test("an organiser registers, lands in the organiser workspace, and a reused email is refused", async ({ page }) => {
    const email = uniqueEmail("organiser");

    await test.step("AC1: registration captures name, organisation, email and password", async () => {
      await openRegistration(page, "corporate");
      await fillRegistration(page, { name: "New Organiser", organisation: "Acme Pte Ltd", email });
      await page.getByRole("button", { name: "Create event organiser account" }).click();
    });

    await test.step("AC2 + AC4: the account is an Event Organiser and is signed in straight away", async () => {
      await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
      await expect(page.locator(".cs-sidebar-user .cs-pill")).toHaveText("Event Organiser");
    });

    await test.step("AC3: registering the same email again gives a message that reveals nothing", async () => {
      await logOut(page);
      await openRegistration(page, "corporate");
      await fillRegistration(page, { name: "Someone Else", organisation: "Other Co", email });
      await page.getByRole("button", { name: "Create event organiser account" }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toHaveText("We could not create an account with those details. Please check them and try again.");
      await expect(alert).not.toContainText(/organiser|exists|already/i);
    });
  });
});

test.describe(...story("A2", "Register an Attendee account"), () => {
  test("an attendee registers once the details are valid", async ({ page }) => {
    await openRegistration(page, "individual");

    await test.step("AC8: a password that breaks the rules is refused with a message", async () => {
      await fillRegistration(page, { name: "New Attendee", email: uniqueEmail("attendee"), password: "no-digits-here!" });
      await page.getByRole("button", { name: "Create attendee account" }).click();
      await expect(page.getByRole("alert")).toContainText("at least 12 characters, including a number and special character");
    });

    await test.step("AC6: an invalid mobile number is refused with a message", async () => {
      await fillRegistration(page, { name: "New Attendee", email: uniqueEmail("attendee"), mobile: "12345" });
      await page.getByRole("button", { name: "Create attendee account" }).click();
      // The browser's own check stops the form here, with its message on the field.
      const mobile = page.getByLabel("Mobile number");
      expect(await mobile.evaluate((input) => input.validationMessage)).not.toBe("");
      await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
    });

    await test.step("AC1–AC4: with valid details the account is created and signed in", async () => {
      await fillRegistration(page, { name: "New Attendee", email: uniqueEmail("attendee") });
      await page.getByRole("button", { name: "Create attendee account" }).click();
      await expect(page.locator(".cs-sidebar-user .cs-pill")).toHaveText("Attendee");
    });

    await test.step("AC5: a confirmation says the account was created", async () => {
      await expect(page.getByText("Your account has been created successfully.")).toBeVisible();
    });
  });
});

test.describe(...story("A4", "See only what my role permits"), () => {
  const people = [
    ["organiser", ROLES.ORGANISER, ROLES.COORDINATOR],
    ["coordinator", ROLES.COORDINATOR, ROLES.COORDINATOR_LEAD],
    ["lead", ROLES.COORDINATOR_LEAD, ROLES.SAFETY_OFFICER],
    ["venueStaff", ROLES.VENUE_STAFF, ROLES.TECH_SUPPORT],
    ["techSupport", ROLES.TECH_SUPPORT, ROLES.VENUE_STAFF],
    ["safetyOfficer", ROLES.SAFETY_OFFICER, ROLES.COORDINATOR],
    ["attendee", ROLES.ATTENDEE, ROLES.ORGANISER]
  ];

  for (const [key, role, otherRole] of people) {
    test(`${ROLE_META[role].label} sees only their own screens and is refused another role's`, async ({ page }) => {
      await test.step("AC1: the sidebar lists exactly this role's screens", async () => {
        await logInAs(page, USERS[key]);
        const expected = ROLE_META[role].screens.filter((item) => !item.hidden).map((item) => item.name);
        await expect(sidebar(page).locator(".cs-sidebar-item .cs-sidebar-label")).toHaveText(expected);
      });

      await test.step(`AC2: opening a ${ROLE_META[otherRole].label} screen by URL is refused`, async () => {
        const target = ROLE_META[otherRole].screens[0].name;
        await page.evaluate((hash) => { window.location.hash = hash; }, screenHash(otherRole, target));
        await expect(page.getByRole("heading", { level: 1, name: "Not authorised" })).toBeVisible();
        await expect(page.getByText("You are not authorised to access this function.")).toBeVisible();
      });
    });
  }
});

test.describe(...story("A5", "See only events I am related to"), () => {
  test("one organiser never sees another organiser's event", async ({ page }) => {
    let mine;
    let theirs;

    await test.step("the other organiser submits an event", async () => {
      await logInAs(page, USERS.otherOrganiser);
      theirs = await submitEventRequest(page, { name: uniqueName("Other client event") });
      await logOut(page);
    });

    await test.step("this organiser submits one of their own", async () => {
      await logInAs(page, USERS.organiser);
      mine = await submitEventRequest(page, { name: uniqueName("My own event") });
    });

    await test.step("AC1: My events lists their own event and not the other client's", async () => {
      await openScreen(page, "My events");
      await expect(record(page, mine.name)).toBeVisible();
      await expect(record(page, theirs.name)).toHaveCount(0);
      await page.getByRole("searchbox").fill(theirs.referenceNo);
      await expect(page.getByText("No events match these filters.")).toBeVisible();
    });
  });
});

test.describe(...story("A6", "Use ConnectSphere as an Event Coordinator Lead"), () => {
  test("the Lead signs in to their own workspace", async ({ page }) => {
    await test.step("signs in with a seeded Lead account", async () => {
      await logInAs(page, USERS.lead);
      await expect(page.locator(".cs-sidebar-user .cs-pill")).toHaveText("Event Coordinator Lead");
    });

    await test.step("is offered the Lead's screens and not a coordinator's", async () => {
      await openScreen(page, "Unassigned queue");
      await openScreen(page, "Oversight");
      await expect(sidebar(page).getByRole("button", { name: "Review queue", exact: true })).toHaveCount(0);
    });
  });
});

test.describe(...story("A7", "Use ConnectSphere as a Safety Officer"), () => {
  test("the Safety Officer signs in to their own workspace", async ({ page }) => {
    await test.step("signs in with a seeded Safety Officer account", async () => {
      await logInAs(page, USERS.safetyOfficer);
      await expect(page.locator(".cs-sidebar-user .cs-pill")).toHaveText("Safety Officer");
    });

    await test.step("is offered the safety screens and nothing that edits events", async () => {
      await openScreen(page, "Safety reviews");
      await openScreen(page, "Venue safety information");
      await expect(sidebar(page).getByRole("button", { name: "Assigned events", exact: true })).toHaveCount(0);
    });
  });
});
