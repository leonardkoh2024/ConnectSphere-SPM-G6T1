// H2 / H3 / H5 / H6 — Browse events: edges, conflicts and failures. The happy paths
// are in BrowseEvents.test.js.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BrowseEvents from "./BrowseEvents";
import { joinWaitlist, loadOpenEvents, registerForEvent, withdrawFromEvent } from "./registrationsApi";

jest.mock("./registrationsApi", () => ({ joinWaitlist: jest.fn(), loadOpenEvents: jest.fn(), registerForEvent: jest.fn(), withdrawFromEvent: jest.fn() }));

const refusal = (reason, message = "") => Object.assign(new Error(message), { reason });
const unnamed = (changes = {}) => ({ id: "e1", event_date: "2026-11-12", remaining_places: 5, registration_status: null, ...changes });
const other = { id: "e2", name: "Gala Dinner", event_date: "2026-11-20", remaining_places: 40, registration_status: null };
const rowOf = async (name) => (await screen.findByRole("heading", { name })).closest(".cs-record");

beforeEach(() => jest.clearAllMocks());

test("TC-1666 [failure] a list that cannot be loaded for no stated reason says so; leaving early changes nothing", async () => {
  let settle;
  loadOpenEvents.mockImplementation(() => new Promise((resolve, reject) => { settle = { resolve, reject }; }));
  render(<BrowseEvents />).unmount();
  await act(async () => { settle.resolve([other]); });
  render(<BrowseEvents />).unmount();
  await act(async () => { settle.reject(new Error("late")); });

  loadOpenEvents.mockRejectedValue(new Error(""));
  render(<BrowseEvents />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Events open for registration could not be loaded.");
});

test("TC-1515 [boundary] H3 registering for an unnamed event without a registration time leaves other rows alone", async () => {
  loadOpenEvents.mockResolvedValue([unnamed(), other]);
  registerForEvent.mockResolvedValue({ event: {} });
  const onNotice = jest.fn();
  render(<BrowseEvents onNotice={onNotice} />);
  const row = await rowOf("Untitled event");
  expect(row.querySelector(".cs-browse-description")).toBeNull();
  await userEvent.click(within(row).getByRole("button", { name: "Register" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You are registered for this event."));
  const details = await screen.findByRole("region", { name: "Untitled event" });
  expect(details).not.toHaveTextContent("Registered on");
  await userEvent.click(screen.getByRole("button", { name: "Back to browse events" }));
  expect(within(await rowOf("Gala Dinner")).getByRole("button", { name: "Register" })).toBeInTheDocument();
});

test("TC-1667 [boundary] H6 joining a full unnamed event without a position is announced plainly", async () => {
  loadOpenEvents.mockResolvedValue([unnamed({ remaining_places: 0 })]);
  joinWaitlist.mockResolvedValue({});
  const onNotice = jest.fn();
  render(<BrowseEvents onNotice={onNotice} />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Join waiting list" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You are on the waiting list for this event."));
  expect(within(await rowOf("Untitled event")).getByText("Waitlisted")).toBeInTheDocument();
});

test.each([
  ["already_registered", "Registered"],
  ["already_waitlisted", "Waitlisted"]
])("TC-1668 [conflict] H6 a join refused as %s shows the place the attendee already holds", async (reason, pill) => {
  loadOpenEvents.mockResolvedValue([unnamed({ remaining_places: 0 })]);
  joinWaitlist.mockRejectedValue(refusal(reason, "You already hold a place."));
  render(<BrowseEvents />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Join waiting list" }));
  const row = await rowOf("Untitled event");
  expect(await within(row).findByText(pill, { selector: ".cs-pill" })).toBeInTheDocument();
  expect(within(row).getByRole("alert")).toHaveTextContent("You already hold a place.");
});

test("TC-1669 [failure] a join or registration refused for no stated reason gets the action's own wording", async () => {
  loadOpenEvents.mockResolvedValue([unnamed({ remaining_places: 0 }), other]);
  joinWaitlist.mockRejectedValue(refusal(undefined));
  registerForEvent.mockRejectedValue(refusal(undefined));
  render(<BrowseEvents />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Join waiting list" }));
  expect(await within(await rowOf("Untitled event")).findByRole("alert")).toHaveTextContent("You could not join the waiting list. Try again.");
  await userEvent.click(within(await rowOf("Gala Dinner")).getByRole("button", { name: "Register" }));
  expect(await within(await rowOf("Gala Dinner")).findByRole("alert")).toHaveTextContent("You could not be registered. Try again.");
});

const openDetails = async (row) => {
  render(<BrowseEvents onNotice={row.onNotice} />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "View details" }));
  await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
};

test("TC-1603 [boundary] H5 a withdrawal reply without a count gives the place back on screen", async () => {
  loadOpenEvents.mockResolvedValue([unnamed({ registration_status: "REGISTERED", remaining_places: 5 })]);
  withdrawFromEvent.mockResolvedValue({});
  const onNotice = jest.fn();
  await openDetails({ onNotice });
  await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You have withdrawn from this event."));
  expect(within(await rowOf("Untitled event")).getByText("6 places left")).toBeInTheDocument();
});

test("TC-1670 [boundary] H6 leaving the waiting list frees no place", async () => {
  loadOpenEvents.mockResolvedValue([unnamed({ registration_status: "WAITLISTED", remaining_places: 0 })]);
  withdrawFromEvent.mockResolvedValue({});
  const onNotice = jest.fn();
  await openDetails({ onNotice });
  await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You have left the waiting list for this event."));
  expect(within(await rowOf("Untitled event")).getByRole("button", { name: "Join waiting list" })).toBeInTheDocument();
});

test("TC-1604 [failure] H5 a withdrawal refused for no stated reason can be tried again", async () => {
  loadOpenEvents.mockResolvedValue([unnamed({ registration_status: "REGISTERED" })]);
  withdrawFromEvent.mockRejectedValue(refusal("busy"));
  await openDetails({});
  await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("You could not be withdrawn. Try again.");
  expect(within(dialog).getByRole("button", { name: "Yes, withdraw" })).toBeEnabled();
});

test("TC-1671 [conflict] H6 a join refused because a place came free reloads the list, and a failed reload keeps what is shown", async () => {
  loadOpenEvents.mockResolvedValueOnce([unnamed({ remaining_places: 0 })]).mockRejectedValueOnce(new Error("offline"));
  joinWaitlist.mockRejectedValue(refusal("places_available", "A place is free: register instead."));
  render(<BrowseEvents />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Join waiting list" }));
  expect(await within(await rowOf("Untitled event")).findByRole("alert")).toHaveTextContent("A place is free: register instead.");
  await waitFor(() => expect(loadOpenEvents).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("heading", { name: "Untitled event" })).toBeInTheDocument();
});
