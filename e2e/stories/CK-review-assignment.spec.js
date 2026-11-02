// Epics C and K — the Lead assigns each submitted event; its coordinator reviews it.
import { test, expect } from "@playwright/test";
import { USERS } from "../test-users.js";
import { story } from "./story.js";
import { openScreen, record, toast, sidebar } from "../helpers/app.js";
import { eventIdByReference, idTokenFor } from "../helpers/db.js";
import { as, newSubmittedEvent, assignCoordinator, openAsCoordinator, decide, newApprovedEvent } from "../helpers/flows.js";

const pill = (page) => page.locator(".cs-review-heading .cs-pill");

test.describe(...story("K1", "See newly submitted events waiting for a coordinator"), () => {
  test("a submitted event waits in the Lead's queue and nowhere else", async ({ page }) => {
    let event;
    await test.step("AC1: the organiser submits; nobody is assigned automatically", async () => {
      event = await newSubmittedEvent(page);
    });

    await test.step("AC3: the Lead's queue shows its name, date, attendance and time since submission", async () => {
      await as(page, "lead");
      await openScreen(page, "Unassigned queue");
      const row = record(page, event.name);
      await expect(row).toContainText(event.date);
      await expect(row).toContainText(`Expected ${event.attendance}`);
      await expect(row).toContainText(/Submitted (just now|\d+ min ago)/);
    });

    await test.step("AC2: a coordinator has no unassigned queue and does not see the event", async () => {
      await as(page, "coordinator");
      await expect(sidebar(page).getByRole("button", { name: "Unassigned queue", exact: true })).toHaveCount(0);
      await openScreen(page, "Review queue");
      await expect(record(page, event.name)).toHaveCount(0);
    });

    await test.step("AC4: once assigned it leaves the queue", async () => {
      await assignCoordinator(page, event);
      await expect(record(page, event.name)).toHaveCount(0);
    });
  });
});

test.describe(...story("C1", "Have submitted events assigned to a coordinator automatically"), () => {
  // Week 7 change 5 (story K1) replaced automatic assignment: the event now waits
  // for the Lead, and exactly one coordinator holds it once assigned.
  test("a submitted event is not lost while unassigned, and ends up with exactly one coordinator", async ({ page }) => {
    let event;
    await test.step("AC4: with no coordinator yet, the event is visible in the unassigned queue", async () => {
      event = await newSubmittedEvent(page);
      await as(page, "lead");
      await openScreen(page, "Unassigned queue");
      await expect(record(page, event.name)).toBeVisible();
    });

    await test.step("AC1 + AC2: once assigned, the organiser sees exactly one named coordinator", async () => {
      await assignCoordinator(page, event);
      await as(page, "organiser");
      await openScreen(page, "My events");
      await record(page, event.name).getByRole("button", { name: "View details" }).click();
      await expect(page.getByRole("region", { name: "Request decision" })).toContainText(USERS.coordinator.name);
    });
  });
});

test.describe(...story("K2", "Assign an event to a coordinator"), () => {
  test("the Lead reads the summary, picks a coordinator and assigns", async ({ page }) => {
    const event = await newSubmittedEvent(page, { purpose: "Annual town hall" });
    await as(page, "lead");
    await openScreen(page, "Unassigned queue");
    const row = record(page, event.name);

    await test.step("AC1: a read-only summary shows purpose, times, attendance and organiser", async () => {
      await row.getByRole("button", { name: "View details" }).click();
      await expect(row).toContainText("Annual town hall");
      await expect(row).toContainText(`${event.start} – ${event.end}`);
      await expect(row).toContainText(USERS.organiser.name);
    });

    await test.step("AC2: each coordinator option shows their number of active events", async () => {
      const option = row.getByRole("combobox").locator(`option[value="${USERS.coordinator.uid}"]`);
      await expect(option).toContainText(USERS.coordinator.name);
      await expect(option).toContainText(/\d+ active/);
    });

    await test.step("AC3: assigning records one coordinator", async () => {
      await row.getByRole("combobox").selectOption(USERS.coordinator.uid);
      await row.getByRole("button", { name: "Assign", exact: true }).click();
      await expect(toast(page).getByText(`Assigned to ${USERS.coordinator.name}.`)).toBeVisible();
    });

    await test.step("AC5: it can no longer be assigned from the queue, only reassigned in Oversight", async () => {
      await expect(record(page, event.name)).toHaveCount(0);
      await openScreen(page, "Oversight");
      await expect(record(page, event.name).getByRole("button", { name: "Reassign" })).toBeVisible();
    });

    await test.step("AC4: the coordinator is notified of the assignment", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
    });
  });
});

test.describe(...story("C2", "See the events I am responsible for"), () => {
  test("the coordinator's list holds only their events, with filters and sorting", async ({ page }) => {
    const mine = await newApprovedEvent(page);
    const theirs = await newSubmittedEvent(page);
    await assignCoordinator(page, theirs, "coordinator2");

    await as(page, "coordinator");
    await openScreen(page, "Assigned events");

    await test.step("AC1 + AC2: only my event is listed, with its date and status", async () => {
      await expect(record(page, mine.name)).toContainText(mine.date);
      await expect(record(page, mine.name)).toContainText(/approved/i);
      await expect(record(page, theirs.name)).toHaveCount(0);
    });

    await test.step("AC3: it can be filtered by status and sorted by date", async () => {
      // The filter offers the statuses actually present in the list.
      await page.getByLabel("Filter by status").selectOption("SUBMITTED");
      await expect(record(page, mine.name)).toHaveCount(0);
      await page.getByLabel("Filter by status").selectOption("APPROVED");
      await expect(record(page, mine.name)).toBeVisible();
      await page.getByRole("button", { name: "Sort by proposed date" }).click();
      await expect(record(page, mine.name)).toBeVisible();
    });
  });
});

test.describe(...story("C3", "Review a submitted request in full"), () => {
  test("opening a request shows everything and moves it to Under Review", async ({ page }) => {
    const event = await newSubmittedEvent(page, {
      facilities: ["WIFI"], accessibility: ["LIFT"], equipment: [{ type: "AUDIO", quantity: 2 }]
    });
    await assignCoordinator(page, event);

    await test.step("AC3: opening it moves it from Submitted to Under Review", async () => {
      await openAsCoordinator(page, event, { screen: "Review queue" });
      await expect(pill(page)).toHaveText(/under.review/i);
    });

    await test.step("AC1 + AC2: the view shows reference, organiser and every requirement", async () => {
      const detail = page.locator(".cs-review-detail");
      await expect(detail).toContainText(event.referenceNo);
      await expect(detail).toContainText(USERS.organiser.email);
      await expect(detail).toContainText(/WIFI/i);
      await expect(detail).toContainText(/LIFT/i);
      await expect(detail).toContainText(/AUDIO/i);
    });
  });
});

test.describe(...story("C4", "Request clarification or amendments from the organiser"), () => {
  test("a clarification request holds the decision until it is answered", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });

    await test.step("AC1: an empty message is refused", async () => {
      await page.getByRole("tab", { name: /Clarifications/ }).click();
      await page.getByRole("button", { name: "Request clarification" }).click();
      await page.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    });

    await test.step("AC1 + AC3: a message is sent and kept on the event", async () => {
      await page.locator(".cs-action-box textarea").fill("Please confirm the number of VIP guests.");
      await page.getByRole("button", { name: "Send request" }).click();
      await expect(toast(page).getByText("Clarification request sent.")).toBeVisible();
      await expect(page.locator(".cs-review-detail")).toContainText("Please confirm the number of VIP guests.");
    });

    await test.step("AC2 + AC4: the event stays Under Review; approve, reject and another request are unavailable", async () => {
      await expect(pill(page)).toHaveText(/under.review/i);
      await page.getByRole("tab", { name: "Event request" }).click();
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reject request" })).toHaveCount(0);
      await page.getByRole("tab", { name: /Clarifications/ }).click();
      await expect(page.getByRole("button", { name: "Request clarification" })).toHaveCount(0);
    });
  });
});

test.describe(...story("C5", "Respond to a request for clarification"), () => {
  test("the organiser answers and the coordinator can decide again", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });
    await decide(page, "clarify", "Can you move the start to 10:30?");

    await test.step("AC1: while it is open the organiser can edit the request", async () => {
      await as(page, "organiser");
      await openScreen(page, "My events");
      await record(page, event.name).getByRole("button", { name: "View details" }).click();
      await page.getByRole("tab", { name: "Event request" }).click();
      await page.locator("label.cs-field", { hasText: "Start time" }).locator("input").fill("10:30");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(toast(page).getByText("Request details updated.")).toBeVisible();
    });

    await test.step("AC2: sending a response closes the clarification", async () => {
      await page.getByRole("tab", { name: /Clarifications/ }).click();
      await page.getByLabel("Your response").fill("Done, it now starts at 10:30.");
      await page.getByRole("button", { name: "Send response" }).click();
      await expect(toast(page).getByText("Your clarification response was sent.")).toBeVisible();
      await expect(page.getByLabel("Your response")).toHaveCount(0);
    });

    await test.step("AC3: the coordinator sees the full exchange in order and can decide again", async () => {
      await openAsCoordinator(page, event, { screen: "Review queue" });
      await page.getByRole("tab", { name: /Clarifications/ }).click();
      const thread = page.locator(".cs-review-detail");
      await expect(thread).toContainText("Can you move the start to 10:30?");
      await expect(thread).toContainText("Done, it now starts at 10:30.");
      await page.getByRole("tab", { name: "Event request" }).click();
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    });
  });
});

test.describe(...story("C6", "Approve a submitted request"), () => {
  test("an Under Review request is approved with a recorded decision", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });

    await test.step("AC1: Approve is offered once the request is Under Review", async () => {
      await expect(pill(page)).toHaveText(/under.review/i);
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
    });

    await test.step("AC2: approving sets the status to Approved", async () => {
      await decide(page, "approve", "All details are complete.");
      await expect(pill(page)).toHaveText(/approved/i);
    });

    await test.step("AC3 + AC8: it cannot go further until a venue booking is in place", async () => {
      await expect(page.getByRole("button", { name: "Send for safety check" })).toBeDisabled();
      await expect(page.getByText(/This event cannot be confirmed yet. Still outstanding:/)).toBeVisible();
    });
  });
});

test.describe(...story("C7", "Reject a request with a reason"), () => {
  test("a rejection needs a reason and is final", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });

    await test.step("AC1: an empty reason is refused", async () => {
      await page.getByRole("button", { name: "Reject request" }).click();
      await page.getByRole("button", { name: "Reject event" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    await test.step("AC2: with a reason the status becomes Rejected", async () => {
      await decide(page, "reject", "No suitable venue can be secured on that date.");
      await expect(pill(page)).toHaveText(/rejected/i);
    });

    await test.step("AC3: the organiser cannot edit or resubmit it", async () => {
      await as(page, "organiser");
      await openScreen(page, "My events");
      await expect(record(page, event.name).locator(".cs-pill")).toHaveText(/rejected/i);
      await expect(record(page, event.name).getByRole("button", { name: "Edit" })).toHaveCount(0);
    });
  });
});

test.describe(...story("C8", "Understand the decision on my request"), () => {
  test("the organiser sees the decision, reason, time and coordinator", async ({ page }) => {
    const event = await newSubmittedEvent(page);
    await assignCoordinator(page, event);
    await openAsCoordinator(page, event, { screen: "Review queue" });
    await decide(page, "reject", "The date clashes with a public holiday.");

    await test.step("AC1 + AC2: the request view shows decision, reason, decision time and coordinator", async () => {
      await as(page, "organiser");
      await openScreen(page, "My events");
      await record(page, event.name).getByRole("button", { name: "View details" }).click();
      const decision = page.getByRole("region", { name: "Request decision" });
      await expect(decision).toContainText(/rejected/i);
      await expect(decision).toContainText("The date clashes with a public holiday.");
      await expect(decision).toContainText(USERS.coordinator.name);
      await expect(decision.locator("div", { hasText: "Decision time" }).locator("dd")).not.toHaveText("");
    });
  });
});

async function reassign(page, event, toKey) {
  await as(page, "lead");
  await openScreen(page, "Oversight");
  const row = record(page, event.name);
  await row.getByRole("combobox").selectOption(USERS[toKey].uid);
  await row.getByRole("button", { name: "Reassign" }).click();
  await expect(toast(page).getByText(`Reassigned to ${USERS[toKey].name}.`)).toBeVisible();
}

test.describe(...story("C9", "Reassign an event to a different coordinator"), () => {
  test("an approved event moves to another coordinator, and the first keeps a read-only view", async ({ page }) => {
    const event = await newApprovedEvent(page);

    await test.step("AC1 + AC5: the Lead reassigns it to the other coordinator", async () => {
      await reassign(page, event, "coordinator2");
    });

    await test.step("AC2: the new coordinator now holds it", async () => {
      await openAsCoordinator(page, event, { coordinatorKey: "coordinator2" });
      await expect(page.getByRole("button", { name: "Edit event" })).toBeVisible();
    });

    await test.step("AC4: the new coordinator is notified", async () => {
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
    });
  });
});

test.describe(...story("K3", "Reassign an event to another coordinator"), () => {
  test("the Lead reassigns and the outgoing coordinator loses their actions", async ({ page }) => {
    const event = await newApprovedEvent(page);

    await test.step("AC2: the current coordinator is not offered as a reassignment target", async () => {
      await as(page, "lead");
      await openScreen(page, "Oversight");
      const options = record(page, event.name).getByRole("combobox").locator("option");
      await expect(options.filter({ hasText: USERS.coordinator.name })).toHaveCount(0);
    });

    await test.step("AC1 + AC3: reassigning leaves exactly one coordinator", async () => {
      await reassign(page, event, "coordinator2");
      await expect(record(page, event.name)).toContainText(`Coordinator: ${USERS.coordinator2.name}`);
    });

    await test.step("AC4: the outgoing coordinator can no longer act on it", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Assigned events");
      const row = record(page, event.name);
      if (await row.count()) {
        await row.getByRole("button", { name: "View request" }).click();
        await expect(page.getByRole("button", { name: "Edit event" })).toHaveCount(0);
      }
    });

    await test.step("AC5: outgoing and incoming coordinators are notified", async () => {
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
      await as(page, "coordinator2");
      await openScreen(page, "Notifications");
      await expect(page.locator(".cs-panel-scroll")).toContainText(event.name);
    });
  });
});

test.describe(...story("K4", "Oversee all coordinators' assignments"), () => {
  test("the Lead sees every active event with filters and a per-coordinator count", async ({ page }) => {
    const first = await newApprovedEvent(page);
    const second = await newSubmittedEvent(page);
    await assignCoordinator(page, second, "coordinator2");
    await as(page, "lead");
    await openScreen(page, "Oversight");

    await test.step("AC1: each active event shows its coordinator, status and last activity", async () => {
      await expect(record(page, first.name)).toContainText(`Coordinator: ${USERS.coordinator.name}`);
      await expect(record(page, second.name)).toContainText(`Coordinator: ${USERS.coordinator2.name}`);
      await expect(record(page, first.name)).toContainText("Last activity");
    });

    await test.step("AC3: a summary counts active events per coordinator", async () => {
      const summary = page.getByRole("region", { name: "Active events per coordinator" });
      await expect(summary).toContainText(USERS.coordinator.name);
      await expect(summary).toContainText(/\d+ active events?/);
    });

    await test.step("AC2: filtering by coordinator narrows the list", async () => {
      await page.getByRole("combobox", { name: "Filter by coordinator" }).selectOption(USERS.coordinator2.uid);
      await expect(record(page, second.name)).toBeVisible();
      await expect(record(page, first.name)).toHaveCount(0);
    });

    await test.step("AC4: nothing on the page edits event details", async () => {
      await expect(page.getByRole("button", { name: /Edit/ })).toHaveCount(0);
    });
  });
});

test.describe(...story("K5", "Manage only the events assigned to me"), () => {
  test("a coordinator sees and acts on only their own events", async ({ page }) => {
    const theirs = await newSubmittedEvent(page);
    await assignCoordinator(page, theirs, "coordinator2");

    await test.step("AC1 + AC3: another coordinator's event is not listed or reachable", async () => {
      await as(page, "coordinator");
      await openScreen(page, "Review queue");
      await expect(record(page, theirs.name)).toHaveCount(0);
      await openScreen(page, "Assigned events");
      await expect(record(page, theirs.name)).toHaveCount(0);
    });

    await test.step("AC2: the server refuses a coordinator action on an event that is not theirs", async () => {
      const eventId = await eventIdByReference(theirs.referenceNo);
      const call = async (who) => page.request.post(`http://localhost:4000/api/events/${eventId}/registration-capacity`, {
        headers: { Authorization: `Bearer ${await idTokenFor(USERS[who])}` }, data: { capacity: 10 }
      });
      expect((await call("coordinator")).status()).toBe(403);
    });
  });
});
