// E4 / SCRUM-120 — the availability calendar screen: a month view across every
// venue, narrowed by filters, with a day's hour-by-hour detail below. The rules
// are covered in domain/venueCalendar.test.js; these check what is on screen.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ROLES } from "../../domain/roles";
import VenueCalendar from "./VenueCalendar";

const at = (day, hh, mm = 0) => new Date(2026, 9, day, hh, mm).toISOString();

const hall = {
  venue_id: "VEN-001",
  name: "Hall A",
  location: "CENTRAL",
  operating_hours: [
    { weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" },
    { weekday: "TUESDAY", opens_at: "09:00", closes_at: "18:00" }
  ]
};
const annex = { venue_id: "VEN-002", name: "Annex", location: "NORTH", operating_hours: [] };

const bookings = [
  { booking_id: "b1", venue_id: "VEN-001", status: "APPROVED", event_name: "Annual Gala", start_datetime: at(12, 12), end_datetime: at(12, 14) },
  { booking_id: "p1", venue_id: "VEN-001", status: "PENDING", event_name: "Product Launch", start_datetime: at(13, 10), end_datetime: at(13, 12) },
  { booking_id: "b2", venue_id: "VEN-002", status: "APPROVED", event_name: "Board Retreat", start_datetime: at(12, 15), end_datetime: at(12, 17) }
];
const unavailability = [
  { id: "u1", venue_id: "VEN-001", start_datetime: at(12, 9), end_datetime: at(12, 11), reason: "Electrical maintenance" }
];

// Monday 12 Oct 2026.
const today = new Date(2026, 9, 12, 8, 0);

const renderCalendar = (props = {}) => render(
  <VenueCalendar
    venues={[hall, annex]}
    bookings={bookings}
    unavailability={unavailability}
    role={ROLES.COORDINATOR}
    today={today}
    {...props}
  />
);

// The Venues filter is a dropdown: open it (if it is not already) before ticking.
const venuesField = () => screen.getByRole("button", { name: /^venues/i });
const openVenues = async () => {
  if (venuesField().getAttribute("aria-expanded") !== "true") await userEvent.click(venuesField());
};
const tickVenue = async (name) => {
  await openVenues();
  await userEvent.click(screen.getByRole("checkbox", { name }));
};

const dayCell = (label) => screen.getByRole("button", { name: new RegExp(`^${label}`, "i") }).closest("td");
const detail = () => screen.getByRole("region", { name: /day detail/i });

test("TC-0657 the calendar opens on the current month across every venue", () => {
  renderCalendar();
  expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  expect(venuesField()).toHaveTextContent("All venues");
  expect(screen.queryByRole("checkbox", { name: "Hall A" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const monday = dayCell("Mon 12 Oct");
  expect(within(monday).getByText(/Hall A/, { selector: ".cs-month-chip-booked *" })).toBeInTheDocument();
  expect(within(monday).getByText(/Annex/)).toBeInTheDocument();
  expect(within(monday).getByText(/Hall A/, { selector: ".cs-month-chip-blocked *" })).toBeInTheDocument();
});

test("TC-0658 the chosen day shows each venue's free, booked and blocked time", () => {
  renderCalendar();
  expect(within(detail()).getByRole("heading", { name: /monday 12 october 2026/i })).toBeInTheDocument();
  const hallDay = within(detail()).getByRole("region", { name: "Hall A" });
  expect(within(hallDay).getByText(/open 09:00–18:00/i)).toBeInTheDocument();
  expect(within(hallDay).getByText("Annual Gala")).toBeInTheDocument();
  expect(within(hallDay).getByText("Booked")).toBeInTheDocument();
  expect(within(hallDay).getByText("Electrical maintenance")).toBeInTheDocument();
  expect(within(hallDay).getByText("Blocked")).toBeInTheDocument();
  expect(within(hallDay).getAllByText("Free").length).toBeGreaterThan(0);
  expect(screen.getByRole("list", { name: /legend/i })).toHaveTextContent(/free.*booked.*pending.*blocked.*closed/i);
});

test("TC-0659 a pending request is shown apart from approved bookings", async () => {
  renderCalendar();
  expect(dayCell("Tue 13 Oct").querySelector(".cs-month-chip-pending")).toHaveTextContent("Hall A");
  await userEvent.click(screen.getByRole("button", { name: /^tue 13 oct/i }));
  const hallDay = within(detail()).getByRole("region", { name: "Hall A" });
  expect(within(hallDay).getByText("Product Launch")).toBeInTheDocument();
  expect(within(hallDay).getByText("Pending")).toBeInTheDocument();
  expect(within(hallDay).queryByText("Booked")).not.toBeInTheDocument();
});

test("TC-0660 with one venue chosen, days it does not open are shown closed", async () => {
  renderCalendar();
  await tickVenue("Hall A");
  expect(within(dayCell("Wed 14 Oct")).getByText("Closed")).toBeInTheDocument();
  expect(within(dayCell("Mon 12 Oct")).queryByText("Closed")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^wed 14 oct/i }));
  expect(within(detail()).getByText(/closed all day/i)).toBeInTheDocument();
});

test("TC-0661 an external viewer does not see event names", () => {
  renderCalendar({ role: ROLES.ORGANISER });
  expect(screen.queryByText("Annual Gala")).not.toBeInTheDocument();
  expect(screen.queryByText("Board Retreat")).not.toBeInTheDocument();
  expect(within(within(detail()).getByRole("region", { name: "Hall A" })).getByText("Booked")).toBeInTheDocument();
});

test("TC-0662 the month steps forward and back, and Today returns", async () => {
  renderCalendar();
  await userEvent.click(screen.getByRole("button", { name: /next month/i }));
  expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /previous month/i }));
  await userEvent.click(screen.getByRole("button", { name: /previous month/i }));
  expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^today$/i }));
  expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
});

test("TC-0663 choosing venues narrows the month to them, and All venues resets", async () => {
  renderCalendar();
  await tickVenue("Annex");
  expect(venuesField()).toHaveTextContent("Annex");
  expect(screen.getByRole("checkbox", { name: "All venues" })).not.toBeChecked();
  expect(dayCell("Mon 12 Oct").querySelectorAll(".cs-month-chip")).toHaveLength(1);
  expect(within(detail()).queryByRole("region", { name: "Hall A" })).not.toBeInTheDocument();

  await tickVenue("Hall A");
  expect(dayCell("Mon 12 Oct").querySelectorAll(".cs-month-chip")).toHaveLength(3);
  expect(within(detail()).getByRole("region", { name: "Hall A" })).toBeInTheDocument();
  expect(within(detail()).getByRole("region", { name: "Annex" })).toBeInTheDocument();

  await tickVenue("Hall A");
  await tickVenue("All venues");
  expect(venuesField()).toHaveTextContent("All venues");
  expect(screen.getByRole("checkbox", { name: "Annex" })).not.toBeChecked();
});

test("TC-0664 location and kind filters narrow the month, and one action clears them", async () => {
  renderCalendar();
  await userEvent.selectOptions(screen.getByLabelText(/^location$/i), "CENTRAL");
  expect(dayCell("Mon 12 Oct").querySelectorAll(".cs-month-chip")).toHaveLength(2);
  await userEvent.click(screen.getByRole("checkbox", { name: /blocked/i }));
  expect(dayCell("Mon 12 Oct").querySelectorAll(".cs-month-chip")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
  expect(dayCell("Mon 12 Oct").querySelectorAll(".cs-month-chip")).toHaveLength(3);
  expect(screen.getByLabelText(/^location$/i)).toHaveValue("");
});

test("TC-0665 a venue with no operating hours says it has no availability data", async () => {
  renderCalendar();
  await tickVenue("Annex");
  expect(screen.getByRole("status")).toHaveTextContent(/no availability data/i);
});

test("TC-0666 a venue that cannot be found says so", () => {
  renderCalendar({ venueId: "VEN-404" });
  expect(screen.getByRole("status")).toHaveTextContent(/venue could not be found/i);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("TC-0667 the back button returns to the catalogue", async () => {
  const onBack = jest.fn();
  renderCalendar({ onBack });
  await userEvent.click(screen.getByRole("button", { name: /back to catalogue/i }));
  expect(onBack).toHaveBeenCalled();
});

test("TC-0668 a busy day shows three entries and how many more", () => {
  const busy = [9, 10, 11, 13, 14].map((hour) => ({
    booking_id: `x${hour}`, venue_id: "VEN-002", status: "APPROVED", event_name: `Session ${hour}`, start_datetime: at(15, hour), end_datetime: at(15, hour + 1)
  }));
  renderCalendar({ bookings: busy });
  const thursday = dayCell("Thu 15 Oct");
  expect(thursday.querySelectorAll(".cs-month-chip")).toHaveLength(3);
  expect(within(thursday).getByText("+2 more")).toBeInTheDocument();
});

describe("normal", () => {
  test("TC-0669 E4 — clicking anywhere in a day cell selects that day, and a lone entry is counted singular", () => {
    renderCalendar({ bookings: [bookings[1]], unavailability: [] });
    const cell = dayCell("Tue 13 Oct");
    expect(within(cell).getByRole("button")).toHaveAccessibleName("Tue 13 Oct, 1 entry");
    userEvent.click(cell);
    expect(within(cell).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  test("TC-0670 E4 — a kind turned off and back on returns in legend order", () => {
    renderCalendar();
    const blocked = screen.getByRole("checkbox", { name: /blocked/i });
    userEvent.click(blocked);
    expect(blocked).not.toBeChecked();
    userEvent.click(blocked);
    expect(blocked).toBeChecked();
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });
});

describe("boundary", () => {
  test("TC-0671 E4 — a block over the whole day reads All day; with one venue the chip names the entry", async () => {
    const allDay = { id: "u9", venue_id: "VEN-001", start_datetime: at(14, 0), end_datetime: new Date(2026, 9, 15, 0, 0).toISOString(), reason: "Blocked" };
    renderCalendar({ venueId: "VEN-001", bookings: [], unavailability: [allDay] });
    const chip = dayCell("Wed 14 Oct").querySelector(".cs-month-chip");
    expect(chip).toHaveTextContent("All day");
    expect(chip.getAttribute("title")).toMatch(/All day$/);
  });

  test("TC-0672 E4 — with no props it renders an empty month; unknown location codes and nameless venues still list", async () => {
    const empty = render(<VenueCalendar />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/no venues match these filters/i)).toBeInTheDocument();
    empty.unmount();

    const nameless = render(<VenueCalendar venues={[{ venue_id: "VEN-7", operating_hours: [] }]} today={today} />);
    expect(screen.getByRole("status")).toHaveTextContent("this venue has no operating hours recorded");
    nameless.unmount();

    renderCalendar({ venues: [hall, { venue_id: "VEN-9", location: "OUTER_RIM", operating_hours: [] }, { venue_id: "VEN-8", operating_hours: [] }] });
    expect([...screen.getByLabelText(/^location$/i).options].map((option) => option.textContent)).toContain("OUTER RIM");
    await openVenues();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(3);
  });
});
