// H4 / SCRUM-142 — the attendee's My registrations screen.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyRegistrations from "./MyRegistrations";
import { loadMyRegistrations } from "./registrationsApi";

jest.mock("./registrationsApi", () => ({ loadMyRegistrations: jest.fn() }));

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
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["First", "Second"]);
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
