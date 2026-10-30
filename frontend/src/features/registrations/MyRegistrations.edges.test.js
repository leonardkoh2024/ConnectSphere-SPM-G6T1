// H4 / H5 / H7 — My registrations: edges, conflicts and failures. The happy paths are
// in MyRegistrations.test.js.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyRegistrations from "./MyRegistrations";
import { acceptInvitation, declineInvitation, loadMyRegistrations, withdrawFromEvent } from "./registrationsApi";

jest.mock("./registrationsApi", () => ({ acceptInvitation: jest.fn(), declineInvitation: jest.fn(), loadMyRegistrations: jest.fn(), withdrawFromEvent: jest.fn() }));

const refusal = (reason, message = "") => Object.assign(new Error(message), { reason });
const bare = (changes = {}) => ({ registration_id: "r1", event_id: "e1", event_date: "2026-11-12", status: "REGISTERED", can_withdraw: true, ...changes });
const named = { registration_id: "r2", event_id: "e2", name: "Gala Dinner", event_date: "2026-11-20", status: "REGISTERED", can_withdraw: true };
const rowOf = async (name) => (await screen.findByRole("heading", { name })).closest(".cs-record");

beforeEach(() => jest.clearAllMocks());

test("TC-1608 [failure] a list that cannot be loaded for no stated reason says so; leaving early changes nothing", async () => {
  let settle;
  loadMyRegistrations.mockImplementation(() => new Promise((resolve, reject) => { settle = { resolve, reject }; }));
  render(<MyRegistrations />).unmount();
  await act(async () => { settle.resolve([named]); });
  render(<MyRegistrations />).unmount();
  await act(async () => { settle.reject(new Error("late")); });
  loadMyRegistrations.mockRejectedValue(new Error(""));
  render(<MyRegistrations />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your registrations could not be loaded.");
});

test("TC-1561 [boundary] H4 an unnamed event with an unknown status still lists, and search skips missing names and venues", async () => {
  loadMyRegistrations.mockResolvedValue([bare({ status: "TRANSFERRED", can_withdraw: false }), named]);
  render(<MyRegistrations />);
  const row = await rowOf("Untitled event");
  expect(within(row).getByText("TRANSFERRED")).toBeInTheDocument();
  await userEvent.type(screen.getByRole("searchbox"), "gala");
  expect(screen.queryByRole("heading", { name: "Untitled event" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Gala Dinner" })).toBeInTheDocument();
  await userEvent.clear(screen.getByRole("searchbox"));
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "View details" }));
  expect(await screen.findByRole("region", { name: "Untitled event" })).toHaveTextContent("Your registrationTRANSFERRED");
});

test.each([
  ["withdrawing", bare(), "Withdraw", "Yes, withdraw", "You have withdrawn from this event."],
  ["leaving the waiting list", bare({ status: "WAITLISTED" }), "Withdraw", "Yes, withdraw", "You have left the waiting list for this event."],
  ["declining an offer", bare({ status: "WAITLISTED", can_accept: true }), "Decline", "Yes, decline", "You have declined the place at this event and left the waiting list."]
])("TC-1609 [boundary] H5 / H7 %s an unnamed event is announced plainly, and other rows are untouched", async (_name, row, open, confirm, notice) => {
  loadMyRegistrations.mockResolvedValue([row, named]);
  withdrawFromEvent.mockResolvedValue({ registration: { status: "WITHDRAWN", can_withdraw: false } });
  declineInvitation.mockResolvedValue({ registration: { status: "WITHDRAWN", can_withdraw: false, can_accept: false } });
  const onNotice = jest.fn();
  render(<MyRegistrations onNotice={onNotice} />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: open }));
  await userEvent.click(screen.getByRole("button", { name: confirm }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith(notice));
  expect(within(await rowOf("Gala Dinner")).getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
});

test("TC-1610 [failure] H5 a withdrawal refused for no stated reason can be tried again", async () => {
  loadMyRegistrations.mockResolvedValue([bare()]);
  withdrawFromEvent.mockRejectedValue(refusal("busy"));
  render(<MyRegistrations />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Withdraw" }));
  await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("You could not be withdrawn. Try again.");
  expect(within(dialog).getByRole("button", { name: "Yes, withdraw" })).toBeEnabled();
});

test("TC-1741 [normal] H7 AC2 accepting an unnamed event's offer is announced plainly", async () => {
  loadMyRegistrations.mockResolvedValue([bare({ status: "WAITLISTED", can_accept: true })]);
  acceptInvitation.mockResolvedValue({ registration: { status: "REGISTERED", can_accept: false } });
  const onNotice = jest.fn();
  render(<MyRegistrations onNotice={onNotice} />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Accept place" }));
  await waitFor(() => expect(onNotice).toHaveBeenCalledWith("You are registered for this event."));
});

test("TC-1742 [conflict] H7 an offer no longer held cannot be accepted; a refusal without reason reads plainly", async () => {
  loadMyRegistrations.mockResolvedValue([bare({ status: "WAITLISTED", can_accept: true, invitation_active: true }), { ...named, status: "WAITLISTED", can_accept: true }]);
  acceptInvitation.mockRejectedValueOnce(refusal("not_invited", "You have no place on offer.")).mockRejectedValueOnce(refusal(undefined));
  render(<MyRegistrations />);
  await userEvent.click(within(await rowOf("Untitled event")).getByRole("button", { name: "Accept place" }));
  const row = await rowOf("Untitled event");
  expect(await within(row).findByRole("alert")).toHaveTextContent("You have no place on offer.");
  expect(within(row).queryByRole("button", { name: "Accept place" })).not.toBeInTheDocument();
  await userEvent.click(within(await rowOf("Gala Dinner")).getByRole("button", { name: "Accept place" }));
  expect(await within(await rowOf("Gala Dinner")).findByRole("alert")).toHaveTextContent("The place could not be accepted. Try again.");
});
