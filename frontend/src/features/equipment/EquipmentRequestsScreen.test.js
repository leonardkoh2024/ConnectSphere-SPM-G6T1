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
    end_time: "17:00", status: "PENDING", expected_attendance: 120, coordinator_name: "Sam Tan",
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
  const requestDetails = screen.getByText("Request details").closest("details");
  expect(requestDetails).not.toHaveAttribute("open");
  await userEvent.click(screen.getByText("Request details"));
  expect(requestDetails).toHaveAttribute("open");
  expect(screen.getByText((_, element) => element.classList.contains("cs-equipment-lines-item")
    && /audio · 2 · wireless microphones · requested/i.test(element.textContent))).toBeInTheDocument();
  expect(screen.getByText(/expected attendance: 120/i)).toBeInTheDocument();
  expect(listPendingEquipmentRequests).toHaveBeenCalledTimes(1);
});

test("TC-295 Technical Support checks each requested equipment line for the event window", async () => {
  render(<EquipmentAvailabilityScreen />);

  await screen.findByRole("heading", { name: "Partner Summit" });
  await userEvent.click(screen.getByRole("button", { name: /check availability/i }));

  const requestDetails = screen.getByText("Request details").closest("details");
  expect(requestDetails).not.toHaveAttribute("open");
  await userEvent.click(screen.getByText("Request details"));
  expect(requestDetails).toHaveAttribute("open");
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
        // The equipment service records the line's type and quantity on every decision.
        equipment_type: "VISUAL",
        quantity: 3,
        reason: "No compatible projector was available."
      }]
    }
  }]);
  render(<EquipmentRequestsScreen onViewEvent={jest.fn()} />);

  // Each line once, with its own status and the reason it could not be supplied.
  const lines = await screen.findByRole("list", { name: "Requested equipment" });
  expect(lines).toHaveTextContent("Visual × 3");
  expect(lines).toHaveTextContent("Unable to fulfil");
  expect(lines).toHaveTextContent("Reason: No compatible projector was available.");
  // The request as a whole: every line refused, so not "Arranged" and not "Reserved".
  expect(screen.getByText("Unable to fulfil", { selector: ".cs-record-status .cs-pill" })).toBeInTheDocument();

  const supportUpdates = screen.getByText(/Technical Support updates/);
  expect(supportUpdates).toHaveTextContent("Technical Support updates (2)");
  expect(supportUpdates.closest("details")).not.toHaveAttribute("open");
  await userEvent.click(supportUpdates);
  expect(supportUpdates.closest("details")).toHaveAttribute("open");
  expect(screen.getByText("Amended 2 × audio → 3 × visual: Substitute visual equipment.")).toBeInTheDocument();
  expect(screen.getByText("Unable to fulfil 3 × visual: No compatible projector was available.")).toBeInTheDocument();
  // Credited to the role, never a raw user id.
  expect(screen.queryByText(/tech-1/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/^Technical Support · /)).toHaveLength(2);
});

test("TC-489 G4 a request Technical Support has finished offers View details, which opens the event", async () => {
  const onViewEvent = jest.fn();
  listCoordinatorEquipmentEvents.mockResolvedValue([{ ...event, equipment_request: arrangedRequest }]);
  render(<EquipmentRequestsScreen onViewEvent={onViewEvent} />);

  expect(await screen.findByText("Reserved", { selector: ".cs-record-status .cs-pill" })).toBeInTheDocument();
  expect(screen.queryByText(/arranged/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /technical support is handling this request/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "View details" }));
  expect(onViewEvent).toHaveBeenCalledWith("event-1");
});

test("TC-490 G4 a request Technical Support is still working on stays locked", async () => {
  listCoordinatorEquipmentEvents.mockResolvedValue([{ ...event, equipment_request: { ...arrangedRequest, status: "PENDING" } }]);
  render(<EquipmentRequestsScreen onViewEvent={jest.fn()} />);
  expect(await screen.findByRole("button", { name: /technical support is handling this request/i })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "View details" })).not.toBeInTheDocument();
});

// J6 / SCRUM-155 AC4 — TC-323, TC-341, TC-342, TC-345 in docs/test-cases.md.
test("TC-323 arriving from an outcome notification opens that event's request and updates", async () => {
  listCoordinatorEquipmentEvents.mockResolvedValue([{
    ...event,
    equipment_request: {
      status: "ARRANGED",
      has_support_decisions: true,
      lines: [{ equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" }],
      support_history: []
    }
  }]);
  render(<EquipmentRequestsScreen focusEventId="event-1" />);

  expect(await screen.findByText("2026-11-04 · 09:00–17:00")).toBeInTheDocument();
  // The quantity reserved is on the line itself; Technical Support's updates open.
  const lines = screen.getByRole("list", { name: "Requested equipment" });
  expect(lines).toHaveTextContent("Audio × 2");
  expect(lines).toHaveTextContent("Reserved");
  const disclosures = screen.getAllByRole("group");
  expect(disclosures).toHaveLength(1);
  expect(disclosures[0]).toHaveAttribute("open");
});

const arrangedRequest = {
  status: "ARRANGED",
  has_support_decisions: true,
  lines: [{ equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" }],
  support_history: []
};
const spyOnScroll = () => {
  const scrolled = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.id); };
  // jsdom has no scrollIntoView, so restoring means removing it again.
  return {
    scrolled,
    restore: () => {
      if (original) Element.prototype.scrollIntoView = original;
      else delete Element.prototype.scrollIntoView;
    }
  };
};

test("TC-341 only the named event's request opens; the others stay closed", async () => {
  listCoordinatorEquipmentEvents.mockResolvedValue([
    { ...event, equipment_request: arrangedRequest },
    { ...event, id: "event-2", name: "Board Offsite", equipment_request: arrangedRequest }
  ]);
  const { container } = render(<EquipmentRequestsScreen focusEventId="event-2" />);
  await screen.findByText("Board Offsite");

  const openState = (id) => [...container.querySelectorAll(`#equipment-request-${id} details`)].map((item) => item.open);
  expect(openState("event-1")).toEqual([false]);
  expect(openState("event-2")).toEqual([true]);
});

test("TC-342 without a named event nothing opens or scrolls, and an event with no times shows its date alone", async () => {
  const spy = spyOnScroll();
  try {
    listCoordinatorEquipmentEvents.mockResolvedValue([
      { ...event, start_time: "", end_time: "", equipment_request: arrangedRequest }
    ]);
    const { container } = render(<EquipmentRequestsScreen />);
    expect(await screen.findByText("2026-11-04")).toBeInTheDocument();
    expect([...container.querySelectorAll("details")].map((item) => item.open)).toEqual([false]);
    expect(spy.scrolled).toEqual([]);
  } finally {
    spy.restore();
  }
});

test("TC-345 the named event is scrolled into view once the list has loaded", async () => {
  const spy = spyOnScroll();
  try {
    listCoordinatorEquipmentEvents.mockResolvedValue([{ ...event, equipment_request: arrangedRequest }]);
    render(<EquipmentRequestsScreen focusEventId="event-1" />);
    await screen.findByText("Partner Summit");
    expect(spy.scrolled).toEqual(["equipment-request-event-1"]);
  } finally {
    spy.restore();
  }
});

// Technical Support see who coordinates each event, on both their screens.
// TC-390, TC-391 in docs/test-cases.md.
test("TC-390 the Equipment queue names each event's coordinator", async () => {
  render(<EquipmentQueueScreen />);
  const card = (await screen.findByRole("heading", { name: "Partner Summit" })).closest("article");
  expect(card).toHaveTextContent("Coordinator: Sam Tan");
});

test("TC-391 the Availability check names each event's coordinator, or says it is not recorded", async () => {
  listPendingEquipmentRequests.mockResolvedValue([{
    id: "event-1", event_id: "event-1", event_name: "Partner Summit", reference_no: "EVT-001",
    event_date: "2026-11-04", start_time: "09:00", end_time: "17:00", status: "PENDING", coordinator_name: null,
    lines: [{ equipment_type: "AUDIO", quantity: 2 }]
  }]);
  render(<EquipmentAvailabilityScreen />);
  const card = (await screen.findByRole("heading", { name: "Partner Summit" })).closest("article");
  expect(card).toHaveTextContent("Coordinator: Not recorded");
});
