// H4 / SCRUM-142 and H5 / SCRUM-143 — the attendee's My registrations screen, and
// withdrawing from an event there.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyRegistrations from "./MyRegistrations";
import { loadMyRegistrations, withdrawFromEvent } from "./registrationsApi";

jest.mock("./registrationsApi", () => ({ loadMyRegistrations: jest.fn(), withdrawFromEvent: jest.fn() }));

const entry = (changes = {}) => ({
  registration_id: "e1_attendee-1",
  event_id: "e1",
  name: "Harbour Tech Forum",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  venue_names: ["Harbour Hall", "Pier Room"],
  status: "REGISTERED",
  registered_at: "2026-11-05T04:00:00.000Z",
  withdrawn_at: null,
  waitlist_position: null,
  active: true,
  can_withdraw: true,
  ...changes
});

const rowFor = async (name) => (await screen.findByRole("heading", { name })).closest(".cs-record");

test("TC-627 H4 AC1 each registration shows the event's name, date, window, venue and the attendee's status", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  render(<MyRegistrations />);
  const row = await rowFor("Harbour Tech Forum");

  expect(within(row).getByText(/Thu, 12 Nov 2026/)).toBeInTheDocument();
  expect(within(row).getByText(/09:00 – 17:00/)).toBeInTheDocument();
  expect(within(row).getByText("Harbour Hall, Pier Room")).toBeInTheDocument();
  expect(within(row).getByText("Registered")).toHaveClass("cs-pill-positive");
});

test("TC-628 H4 AC1 AC3 Waitlisted, Withdrawn and Cancelled each read as themselves, Cancelled marked as danger", async () => {
  loadMyRegistrations.mockResolvedValue([
    entry({ registration_id: "w", event_id: "w", name: "Waiting Event", status: "WAITLISTED", waitlist_position: 2 }),
    entry({ registration_id: "x", event_id: "x", name: "Left Event", status: "WITHDRAWN" }),
    entry({ registration_id: "c", event_id: "c", name: "Called-off Event", status: "CANCELLED" })
  ]);
  render(<MyRegistrations />);

  expect(within(await rowFor("Waiting Event")).getByText("Waitlisted")).toHaveClass("cs-pill-warning");
  expect(within(await rowFor("Left Event")).getByText("Withdrawn")).toHaveClass("cs-pill-neutral");
  expect(within(await rowFor("Called-off Event")).getByText("Cancelled")).toHaveClass("cs-pill-danger");
});

test("TC-629 H4 AC1 a registration with no approved venue yet says so", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ venue_names: [] })]);
  render(<MyRegistrations />);
  expect(within(await rowFor("Harbour Tech Forum")).getByText("Venue to be confirmed")).toBeInTheDocument();
});

test("TC-629 H4 AC3 a cancelled event whose venue was released says so, rather than to be confirmed", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "CANCELLED", venue_names: [] })]);
  render(<MyRegistrations />);
  const row = await rowFor("Harbour Tech Forum");
  expect(within(row).getByText("No venue — event cancelled")).toBeInTheDocument();

  await userEvent.click(within(row).getByRole("button", { name: "View details" }));
  const details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(within(details).getByText("No venue — event cancelled")).toBeInTheDocument();
});

test("TC-630 H4 AC2 selecting an entry shows the event's details for an attendee", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  render(<MyRegistrations />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "View details" }));
  const details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(within(details).getByText("A day of talks on port technology.")).toBeInTheDocument();
  expect(within(details).getByText("Thu, 12 Nov 2026")).toBeInTheDocument();
  expect(within(details).getByText("09:00 – 17:00")).toBeInTheDocument();
  expect(within(details).getByText("Harbour Hall, Pier Room")).toBeInTheDocument();
  expect(within(details).getByText("Registered")).toBeInTheDocument();
  expect(within(details).getByText("5 Nov 2026, 12:00")).toBeInTheDocument();
});

test("TC-631 H4 AC2 a waitlisted entry's details give the place in the queue", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "WAITLISTED", waitlist_position: 2 })]);
  render(<MyRegistrations />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "View details" }));
  const details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(within(details).getByText("Waitlisted")).toBeInTheDocument();
  expect(within(details).getByText("2")).toBeInTheDocument();
});

test("TC-632 H4 AC2 AC3 a withdrawn or cancelled entry's details say so", async () => {
  loadMyRegistrations.mockResolvedValue([
    entry({ status: "WITHDRAWN", withdrawn_at: "2026-11-06T02:00:00.000Z" }),
    entry({ registration_id: "c", event_id: "c", name: "Called-off Event", status: "CANCELLED" })
  ]);
  render(<MyRegistrations />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "View details" }));
  let details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(within(details).getByText("Withdrawn")).toBeInTheDocument();
  expect(within(details).getByText("6 Nov 2026, 10:00")).toBeInTheDocument();

  await userEvent.click(within(details).getByRole("button", { name: /back to my registrations/i }));
  await userEvent.click(within(await rowFor("Called-off Event")).getByRole("button", { name: "View details" }));
  details = await screen.findByRole("region", { name: "Called-off Event" });
  expect(within(details).getByText("This event has been cancelled.")).toBeInTheDocument();
});

test("TC-633 H4 AC2 the details view hands the shell its way back, and back returns to the list", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  const onBackChange = jest.fn();
  render(<MyRegistrations onBackChange={onBackChange} />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "View details" }));
  await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(screen.queryByRole("button", { name: /back to my registrations/i })).not.toBeInTheDocument();
  const close = onBackChange.mock.calls.map(([fn]) => fn).filter(Boolean).pop();
  act(() => close());
  expect(await rowFor("Harbour Tech Forum")).toBeInTheDocument();
});

test("TC-634 H4 the list is shown in the order the service gives it", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ registration_id: "a", name: "First" }), entry({ registration_id: "b", name: "Second" })]);
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "First" });
  const upcoming = screen.getByRole("region", { name: "Upcoming" });
  expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["First", "Second"]);
});

test("TC-635 H4 with no registrations the attendee is told so", async () => {
  loadMyRegistrations.mockResolvedValue([]);
  render(<MyRegistrations />);
  expect(await screen.findByText(/you have not registered for any events yet/i)).toBeInTheDocument();
});

test("TC-636 H4 loading and a load failure are shown, not an empty list", async () => {
  let fail;
  loadMyRegistrations.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  render(<MyRegistrations />);
  expect(screen.getByText(/loading your registrations/i)).toBeInTheDocument();
  await act(async () => fail(new Error("The registration service is not responding.")));
  expect(await screen.findByRole("alert")).toHaveTextContent("The registration service is not responding.");
  expect(screen.queryByText(/have not registered/i)).not.toBeInTheDocument();
});

// ---- H5 / SCRUM-143 — Withdraw from an event ------------------------------------

const withdrawnReply = (changes = {}) => ({
  registration: { ...entry(), status: "WITHDRAWN", withdrawn_at: "2026-11-06T02:00:00.000Z", active: false, can_withdraw: false, ...changes },
  remaining_places: 4
});

const refusal = (message, reason) => Object.assign(new Error(message), { reason });

const withdrawButtonIn = async (name) => within(await rowFor(name)).getByRole("button", { name: "Withdraw" });

test("TC-664 H5 AC1 AC5 active registrations are listed under Upcoming, and the rest apart from them", async () => {
  loadMyRegistrations.mockResolvedValue([
    entry({ registration_id: "a", event_id: "a", name: "Going" }),
    entry({ registration_id: "w", event_id: "w", name: "Waiting", status: "WAITLISTED", can_withdraw: false }),
    entry({ registration_id: "x", event_id: "x", name: "Left", status: "WITHDRAWN", active: false, can_withdraw: false }),
    entry({ registration_id: "c", event_id: "c", name: "Called off", status: "CANCELLED", active: false, can_withdraw: false })
  ]);
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Going" });

  const upcoming = screen.getByRole("region", { name: "Upcoming" });
  const rest = screen.getByRole("region", { name: "Past, withdrawn and cancelled" });
  expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Going", "Waiting"]);
  expect(within(rest).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Left", "Called off"]);
});

test("TC-664 H5 AC1 with nothing upcoming the attendee is told so, and the rest still show", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "WITHDRAWN", active: false, can_withdraw: false })]);
  render(<MyRegistrations />);
  expect(await screen.findByText("You have no upcoming registrations.")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Past, withdrawn and cancelled" })).getByText("Harbour Tech Forum")).toBeInTheDocument();
});

test("TC-665 H5 AC2 AC6 Withdraw is offered only on a place the attendee can withdraw", async () => {
  loadMyRegistrations.mockResolvedValue([
    entry({ registration_id: "a", event_id: "a", name: "Going" }),
    entry({ registration_id: "w", event_id: "w", name: "Waiting", status: "WAITLISTED", can_withdraw: true }),
    entry({ registration_id: "x", event_id: "x", name: "Left", status: "WITHDRAWN", active: false, can_withdraw: false })
  ]);
  render(<MyRegistrations />);

  expect(await withdrawButtonIn("Going")).toBeInTheDocument();
  expect(await withdrawButtonIn("Waiting")).toBeInTheDocument();
  expect(within(await rowFor("Left")).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
});

test("TC-666 H5 AC2 withdrawing asks first; keeping the place changes nothing", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  render(<MyRegistrations />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  const dialog = screen.getByRole("dialog", { name: "Withdraw from Harbour Tech Forum?" });
  expect(within(dialog).getByText(/your place will be released/i)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Keep my place" })).toHaveFocus();

  await userEvent.click(within(dialog).getByRole("button", { name: "Keep my place" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(withdrawFromEvent).not.toHaveBeenCalled();
});

test("TC-667 H5 AC2 AC3 AC5 confirming withdraws, confirms it, and moves the event out of Upcoming", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  withdrawFromEvent.mockResolvedValue(withdrawnReply());
  const onNotice = jest.fn();
  render(<MyRegistrations onNotice={onNotice} />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));

  expect(withdrawFromEvent).toHaveBeenCalledWith("e1");
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You have withdrawn from Harbour Tech Forum."));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Upcoming" })).queryByText("Harbour Tech Forum")).not.toBeInTheDocument();
  const row = within(screen.getByRole("region", { name: "Past, withdrawn and cancelled" })).getByText("Harbour Tech Forum").closest(".cs-record");
  expect(within(row).getByText("Withdrawn")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
});

test("TC-668 H5 AC6 a refusal is shown in the dialog, and Withdraw is taken away when the place is not held", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  withdrawFromEvent.mockRejectedValue(refusal("You are not registered for this event.", "not_registered"));
  const onNotice = jest.fn();
  render(<MyRegistrations onNotice={onNotice} />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));

  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("You are not registered for this event.");
  expect(within(dialog).queryByRole("button", { name: "Yes, withdraw" })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(within(await rowFor("Harbour Tech Forum")).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  expect(onNotice).not.toHaveBeenCalled();
});

test("TC-669 H5 a failure that might pass on a retry leaves Withdraw to try again", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  withdrawFromEvent.mockRejectedValue(new Error(""));
  render(<MyRegistrations />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("You could not be withdrawn. Try again.");
  expect(within(dialog).getByRole("button", { name: "Yes, withdraw" })).toBeEnabled();
});

test("TC-669 H5 the confirm button cannot be pressed twice while the first is on its way", async () => {
  let finish;
  loadMyRegistrations.mockResolvedValue([entry()]);
  withdrawFromEvent.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<MyRegistrations />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));
  const busy = within(screen.getByRole("dialog")).getByRole("button", { name: "Withdrawing…" });
  expect(busy).toBeDisabled();
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep my place" })).toBeDisabled();
  await userEvent.click(busy);
  expect(withdrawFromEvent).toHaveBeenCalledTimes(1);
  await act(async () => finish(withdrawnReply()));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("TC-671 H5 AC2 the details view offers Withdraw; withdrawing there updates the details in place", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  withdrawFromEvent.mockResolvedValue(withdrawnReply());
  const onNotice = jest.fn();
  render(<MyRegistrations onNotice={onNotice} />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "View details" }));
  const details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  await userEvent.click(within(details).getByRole("button", { name: "Withdraw" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));

  expect(withdrawFromEvent).toHaveBeenCalledWith("e1");
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You have withdrawn from Harbour Tech Forum."));
  const after = screen.getByRole("region", { name: "Harbour Tech Forum" });
  expect(within(after).getByText("Withdrawn")).toBeInTheDocument();
  expect(within(after).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
});

test("TC-671 H5 AC6 the details view of a place that cannot be withdrawn offers no Withdraw", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "WITHDRAWN", active: false, can_withdraw: false })]);
  render(<MyRegistrations />);
  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "View details" }));
  const details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(within(details).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
});

test("TC-673 rows on My registrations share fixed columns, so venue and status line up", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  render(<MyRegistrations />);
  expect(await rowFor("Harbour Tech Forum")).toHaveClass("cs-record", "cs-registration-record");
});

// ---- Filters on My registrations ----------------------------------------------

const mixed = () => [
  entry({ registration_id: "a", event_id: "a", name: "Harbour Tech Forum" }),
  entry({ registration_id: "w", event_id: "w", name: "Data Summit", status: "WAITLISTED", can_withdraw: false, venue_names: ["Pier Room"] }),
  entry({ registration_id: "x", event_id: "x", name: "Coding Workshop", status: "WITHDRAWN", active: false, can_withdraw: false, venue_names: ["Woodlands Civic Function Room"] }),
  entry({ registration_id: "c", event_id: "c", name: "Winter Gala", status: "CANCELLED", active: false, can_withdraw: false, venue_names: [] })
];

const listedNames = () => screen.queryAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

test("TC-674 the Show filter offers every status, and starts on all registrations", async () => {
  loadMyRegistrations.mockResolvedValue(mixed());
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Harbour Tech Forum" });

  const show = screen.getByRole("combobox", { name: "Show" });
  expect(show).toHaveValue("all");
  expect(within(show).getAllByRole("option").map((option) => option.textContent))
    .toEqual(["All registrations", "Registered", "Waitlisted", "Withdrawn", "Cancelled"]);
  expect(listedNames()).toEqual(["Harbour Tech Forum", "Data Summit", "Coding Workshop", "Winter Gala"]);
});

test.each([
  ["REGISTERED", ["Harbour Tech Forum"]],
  ["WAITLISTED", ["Data Summit"]],
  ["WITHDRAWN", ["Coding Workshop"]],
  ["CANCELLED", ["Winter Gala"]]
])("TC-675 showing %s lists only those registrations", async (status, names) => {
  loadMyRegistrations.mockResolvedValue(mixed());
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Harbour Tech Forum" });

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Show" }), status);
  expect(listedNames()).toEqual(names);
});

test("TC-676 search matches the event name or the venue, whatever the case", async () => {
  loadMyRegistrations.mockResolvedValue(mixed());
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Harbour Tech Forum" });
  const search = screen.getByRole("searchbox", { name: "Search" });

  await userEvent.type(search, "summit");
  expect(listedNames()).toEqual(["Data Summit"]);
  await userEvent.clear(search);
  await userEvent.type(search, "WOODLANDS");
  expect(listedNames()).toEqual(["Coding Workshop"]);
  await userEvent.clear(search);
  expect(listedNames()).toHaveLength(4);
});

test("TC-677 the two filters combine", async () => {
  loadMyRegistrations.mockResolvedValue(mixed());
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Harbour Tech Forum" });

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Show" }), "REGISTERED");
  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "gala");
  expect(listedNames()).toEqual([]);
  expect(screen.getByText("No registrations match these filters.")).toBeInTheDocument();
  expect(screen.queryByText("You have no upcoming registrations.")).not.toBeInTheDocument();
});

test("TC-678 while filtering, an empty section says nothing matches rather than that there is nothing upcoming", async () => {
  loadMyRegistrations.mockResolvedValue(mixed());
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Harbour Tech Forum" });

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Show" }), "WITHDRAWN");
  expect(within(screen.getByRole("region", { name: "Upcoming" })).getByText("No upcoming registrations match these filters.")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Past, withdrawn and cancelled" })).getByText("Coding Workshop")).toBeInTheDocument();
});

test("TC-679 a filter is kept after viewing an event's details and coming back", async () => {
  loadMyRegistrations.mockResolvedValue(mixed());
  render(<MyRegistrations />);
  await screen.findByRole("heading", { name: "Harbour Tech Forum" });

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Show" }), "WAITLISTED");
  await userEvent.click(within(await rowFor("Data Summit")).getByRole("button", { name: "View details" }));
  await userEvent.click(screen.getByRole("button", { name: /back to my registrations/i }));
  expect(screen.getByRole("combobox", { name: "Show" })).toHaveValue("WAITLISTED");
  expect(listedNames()).toEqual(["Data Summit"]);
});

// ---- H6 / SCRUM-144 — the position on the waiting list -----------------------------

test("TC-709 H6 AC2 a waitlisted row gives the attendee's exact position", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "WAITLISTED", waitlist_position: 4, can_withdraw: false })]);
  render(<MyRegistrations />);
  const row = await rowFor("Harbour Tech Forum");
  expect(within(row).getByText("Position 4 on the waiting list")).toBeInTheDocument();
});

test("TC-709 H6 a row that is not waitlisted gives no position", async () => {
  loadMyRegistrations.mockResolvedValue([entry()]);
  render(<MyRegistrations />);
  expect(within(await rowFor("Harbour Tech Forum")).queryByText(/on the waiting list/)).not.toBeInTheDocument();
});

// ---- H6 — leaving the waiting list ------------------------------------------------

test("TC-714 H6 leaving the waiting list asks first, saying the place in the queue is lost", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "WAITLISTED", waitlist_position: 2 })]);
  render(<MyRegistrations />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  const dialog = screen.getByRole("dialog", { name: "Leave the waiting list for Harbour Tech Forum?" });
  expect(within(dialog).getByText(/you will lose your place in the queue/i)).toBeInTheDocument();
});

test("TC-715 H6 leaving the waiting list confirms it and moves the event out of Upcoming", async () => {
  loadMyRegistrations.mockResolvedValue([entry({ status: "WAITLISTED", waitlist_position: 2 })]);
  withdrawFromEvent.mockResolvedValue(withdrawnReply({ waitlist_position: null }));
  const onNotice = jest.fn();
  render(<MyRegistrations onNotice={onNotice} />);

  await userEvent.click(await withdrawButtonIn("Harbour Tech Forum"));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));

  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You have left the waiting list for Harbour Tech Forum."));
  const row = within(screen.getByRole("region", { name: "Past, withdrawn and cancelled" })).getByText("Harbour Tech Forum").closest(".cs-record");
  expect(within(row).getByText("Withdrawn")).toBeInTheDocument();
  expect(within(row).queryByText(/on the waiting list/)).not.toBeInTheDocument();
});
