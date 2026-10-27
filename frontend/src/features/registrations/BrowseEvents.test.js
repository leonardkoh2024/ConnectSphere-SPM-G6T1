// H2 / SCRUM-140 and H3 / SCRUM-141 — the attendee's Browse events screen: finding
// open events, and registering for one.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BrowseEvents from "./BrowseEvents";
import { loadOpenEvents, registerForEvent } from "./registrationsApi";

jest.mock("./registrationsApi", () => ({ loadOpenEvents: jest.fn(), registerForEvent: jest.fn() }));

const entry = (changes = {}) => ({
  id: "e1",
  name: "Harbour Tech Forum",
  description: "A day of talks on port technology.",
  event_date: "2026-11-12",
  start_time: "09:00",
  end_time: "17:00",
  venue_names: ["Harbour Hall", "Pier Room"],
  capacity: 150,
  remaining_places: 110,
  registration_closes_at: "2026-11-10T09:00:00.000Z",
  registration_status: null,
  ...changes
});

const rowFor = async (name) => (await screen.findByRole("heading", { name })).closest(".cs-record");

test("TC-566 each open event shows its name, description, date, window, venue and remaining places", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  expect(within(row).getByText("A day of talks on port technology.")).toBeInTheDocument();
  expect(within(row).getByText(/Thu, 12 Nov 2026/)).toBeInTheDocument();
  expect(within(row).getByText(/09:00 – 17:00/)).toBeInTheDocument();
  expect(within(row).getByText("Harbour Hall, Pier Room")).toBeInTheDocument();
  expect(within(row).getByText("110 places left")).toBeInTheDocument();
  expect(within(row).getByText(/Registration closes 10 Nov 2026, 17:00/)).toBeInTheDocument();
});

test("TC-567 a full event is listed as Full, and one without a venue yet says so", async () => {
  loadOpenEvents.mockResolvedValue([entry({ remaining_places: 0, venue_names: [] })]);
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  expect(within(row).getByText("Full")).toBeInTheDocument();
  expect(within(row).getByText("Venue to be confirmed")).toBeInTheDocument();
});

test("TC-567 an event with no description does not leave an empty line", async () => {
  loadOpenEvents.mockResolvedValue([entry({ description: "" })]);
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");
  expect(row.querySelector(".cs-browse-description")).toBeNull();
});

test("TC-568 the list is shown in the order the service gives it", async () => {
  loadOpenEvents.mockResolvedValue([entry({ id: "a", name: "First" }), entry({ id: "b", name: "Second" })]);
  render(<BrowseEvents />);
  await screen.findByRole("heading", { name: "First" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["First", "Second"]);
});

test("TC-569 with nothing open the attendee is told so", async () => {
  loadOpenEvents.mockResolvedValue([]);
  render(<BrowseEvents />);
  expect(await screen.findByText(/no events are open for registration right now/i)).toBeInTheDocument();
});

test("TC-570 a load failure is announced, not shown as an empty list", async () => {
  loadOpenEvents.mockRejectedValue(new Error("The registration service is not responding."));
  render(<BrowseEvents />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The registration service is not responding.");
  expect(screen.queryByText(/no events are open/i)).not.toBeInTheDocument();
});

test("TC-570 the list says it is loading until the reply arrives", async () => {
  let resolve;
  loadOpenEvents.mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<BrowseEvents />);
  expect(screen.getByText(/loading events/i)).toBeInTheDocument();
  await act(async () => resolve([]));
  expect(await screen.findByText(/no events are open/i)).toBeInTheDocument();
});

// ---- H3 / SCRUM-141 — Register for an event ------------------------------------

const registeredReply = (changes = {}) => ({
  registration: { registration_id: "e1_attendee-1", status: "REGISTERED", registered_at: "2026-11-05T04:00:00.000Z" },
  event: { ...entry(), remaining_places: 109, ...changes }
});

const refusal = (message, reason) => Object.assign(new Error(message), { reason });

test("TC-597 H3 AC2 an event with places left offers Register; registering calls the service for that event", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockResolvedValue(registeredReply());
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  expect(registerForEvent).toHaveBeenCalledWith("e1");
  expect(await screen.findByRole("region", { name: "Harbour Tech Forum" })).toBeInTheDocument();
});

test("TC-598 H3 AC3 a successful registration is confirmed", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockResolvedValue(registeredReply());
  const onNotice = jest.fn();
  render(<BrowseEvents onNotice={onNotice} />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "Register" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You are registered for Harbour Tech Forum."));
  expect(screen.getByRole("status")).toHaveTextContent("You are registered for this event.");
});

test("TC-599 H3 AC4 after registering, the event's details are shown, with the places left now one fewer", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockResolvedValue(registeredReply());
  render(<BrowseEvents />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "Register" }));
  const details = await screen.findByRole("region", { name: "Harbour Tech Forum" });
  expect(within(details).getByText("A day of talks on port technology.")).toBeInTheDocument();
  expect(within(details).getByText("Thu, 12 Nov 2026")).toBeInTheDocument();
  expect(within(details).getByText("09:00 – 17:00")).toBeInTheDocument();
  expect(within(details).getByText("Harbour Hall, Pier Room")).toBeInTheDocument();
  expect(within(details).getByText("109 places left")).toBeInTheDocument();
  expect(within(details).getByText("5 Nov 2026, 12:00")).toBeInTheDocument();
});

test("TC-599 H3 AC4 the details view hands the shell its way back, and back returns to the list marked Registered", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockResolvedValue(registeredReply());
  const onBackChange = jest.fn();
  render(<BrowseEvents onBackChange={onBackChange} />);

  await userEvent.click(within(await rowFor("Harbour Tech Forum")).getByRole("button", { name: "Register" }));
  await screen.findByRole("region", { name: "Harbour Tech Forum" });
  const close = onBackChange.mock.calls.map(([fn]) => fn).filter(Boolean).pop();
  expect(close).toEqual(expect.any(Function));

  act(() => close());
  const row = await rowFor("Harbour Tech Forum");
  expect(within(row).getByText("Registered")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
  expect(within(row).getByText("109 places left")).toBeInTheDocument();
});

test("TC-600 H3 AC4 AC8 an event already registered for offers View details, never Register again", async () => {
  loadOpenEvents.mockResolvedValue([entry({ registration_status: "REGISTERED" })]);
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  expect(within(row).getByText("Registered")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
  await userEvent.click(within(row).getByRole("button", { name: "View details" }));
  expect(await screen.findByRole("region", { name: "Harbour Tech Forum" })).toBeInTheDocument();
  expect(registerForEvent).not.toHaveBeenCalled();
});

test("TC-601 H3 AC5 a full event says it is full and offers no Register", async () => {
  loadOpenEvents.mockResolvedValue([entry({ remaining_places: 0 })]);
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  expect(within(row).getByText("This event is full.")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
});

test("TC-602 H3 AC5 an event that fills while the list is open says so on that row", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockRejectedValue(refusal("This event is full.", "full"));
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  expect(await within(row).findByRole("alert")).toHaveTextContent("This event is full.");
  expect(within(row).getByText("Full")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
});

test("TC-603 H3 AC6 registering after the window has closed is refused with the service's reason", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockRejectedValue(refusal("Registration has closed.", "closed"));
  const onNotice = jest.fn();
  render(<BrowseEvents onNotice={onNotice} />);
  const row = await rowFor("Harbour Tech Forum");

  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  expect(await within(row).findByRole("alert")).toHaveTextContent("Registration has closed.");
  expect(within(row).queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
  expect(onNotice).not.toHaveBeenCalled();
});

test("TC-604 H3 AC8 a duplicate refused by the service marks the row Registered", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockRejectedValue(refusal("You are already registered for this event.", "already_registered"));
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  expect(await within(row).findByRole("alert")).toHaveTextContent("You are already registered for this event.");
  expect(within(row).getByText("Registered")).toBeInTheDocument();
});

test("TC-605 H3 AC8 Register cannot be pressed twice while the first is on its way", async () => {
  let finish;
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  const busy = within(row).getByRole("button", { name: "Registering…" });
  expect(busy).toBeDisabled();
  await userEvent.click(busy);
  expect(registerForEvent).toHaveBeenCalledTimes(1);
  await act(async () => finish(registeredReply()));
  expect(await screen.findByRole("region", { name: "Harbour Tech Forum" })).toBeInTheDocument();
});

test("TC-605 a failure the service did not explain still tells the attendee, and Register can be tried again", async () => {
  loadOpenEvents.mockResolvedValue([entry()]);
  registerForEvent.mockRejectedValue(new Error(""));
  render(<BrowseEvents />);
  const row = await rowFor("Harbour Tech Forum");

  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  expect(await within(row).findByRole("alert")).toHaveTextContent("You could not be registered. Try again.");
  expect(within(row).getByRole("button", { name: "Register" })).toBeEnabled();
});
