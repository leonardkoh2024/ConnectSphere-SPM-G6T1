import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EquipmentRequestsScreen from "./EquipmentRequestsScreen";
import EquipmentQueueScreen from "./EquipmentQueueScreen";
import EquipmentRequestEditor from "./EquipmentRequestEditor";
import {
  listCoordinatorEquipmentEvents,
  listPendingEquipmentRequests,
  loadCoordinatorEquipmentEditor,
  submitEquipmentRequest
} from "./equipmentApi";

jest.mock("./equipmentApi", () => ({
  listCoordinatorEquipmentEvents: jest.fn(),
  listPendingEquipmentRequests: jest.fn(),
  loadCoordinatorEquipmentEditor: jest.fn(),
  submitEquipmentRequest: jest.fn()
}));

const event = {
  id: "event-1", name: "Partner Summit", reference_no: "EVT-001",
  event_date: "2026-11-04", start_time: "09:00", end_time: "17:00"
};

beforeEach(() => {
  jest.clearAllMocks();
  listCoordinatorEquipmentEvents.mockResolvedValue([{ ...event, equipment_request: null }]);
  loadCoordinatorEquipmentEditor.mockResolvedValue({
    event,
    request: null,
    lines: [{ equipment_type: "AUDIO", quantity: "2", technical_requirements: "Wireless microphones" }]
  });
  submitEquipmentRequest.mockResolvedValue({ ok: true, status: "PENDING" });
  listPendingEquipmentRequests.mockResolvedValue([{
    id: "event-1", event_id: "event-1", event_name: "Partner Summit",
    reference_no: "EVT-001", event_date: "2026-11-04", start_time: "09:00",
    end_time: "17:00", status: "PENDING", expected_attendance: 120,
    lines: [{ equipment_type: "AUDIO", quantity: 2, technical_requirements: "Wireless microphones" }]
  }]);
});

test("G1 coordinator can amend the prefilled organiser lines and submit them", async () => {
  const onSubmitted = jest.fn();
  await act(async () => {
    render(<EquipmentRequestEditor eventId="event-1" onCancel={jest.fn()} onSubmitted={onSubmitted} />);
    await Promise.resolve();
  });

  const requirement = await screen.findByLabelText("Technical requirements 1");
  expect(screen.getByLabelText("Equipment type 1")).toHaveValue("AUDIO");
  expect(screen.getByLabelText("Quantity 1")).toHaveValue(2);
  expect(requirement).toHaveValue("Wireless microphones");

  await userEvent.clear(requirement);
  await userEvent.type(requirement, "Two wireless handheld microphones");
  await userEvent.click(screen.getByRole("button", { name: /submit equipment request/i }));

  await waitFor(() => expect(submitEquipmentRequest).toHaveBeenCalledWith({
    eventId: "event-1",
    lines: [{
      equipment_type: "AUDIO",
      quantity: "2",
      technical_requirements: "Two wireless handheld microphones"
    }]
  }));
  expect(onSubmitted).toHaveBeenCalledTimes(1);
});

test("G1 submission is blocked until at least one valid line is present", async () => {
  loadCoordinatorEquipmentEditor.mockResolvedValue({ event, request: null, lines: [] });
  await act(async () => {
    render(<EquipmentRequestEditor eventId="event-1" onCancel={jest.fn()} onSubmitted={jest.fn()} />);
    await Promise.resolve();
  });

  await screen.findByRole("heading", { name: "Partner Summit" });
  await userEvent.click(screen.getByRole("button", { name: /remove line/i }));
  await userEvent.click(screen.getByRole("button", { name: /submit equipment request/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/at least one equipment line/i);
  expect(submitEquipmentRequest).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /add equipment line/i }));
  await userEvent.selectOptions(screen.getByLabelText("Equipment type 1"), "VISUAL");
  await userEvent.clear(screen.getByLabelText("Quantity 1"));
  await userEvent.type(screen.getByLabelText("Quantity 1"), "1.5");
  await userEvent.click(screen.getByRole("button", { name: /submit equipment request/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/whole number greater than zero/i);
  expect(submitEquipmentRequest).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText("Quantity 1"));
  await userEvent.type(screen.getByLabelText("Quantity 1"), "3");
  await userEvent.click(screen.getByRole("button", { name: /submit equipment request/i }));
  await waitFor(() => expect(submitEquipmentRequest).toHaveBeenCalled());
});

test("G1 coordinator page lists active assigned events and opens equipment management", async () => {
  let resolveEditor;
  loadCoordinatorEquipmentEditor.mockImplementation(() => new Promise((resolve) => { resolveEditor = resolve; }));
  render(<EquipmentRequestsScreen />);

  await screen.findByRole("heading", { name: "Partner Summit" });
  await userEvent.click(screen.getByRole("button", { name: /create equipment request/i }));
  await act(async () => {
    resolveEditor({ event, request: null, lines: [] });
  });
  expect(await screen.findByLabelText("Equipment request editor")).toBeInTheDocument();
  expect(loadCoordinatorEquipmentEditor).toHaveBeenCalledWith("event-1");
});

test("G1 submitted Pending requests appear in the Technical Support queue", async () => {
  render(<EquipmentQueueScreen />);

  expect(await screen.findByRole("heading", { name: "Partner Summit" })).toBeInTheDocument();
  expect(screen.getByText("Pending")).toBeInTheDocument();
  expect(screen.getByText(/audio · 2 · wireless microphones/i)).toBeInTheDocument();
  expect(screen.getByText(/expected attendance: 120/i)).toBeInTheDocument();
  expect(listPendingEquipmentRequests).toHaveBeenCalledTimes(1);
});
