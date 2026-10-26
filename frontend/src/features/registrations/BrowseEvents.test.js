// H2 / SCRUM-140 — the attendee's Browse events screen.

import { render, screen, within } from "@testing-library/react";
import BrowseEvents from "./BrowseEvents";
import { loadOpenEvents } from "./registrationsApi";

jest.mock("./registrationsApi", () => ({ loadOpenEvents: jest.fn() }));

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
  resolve([]);
  expect(await screen.findByText(/no events are open/i)).toBeInTheDocument();
});
