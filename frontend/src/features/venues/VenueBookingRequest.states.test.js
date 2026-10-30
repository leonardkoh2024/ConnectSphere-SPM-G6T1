// E8 / F1 / F11 / F12 — the booking request form's remaining states: field errors, naming
// fallbacks, an in-flight request, a duplicate, and a failed save.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueBookingRequest, { BookingAcknowledgementNotice } from "./VenueBookingRequest";
import { requestVenueBooking } from "./venuesApi";

jest.mock("./venuesApi", () => ({ requestVenueBooking: jest.fn() }));

const venue = { venue_id: "VEN-1", name: "Hall A", max_capacity: 200, facilities: ["WIFI"], accessibility: [], layouts: ["THEATRE"] };
const event = { event_id: "e1", name: "Summit", expected_attendance: 80, required_layout: "THEATRE", facilities: ["WIFI"] };
const user = { uid: "coord-1" };
const send = () => screen.getByRole("button", { name: /request this venue|requesting/i });

describe("normal", () => {
  test("TC-1041 F11 — a replacement request says which booking it replaces and sends that id", async () => {
    requestVenueBooking.mockResolvedValue({ booking_id: "VB-NEW" });
    render(<VenueBookingRequest venue={venue} event={{ ...event, replacement_for_booking_id: "VB-OLD" }} user={user} />);
    expect(screen.getByRole("status")).toHaveTextContent("will replace booking VB-OLD");
    userEvent.click(send());
    expect(await screen.findByText(/booking request sent to venue staff/i)).toBeInTheDocument();
    expect(requestVenueBooking).toHaveBeenCalledWith(expect.objectContaining({ replacement_for_booking_id: "VB-OLD", event_name: "Summit" }));
    expect(screen.getByLabelText(/^booking label/i)).toBeDisabled();
  });

  test("TC-0754 E8 — the event title comes from event_name, then name, then a fallback", () => {
    const { rerender } = render(<VenueBookingRequest venue={venue} event={{ ...event, event_name: "Booking title" }} user={user} />);
    expect(screen.getByRole("heading", { name: "Suitability for Booking title" })).toBeInTheDocument();
    rerender(<VenueBookingRequest venue={venue} event={{ ...event, name: undefined }} user={user} />);
    expect(screen.getByRole("heading", { name: "Suitability for Untitled event" })).toBeInTheDocument();
  });

  test("TC-1074 F12 — a layout outside the standard list is still offered, once", () => {
    render(<VenueBookingRequest venue={venue} event={{ ...event, required_layout: "ROUND_TABLES" }} user={user} />);
    const options = [...screen.getByLabelText(/^layout for this venue/i).options].map((option) => option.value);
    expect(options.filter((value) => value === "ROUND_TABLES")).toHaveLength(1);
    expect(options[1]).toBe("ROUND_TABLES");
  });
});

describe("boundary", () => {
  test("TC-1075 F12 AC2/AC3 — blank label, attendance above the event's and no layout each name the field and block sending", () => {
    render(<VenueBookingRequest venue={venue} event={event} user={user} />);
    fireEvent.change(screen.getByLabelText(/^booking label/i), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText(/expected attendance/i), { target: { value: "81" } });
    fireEvent.change(screen.getByLabelText(/^layout for this venue/i), { target: { value: "" } });
    expect(screen.getByLabelText(/^booking label/i)).toHaveAccessibleDescription(/give this booking a label/i);
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAccessibleDescription("Expected attendance cannot be more than the event's 80.");
    expect(screen.getByLabelText(/^layout for this venue/i)).toHaveAccessibleDescription(/choose the layout/i);
    expect(send()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^booking label/i), { target: { value: "Main" } });
    fireEvent.change(screen.getByLabelText(/expected attendance/i), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText(/^layout for this venue/i), { target: { value: "THEATRE" } });
    expect(screen.getByLabelText(/expected attendance/i)).toHaveAttribute("aria-invalid", "false");
    expect(send()).toBeEnabled();
  });

  test("TC-0755 E8 — an acknowledgement with no recorded missing items lists the criterion alone", () => {
    render(<BookingAcknowledgementNotice acknowledgement={{ acknowledged: true, criteria: ["FACILITY"] }} />);
    expect(screen.getByRole("note")).toHaveTextContent("Required facilities:");
  });

  test("TC-0756 E8 — a blank facility entry on the event is listed as an unmet line rather than breaking the form", () => {
    render(<VenueBookingRequest venue={venue} event={{ ...event, facilities: [""] }} user={user} />);
    expect(document.querySelectorAll(".cs-requirement-unmet .cs-requirement-label")[0]).toHaveTextContent(/^$/);
  });
});

describe("conflict", () => {
  test("TC-0879 F1 AC4 — an existing request with no stored status still refuses a second one", () => {
    render(<VenueBookingRequest venue={venue} event={event} user={user} existingBooking={{ booking_id: "VB-1" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Summit already has a request for Hall A.");
    expect(screen.queryByRole("button", { name: /request this venue/i })).not.toBeInTheDocument();
  });

  test("TC-0880 F1 — a second press while the request is in flight sends nothing more", async () => {
    let finish;
    requestVenueBooking.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<VenueBookingRequest venue={venue} event={event} user={user} />);
    userEvent.click(send());
    expect(send()).toHaveTextContent("Requesting…");
    fireEvent.click(send());
    expect(requestVenueBooking).toHaveBeenCalledTimes(1);
    finish({});
    expect(await screen.findByText(/booking request sent/i)).toBeInTheDocument();
  });
});

describe("failure", () => {
  test("TC-0757 E8 — a save refused without a message shows the generic error and the form stays usable", async () => {
    requestVenueBooking.mockRejectedValue({});
    render(<VenueBookingRequest venue={venue} event={event} user={user} onSubmitted={jest.fn()} />);
    userEvent.click(send());
    expect(await screen.findByText("Venue booking could not be saved.")).toBeInTheDocument();
    await waitFor(() => expect(send()).toBeEnabled());
    expect(screen.queryByText(/booking request sent/i)).not.toBeInTheDocument();
  });
});
