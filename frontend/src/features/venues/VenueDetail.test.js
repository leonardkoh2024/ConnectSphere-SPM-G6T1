// E2 / E9 / E10 — the venue record and the shared row list used by the catalogue and the search.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueDetail, { VenueRows } from "./VenueDetail";

const hall = {
  venue_id: "VEN-001", name: "Hall A", building: "Central Tower", location: "CENTRAL", max_capacity: 500,
  facilities: ["WIFI", "POWER_POINTS"], layouts: ["U_SHAPE"], accessibility: ["STEP_FREE_ACCESS"],
  operating_hours: [{ weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" }, { weekday: "TUESDAY", opens_at: "10:00", closes_at: "16:00" }],
  setup_minutes: 30, turnaround_minutes: 15, special_space_availability: "Quiet room",
  emergency_access_notes: "Exit via Door B", known_restrictions: "No open flames"
};
const term = (name) => screen.getByText(name, { selector: "dt" }).nextSibling;

describe("normal", () => {
  test("TC-0578 E2 AC2 / E9 AC4 / E10 AC3 — the record shows every field, one line per opening day", () => {
    render(<VenueDetail venue={hall} />);
    expect(screen.getByRole("heading", { name: "Hall A" })).toBeInTheDocument();
    expect(term("Building")).toHaveTextContent("Central Tower");
    expect(term("Location")).toHaveTextContent(/^Central — /);
    expect(term("Capacity")).toHaveTextContent("500");
    expect(term("Setup time")).toHaveTextContent("30 minutes");
    expect(term("Turnaround time")).toHaveTextContent("15 minutes");
    expect(term("Headline facilities")).toHaveTextContent("WIFI, POWER POINTS");
    expect(term("Layouts")).toHaveTextContent("U SHAPE");
    expect(term("Accessibility")).toHaveTextContent("STEP FREE ACCESS");
    expect(term("Operating hours").querySelectorAll("span span")).toHaveLength(2);
    expect(term("Space availability for special requirements")).toHaveTextContent("Quiet room");
    expect(term("Emergency access notes")).toHaveTextContent("Exit via Door B");
    expect(term("Known restrictions")).toHaveTextContent("No open flames");
  });

  test("TC-0579 E2 — rows call onSelect for viewers and onUpdate for editors, and render extra actions", () => {
    const onSelect = jest.fn();
    const onUpdate = jest.fn();
    render(<VenueRows venues={[hall, { ...hall, venue_id: "VEN-002", name: "Studio" }]} onSelect={onSelect} onUpdate={onUpdate}
      canEdit={(venue) => venue.venue_id === "VEN-001"} renderActions={(venue) => <span>extra {venue.venue_id}</span>} />);
    userEvent.click(screen.getByRole("button", { name: /update venue/i }));
    userEvent.click(screen.getByRole("button", { name: /view venue/i }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ venue_id: "VEN-001" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ venue_id: "VEN-002" }));
    expect(screen.getByText("extra VEN-002")).toBeInTheDocument();
  });
});

describe("boundary", () => {
  test("TC-0580 E2 AC1 / E9 AC1 — a sparse record falls back to defaults rather than blanks", () => {
    render(<VenueDetail venue={{ venue_id: "VEN-009", name: "Bare", max_capacity: 0 }} />);
    expect(term("Building")).toHaveTextContent("Not set");
    expect(term("Location")).toHaveTextContent("Location not set");
    expect(term("Setup time")).toHaveTextContent("0 minutes");
    expect(term("Turnaround time")).toHaveTextContent("0 minutes");
    for (const name of ["Headline facilities", "Layouts", "Accessibility", "Operating hours", "Space availability for special requirements"]) {
      expect(term(name)).toHaveTextContent("None listed");
    }
    expect(term("Emergency access notes")).toHaveTextContent("None recorded");
    expect(term("Known restrictions")).toHaveTextContent("None recorded");
  });

  test("TC-0581 E2 — an unknown location code is shown as-is; an empty list says nothing matches", () => {
    const { rerender } = render(<VenueDetail venue={{ ...hall, location: "ORBIT", layouts: [undefined] }} />);
    expect(term("Location")).toHaveTextContent("ORBIT");
    expect(term("Layouts")).toHaveTextContent(/^$/);
    rerender(<VenueRows venues={[]} onSelect={jest.fn()} />);
    expect(screen.getByText(/no venues match the current criteria/i)).toBeInTheDocument();
  });

  test("TC-0582 E2 — by default rows are view-only, Update falls back to onSelect, and the open row says Close", () => {
    const onSelect = jest.fn();
    render(<VenueRows venues={[hall]} onSelect={onSelect} selectedId="VEN-001" />);
    const button = screen.getByRole("button", { name: /close/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
    userEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(within(button.closest(".cs-record")).queryByRole("region")).not.toBeInTheDocument();
  });
});
