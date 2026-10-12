import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EquipmentRequestsScreen from "./EquipmentRequestsScreen";
import EquipmentQueueScreen from "./EquipmentQueueScreen";
import EquipmentRequestEditor from "./EquipmentRequestEditor";
import EquipmentAvailabilityScreen from "./EquipmentAvailabilityScreen";
import {
  checkEquipmentAvailability,
  amendEquipmentRequestLine,
  listCoordinatorEquipmentEvents,
  listPendingEquipmentRequests,
  loadCoordinatorEquipmentEditor,
  markEquipmentLineUnableToFulfill,
  releaseEquipmentReservation,
  reserveEquipmentForEvent,
  submitEquipmentRequest
} from "./equipmentApi";

jest.mock("./equipmentApi", () => ({
  listCoordinatorEquipmentEvents: jest.fn(),
  listPendingEquipmentRequests: jest.fn(),
  checkEquipmentAvailability: jest.fn(),
  amendEquipmentRequestLine: jest.fn(),
  markEquipmentLineUnableToFulfill: jest.fn(),
  reserveEquipmentForEvent: jest.fn(),
  releaseEquipmentReservation: jest.fn(),
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
  checkEquipmentAvailability.mockResolvedValue({
    equipmentType: "AUDIO",
    heldQuantity: 10,
    reservedQuantity: 4,
    unavailableQuantity: 3,
    freeQuantity: 3,
    requestedQuantity: 5,
    shortfall: 2,
    available: false
  });
  reserveEquipmentForEvent.mockResolvedValue({
    id: "reservation-1",
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 2,
    status: "RESERVED"
  });
  releaseEquipmentReservation.mockResolvedValue({ reservationId: "reservation-1", status: "RELEASED" });
  amendEquipmentRequestLine.mockResolvedValue({ ok: true });
  markEquipmentLineUnableToFulfill.mockResolvedValue({ status: "PENDING" });
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
  expect(screen.getByText((_, element) => element.classList.contains("cs-equipment-lines-item")
    && /audio · 2 · wireless microphones · requested/i.test(element.textContent))).toBeInTheDocument();
  expect(screen.getByText(/expected attendance: 120/i)).toBeInTheDocument();
  expect(listPendingEquipmentRequests).toHaveBeenCalledTimes(1);
});

test("TC-295 Technical Support checks each requested equipment line for the event window", async () => {
  render(<EquipmentAvailabilityScreen />);

  await screen.findByRole("heading", { name: "Partner Summit" });
  await userEvent.click(screen.getByRole("button", { name: /check availability/i }));

  expect(await screen.findByText(/shortfall 2/i)).toBeInTheDocument();
  const details = screen.getByText((_, element) => element.classList.contains("cs-equipment-lines-item"));
  expect(details).toHaveTextContent(/audio · 2 · wireless microphones · 3 free of 10/i);
  const quantityInput = screen.getByLabelText("AUDIO quantity");
  expect(details.compareDocumentPosition(quantityInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(checkEquipmentAvailability).toHaveBeenCalledWith({
    equipmentType: "AUDIO",
    requestedQuantity: 2,
    eventId: "event-1",
    windowStart: "2026-11-04T09:00:00+08:00",
    windowEnd: "2026-11-04T17:00:00+08:00"
  });
});

test("TC-296 the Technical Support availability check reports missing event windows", async () => {
  listPendingEquipmentRequests.mockResolvedValue([{
    id: "event-2", event_id: "event-2", event_name: "Window missing",
    status: "PENDING",
    lines: [{ equipment_type: "AUDIO", quantity: 2, technical_requirements: "" }]
  }]);
  render(<EquipmentAvailabilityScreen />);

  await userEvent.click(await screen.findByRole("button", { name: /check availability/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/no complete event date and time window/i);
  expect(checkEquipmentAvailability).not.toHaveBeenCalled();
});

test("TC-298 Technical Support can enter a quantity and receives confirmation when equipment is reserved", async () => {
  render(<EquipmentAvailabilityScreen />);
  await screen.findByRole("heading", { name: "Partner Summit" });

  const quantity = screen.getByLabelText("AUDIO quantity");
  await userEvent.clear(quantity);
  await userEvent.type(quantity, "4");
  reserveEquipmentForEvent.mockResolvedValue({
    id: "reservation-1",
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 4,
    status: "RESERVED"
  });
  await userEvent.click(screen.getByRole("button", { name: /reserve equipment/i }));

  expect(await screen.findByText(/4 AUDIO reserved/i)).toBeInTheDocument();
  expect(reserveEquipmentForEvent).toHaveBeenCalledWith({
    eventId: "event-1",
    equipmentType: "AUDIO",
    quantity: 4,
    lineIndex: 0
  });
});

test("TC-300 quantity below one is rejected before reservation", async () => {
  render(<EquipmentAvailabilityScreen />);
  const quantity = await screen.findByLabelText("AUDIO quantity");
  await userEvent.clear(quantity);
  await userEvent.type(quantity, "0");
  await userEvent.click(screen.getByRole("button", { name: /reserve equipment/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/whole number greater than zero/i);
  expect(reserveEquipmentForEvent).not.toHaveBeenCalled();
});

test("TC-301 an unavailable quantity reports why reservation failed", async () => {
  reserveEquipmentForEvent.mockRejectedValue(new Error(
    "Requested quantity unavailable for the required time period: 1 free, 1 more needed."
  ));
  render(<EquipmentAvailabilityScreen />);
  await userEvent.click(await screen.findByRole("button", { name: /reserve equipment/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/1 free, 1 more needed/i);
});

test("TC-305 a reservation remains associated with its event until Technical Support releases it", async () => {
  listPendingEquipmentRequests.mockResolvedValue([{
    id: "event-1",
    event_id: "event-1",
    event_name: "Partner Summit",
    event_date: "2026-11-04",
    start_time: "09:00",
    end_time: "17:00",
    status: "PENDING",
    reservations: [{
      id: "reservation-1",
      event_id: "event-1",
      equipment_type: "AUDIO",
      quantity: 2,
      status: "RESERVED"
    }],
    lines: [{ equipment_type: "AUDIO", quantity: 2, technical_requirements: "" }]
  }]);
  render(<EquipmentAvailabilityScreen />);

  expect(await screen.findByRole("status")).toHaveTextContent(/reserved: 2 AUDIO for this event/i);
  await userEvent.click(screen.getByRole("button", { name: /release reservation/i }));
  expect(await screen.findByText(/reservation released/i)).toBeInTheDocument();
  expect(releaseEquipmentReservation).toHaveBeenCalledWith({ reservationId: "reservation-1" });
});

test("TC-307 Technical Support can amend a type and quantity with a note", async () => {
  render(<EquipmentAvailabilityScreen />);
  await screen.findByRole("heading", { name: "Partner Summit" });
  await userEvent.selectOptions(screen.getByLabelText("Substitute equipment type 1"), "VISUAL");
  const quantity = screen.getByLabelText("AUDIO quantity");
  await userEvent.clear(quantity);
  await userEvent.type(quantity, "3");
  await userEvent.type(screen.getByLabelText("Amendment note"), "Substitute visual equipment.");
  await userEvent.click(screen.getByRole("button", { name: /save amendment/i }));

  expect(await screen.findByText(/amendment saved and visible to the coordinator/i)).toBeInTheDocument();
  expect(amendEquipmentRequestLine).toHaveBeenCalledWith({
    eventId: "event-1",
    lineIndex: 0,
    equipmentType: "VISUAL",
    quantity: 3,
    note: "Substitute visual equipment."
  });
});

test("TC-309 Technical Support cannot resolve a line without a reason", async () => {
  render(<EquipmentAvailabilityScreen />);
  await screen.findByRole("heading", { name: "Partner Summit" });
  await userEvent.click(screen.getByRole("button", { name: /mark unable to fulfil/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);
  expect(markEquipmentLineUnableToFulfill).not.toHaveBeenCalled();
});

test("TC-311 coordinator can see support amendment and decision history", async () => {
  listCoordinatorEquipmentEvents.mockResolvedValue([{
    ...event,
    equipment_request: {
      status: "ARRANGED",
      has_support_decisions: true,
      lines: [{
        equipment_type: "VISUAL",
        quantity: 3,
        fulfillment_status: "RESOLVED",
        resolution_reason: "No compatible projector was available."
      }],
      support_history: [{
        id: "history-1",
        action: "LINE_AMENDED",
        line_index: 0,
        actor_id: "tech-1",
        created_at: new Date("2026-10-12T12:00:00.000Z"),
        old_values: { equipment_type: "AUDIO", quantity: 2 },
        new_values: { equipment_type: "VISUAL", quantity: 3 },
        note: "Substitute visual equipment."
      }, {
        id: "history-2",
        action: "LINE_UNABLE_TO_FULFILL",
        line_index: 0,
        actor_id: "tech-1",
        created_at: new Date("2026-10-12T12:01:00.000Z"),
        reason: "No compatible projector was available."
      }]
    }
  }]);
  render(<EquipmentRequestsScreen />);

  expect(await screen.findByText(/Amended line 1: AUDIO 2 → VISUAL 3/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Unable to fulfil: No compatible projector was available/i)).toHaveLength(2);
  expect(screen.getByRole("button", { name: /technical support is handling this request/i })).toBeDisabled();
});
