// H2–H7 — edge and failure cases for the attendee's shared pieces: date wording,
// the registration service client, the event details card and the withdraw dialog.
import { fireEvent, render, screen } from "@testing-library/react";
import { auth } from "../../lib/firebase";
import { eventDay, singaporeDateTime, timeWindow } from "./format";
import { loadMyRegistrations, loadOpenEvents, registerForEvent } from "./registrationsApi";
import EventDetails from "./components/EventDetails";
import WithdrawDialog from "./components/WithdrawDialog";

jest.mock("../../lib/firebase", () => ({ auth: { currentUser: null }, db: {} }));

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  auth.currentUser = { uid: "attendee-1", getIdToken: jest.fn().mockResolvedValue("id-token") };
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });

describe("attendee date wording", () => {
  test("TC-1628 [boundary] a missing or malformed date or time reads as not set", () => {
    expect(eventDay("2026-11-04")).toBe("Wed, 4 Nov 2026");
    expect(eventDay(undefined)).toBe("Date not set");
    expect(eventDay("4 Nov 2026")).toBe("Date not set");
    expect(timeWindow({ start_time: "09:00" })).toBe("Time not set");
    expect(timeWindow({ start_time: "09:00", end_time: "17:00" })).toBe("09:00 – 17:00");
    // Singapore is UTC+8: 16:30 UTC is 00:30 the next day.
    expect(singaporeDateTime("2026-11-04T16:30:00.000Z")).toBe("5 Nov 2026, 00:30");
    expect(singaporeDateTime("not a time")).toBeNull();
  });
});

describe("the registration service client", () => {
  test("TC-1629 [boundary] a reply with no list reads as an empty one", async () => {
    global.fetch.mockResolvedValue(reply(200, {}));
    await expect(loadOpenEvents()).resolves.toEqual([]);
    await expect(loadMyRegistrations()).resolves.toEqual([]);
  });

  test("TC-1630 [failure] a refusal with no message or reason falls back to the action's own wording", async () => {
    global.fetch.mockResolvedValue(reply(409, null));
    await expect(registerForEvent("e1")).rejects.toMatchObject({ message: "You could not be registered. Try again.", reason: null });
  });

  test("TC-1631 [failure] nobody signed in is refused before any request", async () => {
    auth.currentUser = null;
    await expect(loadOpenEvents()).rejects.toThrow("Sign in is required.");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("the event details card and withdraw dialog", () => {
  test("TC-1632 [boundary] an event with nothing recorded shows plain wording and no extras", () => {
    render(<EventDetails entry={{}} />);
    const card = screen.getByRole("region", { name: "Untitled event" });
    expect(card).toHaveTextContent("DateDate not set");
    expect(card).toHaveTextContent("TimeTime not set");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("TC-1633 [normal] H5 clicking outside the dialog keeps the place, except while it is busy", () => {
    const onKeep = jest.fn();
    const { container, rerender } = render(<WithdrawDialog state={{}} onKeep={onKeep} onConfirm={jest.fn()} />);
    expect(screen.getByRole("heading", { name: "Withdraw from this event?" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onKeep).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.firstChild);
    expect(onKeep).toHaveBeenCalledTimes(1);
    rerender(<WithdrawDialog state={{ busy: true }} onKeep={onKeep} onConfirm={jest.fn()} />);
    fireEvent.mouseDown(container.firstChild);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
