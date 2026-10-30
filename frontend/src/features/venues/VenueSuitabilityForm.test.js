import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueSuitabilityForm from "./VenueSuitabilityForm";

const venues = [{
  venue_id: "VEN-001",
  name: "Meeting Room",
  max_capacity: 100,
  facilities: ["WIFI"],
  accessibility: ["WHEELCHAIR_ACCESS"],
  layouts: ["THEATRE"],
  operating_hours: [{ weekday: "MONDAY", opens_at: "09:00", closes_at: "18:00" }]
}];

const event = {
  name: "Team Summit",
  event_date: "2026-10-05",
  start_time: "09:00",
  end_time: "17:00",
  expected_attendance: 100
};

test("TC-0823 the form reports a named failing criterion and shows all evaluated criteria", async () => {
  render(<VenueSuitabilityForm venues={venues} event={event} />);
  await userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
  await userEvent.clear(screen.getByLabelText("Expected attendance"));
  await userEvent.type(screen.getByLabelText("Expected attendance"), "101");
  await userEvent.click(screen.getByRole("checkbox", { name: "AIR CONDITIONING" }));
  await userEvent.click(screen.getByRole("button", { name: "Check suitability" }));

  expect(await screen.findByRole("heading", { name: "Not suitable for Meeting Room" })).toBeInTheDocument();
  expect(screen.getByText(/Fail: Attendance and capacity/i)).toBeInTheDocument();
  expect(screen.getByText(/Fail: Required facility: AIR CONDITIONING/i)).toBeInTheDocument();
  expect(screen.getByText("Criteria evaluated")).toBeInTheDocument();
  expect(screen.getByText(/Pass: Requested time within operating hours/i)).toBeInTheDocument();
});

test("TC-0824 a venue with no failing criteria is reported suitable", async () => {
  render(<VenueSuitabilityForm venues={venues} event={event} />);
  await userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
  await userEvent.click(screen.getByRole("button", { name: "Check suitability" }));

  expect(await screen.findByRole("heading", { name: "Suitable for Meeting Room" })).toBeInTheDocument();
  expect(screen.getByText(/Pass: Attendance and capacity/i)).toBeInTheDocument();
  expect(screen.getByText("No facilities required.")).toBeInTheDocument();
  expect(screen.getByText(/No accessibility features required\./i)).toBeInTheDocument();
  expect(screen.getByText(/No room layout required\./i)).toBeInTheDocument();
});

const check = () => userEvent.click(screen.getByRole("button", { name: "Check suitability" }));

describe("normal", () => {
  test("TC-0732 E7 — every requirement entered by hand is checked, and editing clears the previous result", async () => {
    render(<VenueSuitabilityForm venues={venues} />);
    expect(screen.getByLabelText("Event name")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Board day" } });
    userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
    fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Expected attendance"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:00" } });
    userEvent.selectOptions(screen.getByLabelText(/required room layout/i), "BOARDROOM");
    userEvent.click(screen.getByRole("checkbox", { name: "LIFT" }));
    check();
    const result = screen.getByRole("region", { name: "Suitability assessment" });
    expect(result).toHaveTextContent("Not suitable for Meeting Room");
    expect(result).toHaveTextContent("Fail: Accessibility feature: LIFT");
    expect(result).toHaveTextContent("BOARDROOM is not listed for this venue.");
    expect(result).toHaveTextContent("Pass: Requested time within operating hours");

    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Board day 2" } });
    expect(screen.queryByRole("region", { name: "Suitability assessment" })).not.toBeInTheDocument();
  });

  test("TC-0697 E5/E7 — embedded with shared filters, it asks only for venue, date and times and uses the shared requirements", () => {
    render(<VenueSuitabilityForm venues={venues} event={event} embedded shared={{ attendance: 50, facilities: ["WIFI"], accessibility: [], layout: "THEATRE" }} />);
    expect(screen.getByRole("region", { name: "Check venue suitability" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Check venue suitability" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Event name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Expected attendance")).not.toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
    check();
    const result = screen.getByRole("region", { name: "Suitability assessment" });
    expect(result).toHaveTextContent("Suitable for Meeting Room");
    expect(result).toHaveTextContent("100 places for 50 expected attendees.");
    expect(result).toHaveTextContent("THEATRE is supported.");
  });

  test("TC-0698 E5 — a new event resets the form and clears the result; a reference stands in for a missing name", () => {
    const { rerender } = render(<VenueSuitabilityForm venues={venues} event={event} />);
    userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
    check();
    expect(screen.getByRole("region", { name: "Suitability assessment" })).toBeInTheDocument();
    rerender(<VenueSuitabilityForm venues={venues} event={{ reference_no: "EVT-9", expected_attendance: null }} />);
    expect(screen.queryByRole("region", { name: "Suitability assessment" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("EVT-9");
    expect(screen.getByLabelText("Expected attendance")).toHaveValue(null);
    expect(screen.getByLabelText("Venue")).toHaveValue("");
  });
});

describe("boundary", () => {
  test("TC-0733 E7 AC4 — a window ending exactly at closing time passes; one minute later fails", () => {
    render(<VenueSuitabilityForm venues={venues} event={{ ...event, start_time: "09:00", end_time: "18:00" }} />);
    userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
    check();
    expect(screen.getByText(/Pass: Requested time within operating hours/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "18:01" } });
    check();
    expect(screen.getByText(/Fail: Requested time within operating hours/i)).toBeInTheDocument();
    expect(screen.getByText(/outside MONDAY operating hours \(09:00–18:00\)/)).toBeInTheDocument();
  });

  test("TC-0734 E7 — an end time before the start is reported as an invalid window", () => {
    render(<VenueSuitabilityForm venues={venues} event={{ ...event, start_time: "17:00", end_time: "09:00" }} />);
    userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
    check();
    expect(screen.getByText("The requested start and end times are missing or invalid.")).toBeInTheDocument();
  });
});

describe("failure", () => {
  test("TC-0735 E7 — without a venue chosen nothing is assessed; without a date the date is named", () => {
    render(<VenueSuitabilityForm venues={venues} event={{ ...event, event_date: "" }} />);
    check();
    expect(screen.queryByRole("region", { name: "Suitability assessment" })).not.toBeInTheDocument();
    userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
    check();
    expect(screen.getByText("The event date is missing or invalid.")).toBeInTheDocument();
  });
});
