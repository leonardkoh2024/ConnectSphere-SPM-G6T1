import { render, screen } from "@testing-library/react";
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

test("TC-115 the form reports a named failing criterion and shows all evaluated criteria", async () => {
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

test("TC-116 a venue with no failing criteria is reported suitable", async () => {
  render(<VenueSuitabilityForm venues={venues} event={event} />);
  await userEvent.selectOptions(screen.getByLabelText("Venue"), "VEN-001");
  await userEvent.click(screen.getByRole("button", { name: "Check suitability" }));

  expect(await screen.findByRole("heading", { name: "Suitable for Meeting Room" })).toBeInTheDocument();
  expect(screen.getByText(/Pass: Attendance and capacity/i)).toBeInTheDocument();
  expect(screen.getByText("No facilities required.")).toBeInTheDocument();
  expect(screen.getByText(/No accessibility features required\./i)).toBeInTheDocument();
  expect(screen.getByText(/No room layout required\./i)).toBeInTheDocument();
});
