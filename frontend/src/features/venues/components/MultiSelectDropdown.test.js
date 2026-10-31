// E4 / SCRUM-120 — the venue filter on the availability calendar: a closed
// field that opens to a list of checkboxes, so a long catalogue is not laid out
// across the page.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import MultiSelectDropdown from "./MultiSelectDropdown";

const OPTIONS = [
  { value: "VEN-002", label: "Annex" },
  { value: "VEN-001", label: "Hall A" },
  { value: "VEN-003", label: "Rooftop" }
];

function Harness({ initial = [] }) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <MultiSelectDropdown label="Venues" allLabel="All venues" pluralLabel="venues" options={OPTIONS} values={values} onChange={setValues} />
      <p>Outside</p>
    </>
  );
}

const toggle = () => screen.getByRole("button", { name: /^venues/i });

test("TC-0646 the dropdown starts closed and reads All venues", () => {
  render(<Harness />);
  expect(toggle()).toHaveTextContent("All venues");
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("TC-0647 opening it lists All venues then every option, ticked as chosen", async () => {
  render(<Harness />);
  await userEvent.click(toggle());
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("checkbox").map((box) => box.closest("label").textContent)).toEqual(["All venues", "Annex", "Hall A", "Rooftop"]);
  expect(screen.getByRole("checkbox", { name: "All venues" })).toBeChecked();
});

test("TC-0648 several options can be ticked, and the closed field summarises them", async () => {
  render(<Harness />);
  await userEvent.click(toggle());
  await userEvent.click(screen.getByRole("checkbox", { name: "Hall A" }));
  expect(toggle()).toHaveAccessibleName("Venues Hall A");
  expect(screen.getByRole("checkbox", { name: "All venues" })).not.toBeChecked();
  // Stays open, so several can be ticked in one go.
  await userEvent.click(screen.getByRole("checkbox", { name: "Rooftop" }));
  expect(toggle()).toHaveTextContent("2 venues");
  expect(screen.getByRole("checkbox", { name: "Hall A" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Rooftop" })).toBeChecked();
});

test("TC-0649 ticking All venues clears the others", async () => {
  render(<Harness initial={["VEN-001", "VEN-003"]} />);
  await userEvent.click(toggle());
  await userEvent.click(screen.getByRole("checkbox", { name: "All venues" }));
  expect(toggle()).toHaveTextContent("All venues");
  expect(screen.getByRole("checkbox", { name: "Hall A" })).not.toBeChecked();
});

test("TC-0650 Escape closes the list and returns focus to the field", async () => {
  render(<Harness />);
  await userEvent.click(toggle());
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(toggle()).toHaveFocus();
});

test("TC-0651 clicking elsewhere closes the list", async () => {
  render(<Harness />);
  await userEvent.click(toggle());
  await userEvent.click(screen.getByText("Outside"));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

describe("boundary", () => {
  test("TC-0652 E4 — a key other than Escape, or Escape while closed, leaves the field as it is", () => {
    const outer = jest.fn();
    render(<div onKeyDown={outer}><Harness /></div>);
    toggle().focus();
    userEvent.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    userEvent.click(toggle());
    userEvent.keyboard("a");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });
});
