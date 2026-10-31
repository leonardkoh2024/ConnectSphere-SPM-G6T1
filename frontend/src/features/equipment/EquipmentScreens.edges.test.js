// G1 / G2 / G3 — edge, conflict and failure cases for the equipment screens. The
// happy paths are in EquipmentRequestsScreen.test.js.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EquipmentQueueScreen from "./EquipmentQueueScreen";
import EquipmentAvailabilityScreen from "./EquipmentAvailabilityScreen";
import EquipmentRequestEditor from "./EquipmentRequestEditor";
import EquipmentRequestLines from "./EquipmentRequestLines";
import EquipmentRequestsScreen from "./EquipmentRequestsScreen";
import EquipmentAvailabilityPanel from "./EquipmentAvailabilityPanel";
import {
  amendEquipmentRequestLine,
  checkEquipmentAvailability,
  markEquipmentLineUnableToFulfill,
  releaseEquipmentReservation,
  reserveEquipmentForEvent,
  listCoordinatorEquipmentEvents,
  listPendingEquipmentRequests,
  loadCoordinatorEquipmentEditor,
  submitEquipmentRequest
} from "./equipmentApi";

jest.mock("./equipmentApi", () => ({
  listCoordinatorEquipmentEvents: jest.fn(),
  listPendingEquipmentRequests: jest.fn(),
  loadCoordinatorEquipmentEditor: jest.fn(),
  submitEquipmentRequest: jest.fn(),
  checkEquipmentAvailability: jest.fn(),
  reserveEquipmentForEvent: jest.fn(),
  releaseEquipmentReservation: jest.fn(),
  amendEquipmentRequestLine: jest.fn(),
  markEquipmentLineUnableToFulfill: jest.fn()
}));

const bare = { id: "r1", event_id: "e1", status: "PENDING", lines: [{ equipment_type: "AUDIO", quantity: 1 }] };
const deferred = () => {
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  return { promise, settle };
};

beforeEach(() => jest.clearAllMocks());

describe.each([
  ["queue", EquipmentQueueScreen],
  ["availability check", EquipmentAvailabilityScreen]
])("G3 Technical Support %s", (_name, Screen) => {
  test("TC-1264 [boundary] a request with nothing recorded reads plainly", async () => {
    listPendingEquipmentRequests.mockResolvedValue([bare]);
    render(<Screen />);
    const card = (await screen.findByRole("heading", { name: "Untitled event" })).closest("article");
    expect(card).toHaveTextContent("Date not set · Time not set–Time not set");
    expect(card).toHaveTextContent("Coordinator: Not recorded");
  });

  test("TC-1265 [failure] a queue that cannot be read shows why", async () => {
    listPendingEquipmentRequests.mockRejectedValue(new Error("Only Technical Support Staff can view the equipment queue."));
    render(<Screen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only Technical Support Staff can view the equipment queue.");
  });

  test("TC-1266 [boundary] an empty queue says so", async () => {
    listPendingEquipmentRequests.mockResolvedValue([]);
    render(<Screen />);
    expect(await screen.findByText(/No pending equipment requests/)).toBeInTheDocument();
  });

  test("TC-1267 [boundary] leaving before the queue arrives, or fails, changes nothing", async () => {
    const load = deferred();
    listPendingEquipmentRequests.mockReturnValue(load.promise);
    render(<Screen />).unmount();
    await act(async () => { load.settle.resolve([bare]); });
    const failed = deferred();
    listPendingEquipmentRequests.mockReturnValue(failed.promise);
    render(<Screen />).unmount();
    await act(async () => { failed.settle.reject(new Error("late")); });
    expect(listPendingEquipmentRequests).toHaveBeenCalledTimes(2);
  });
});

test("TC-1179 [boundary] the queue shows expected attendance as not recorded when missing", async () => {
  listPendingEquipmentRequests.mockResolvedValue([bare]);
  render(<EquipmentQueueScreen />);
  expect(await screen.findByText("Expected attendance: Not recorded")).toBeInTheDocument();
});

test("TC-1180 [normal] each requested line shows its status, or the caller's own label", () => {
  const lines = [
    { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" },
    { equipment_type: "STAGING", quantity: 1, technical_requirements: "Low riser", fulfillment_status: "RESOLVED" },
    { equipment_type: "VISUAL", quantity: 1 }
  ];
  const { rerender } = render(<EquipmentRequestLines lines={lines} />);
  const items = within(screen.getByLabelText("Requested equipment")).getAllByText(/·/);
  expect(items.map((item) => item.textContent)).toEqual([
    "AUDIO · 2 · None specified · Reserved",
    "STAGING · 1 · Low riser · Unable to fulfil",
    "VISUAL · 1 · None specified · Requested"
  ]);
  rerender(<EquipmentRequestLines lines={lines} getStatus={(_line, index) => (index === 0 ? "Checked" : null)} />);
  expect(screen.getByText(/AUDIO/).closest("p")).toHaveTextContent("AUDIO · 2 · None specified · Checked");
  expect(screen.getByText(/VISUAL/).closest("p")).toHaveTextContent("Requested");
});

describe("G1 the coordinator's equipment request editor", () => {
  const open = async (result) => {
    loadCoordinatorEquipmentEditor.mockResolvedValue(result);
    const onCancel = jest.fn();
    const onSubmitted = jest.fn();
    await act(async () => { render(<EquipmentRequestEditor eventId="e1" onCancel={onCancel} onSubmitted={onSubmitted} />); });
    return { onCancel, onSubmitted };
  };

  test("TC-1181 [failure] an editor that cannot load says why and offers the way back", async () => {
    loadCoordinatorEquipmentEditor.mockRejectedValue(new Error("Only the assigned Event Coordinator can edit this request."));
    const onCancel = jest.fn();
    await act(async () => { render(<EquipmentRequestEditor eventId="e1" onCancel={onCancel} onSubmitted={jest.fn()} />); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the assigned Event Coordinator can edit this request.");
    await userEvent.click(screen.getByRole("button", { name: "Back to equipment requests" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("TC-1182 [boundary] an event with nothing recorded reads plainly, and editing one line leaves the others alone", async () => {
    await open({
      event: { id: "e1", reference_no: "EVT-9" }, request: null,
      lines: [{ equipment_type: "AUDIO", quantity: "1", technical_requirements: "" }, { equipment_type: "VISUAL", quantity: "2", technical_requirements: "" }]
    });
    expect(await screen.findByRole("heading", { name: "Untitled event" })).toBeInTheDocument();
    expect(screen.getByText("EVT-9 · Date not set · Time not set–Time not set")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Equipment type 1"), "LIGHTING");
    expect(screen.getByLabelText("Equipment type 2")).toHaveValue("VISUAL");
  });

  test("TC-1183 [failure] a refused save is shown and the editor stays open", async () => {
    submitEquipmentRequest.mockRejectedValue(new Error("This equipment request is already being handled by Technical Support and cannot be amended."));
    const { onSubmitted } = await open({
      event: { id: "e1", name: "Summit" }, request: { status: "PENDING" },
      lines: [{ equipment_type: "AUDIO", quantity: "1", technical_requirements: "" }]
    });
    await userEvent.click(await screen.findByRole("button", { name: "Submit amended request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already being handled by Technical Support/);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit amended request" })).toBeEnabled();
  });

  test("TC-1184 [boundary] a save whose result says nothing counts as notified and re-requested", async () => {
    submitEquipmentRequest.mockResolvedValue(undefined);
    const { onSubmitted } = await open({ event: { id: "e1", name: "Summit" }, request: null, lines: [{ equipment_type: "AUDIO", quantity: "1", technical_requirements: "" }] });
    await userEvent.click(await screen.findByRole("button", { name: "Submit equipment request" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ notified: true, rerequested: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit equipment request" })).toBeEnabled());
  });

  test("TC-1185 [boundary] closing the editor before it loads, or fails, changes nothing", async () => {
    const load = deferred();
    loadCoordinatorEquipmentEditor.mockReturnValue(load.promise);
    render(<EquipmentRequestEditor eventId="e1" onCancel={jest.fn()} onSubmitted={jest.fn()} />).unmount();
    await act(async () => { load.settle.resolve({ event: { id: "e1" }, request: null, lines: [] }); });
    const failed = deferred();
    loadCoordinatorEquipmentEditor.mockReturnValue(failed.promise);
    render(<EquipmentRequestEditor eventId="e1" onCancel={jest.fn()} onSubmitted={jest.fn()} />).unmount();
    await act(async () => { failed.settle.reject(new Error("late")); });
    expect(loadCoordinatorEquipmentEditor).toHaveBeenCalledTimes(2);
  });
});

describe("G1 / G4 the coordinator's equipment requests list", () => {
  const editorFor = () => loadCoordinatorEquipmentEditor.mockResolvedValue({
    event: { id: "e1", name: "Summit" }, request: null, lines: [{ equipment_type: "AUDIO", quantity: "1", technical_requirements: "" }]
  });

  test("TC-1186 [failure] a list that cannot be read shows why, with nothing listed", async () => {
    listCoordinatorEquipmentEvents.mockRejectedValue(new Error("Only an Event Coordinator can manage equipment requests."));
    render(<EquipmentRequestsScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an Event Coordinator can manage equipment requests.");
    expect(screen.getByText("No active events are assigned to you.")).toBeInTheDocument();
  });

  test("TC-1187 [boundary] sparse requests and updates still read plainly", async () => {
    listCoordinatorEquipmentEvents.mockResolvedValue([
      { id: "e1", equipment_request: { status: "PENDING", has_support_decisions: true, support_history: [
        { id: "h1", action: "LINE_RESERVED", equipment_type: "AUDIO", quantity: 1, created_at: "2026-10-20T02:00:00.000Z" },
        { id: "h2", action: "NOTE" }
      ] } },
      { id: "e2", name: "Gala", event_date: "2026-11-02", equipment_request: { status: "ARRANGED", lines: [
        { equipment_type: "STAGING", fulfillment_status: "RESOLVED", resolution_reason: "None free" },
        { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED", amendment_note: "Swapped for wireless" }
      ] } },
      { id: "e3", name: "Forum", equipment_request: { status: "PENDING", lines: [{ equipment_type: "VISUAL", technical_requirements: "HDMI" }] } }
    ]);
    render(<EquipmentRequestsScreen />);
    const first = (await screen.findByRole("heading", { name: "Untitled event" })).closest("article");
    expect(first).toHaveTextContent("Date not set");
    expect(within(first).getByRole("button", { name: "Technical Support is handling this request" })).toBeDisabled();
    expect(first).toHaveTextContent("Technical Support updates (2)");
    expect(first).toHaveTextContent("Technical Support · Time not recorded");
    const second = screen.getByRole("heading", { name: "Gala" }).closest("article");
    expect(second).toHaveTextContent("Staging × 1Unable to fulfilReason: None free");
    expect(second).toHaveTextContent("Audio × 2ReservedSupport note: Swapped for wireless");
    // Finished, but with nowhere to open it: the button stays locked.
    expect(within(second).getByRole("button", { name: "Technical Support is handling this request" })).toBeDisabled();
    const third = screen.getByRole("heading", { name: "Forum" }).closest("article");
    expect(third).toHaveTextContent("Visual × 1RequestedHDMI");
    expect(within(third).getByRole("button", { name: "Edit equipment request" })).toBeEnabled();
  });

  test("TC-1188 [normal] cancelling the editor returns to the list without saving", async () => {
    listCoordinatorEquipmentEvents.mockResolvedValue([{ id: "e1", name: "Summit", equipment_request: null }]);
    editorFor();
    render(<EquipmentRequestsScreen />);
    const create = await screen.findByRole("button", { name: "Create equipment request" });
    await act(async () => { await userEvent.click(create); });
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Create equipment request" })).toBeInTheDocument();
    expect(submitEquipmentRequest).not.toHaveBeenCalled();
  });

  test("TC-1189 [failure] a save that reached neither service says both, and how to retry", async () => {
    listCoordinatorEquipmentEvents.mockResolvedValue([{ id: "e1", name: "Summit", equipment_request: null }]);
    editorFor();
    submitEquipmentRequest.mockResolvedValue({ ok: true, notified: false, rerequested: false });
    const onNotice = jest.fn();
    render(<EquipmentRequestsScreen onNotice={onNotice} />);
    const create = await screen.findByRole("button", { name: "Create equipment request" });
    await act(async () => { await userEvent.click(create); });
    await userEvent.click(await screen.findByRole("button", { name: "Submit equipment request" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      "Equipment request saved, but Technical Support could not be notified and the affected arrangements could not be marked for re-request. Open it and submit again to retry."
    ));
    await screen.findByRole("button", { name: "Create equipment request" });
  });
});

describe("G2 / G3 Technical Support's availability panel", () => {
  const request = (changes = {}) => ({
    id: "r1", event_id: "e1", event_name: "Summit", event_date: "2026-11-04", start_time: "09:00", end_time: "17:00",
    lines: [{ equipment_type: "AUDIO", quantity: 2 }], reservations: [], ...changes
  });
  const panel = async (changes, onUpdated = jest.fn()) => {
    await act(async () => { render(<EquipmentAvailabilityPanel requests={[request(changes)]} onUpdated={onUpdated} />); });
    return onUpdated;
  };

  test("TC-1237 [normal] G2 enough free stock reads as no shortfall; an unnamed event is labelled plainly", async () => {
    checkEquipmentAvailability.mockResolvedValue({
      heldQuantity: 10, reservedQuantity: 2, unavailableQuantity: 1, freeQuantity: 7, requestedQuantity: 2, shortfall: 0, available: true
    });
    await panel({ event_name: undefined });
    const section = screen.getByRole("region", { name: "Event equipment availability" });
    await userEvent.click(within(section).getByRole("button", { name: "Check availability" }));
    expect(await within(section).findByText(/7 free of 10/)).toHaveTextContent("Requested 2; no shortfall.");
  });

  test("TC-1268 [normal] G3 marking a line unable to fulfil records the reason and says whether the request is finished", async () => {
    markEquipmentLineUnableToFulfill.mockResolvedValueOnce({ status: "ARRANGED" }).mockResolvedValueOnce({ status: "PENDING" });
    const onUpdated = await panel();
    await userEvent.type(screen.getByLabelText("Reason unable to fulfil"), "None free that day");
    await userEvent.click(screen.getByRole("button", { name: "Mark unable to fulfil" }));
    expect(await screen.findByText("Line resolved; every request line is now reserved or resolved.")).toBeInTheDocument();
    expect(markEquipmentLineUnableToFulfill).toHaveBeenCalledWith({ eventId: "e1", lineIndex: 0, reason: "None free that day" });
    await userEvent.click(screen.getByRole("button", { name: "Mark unable to fulfil" }));
    expect(await screen.findByText("Line marked unable to be fulfilled with reason recorded.")).toBeInTheDocument();
    expect(onUpdated).toHaveBeenCalledTimes(2);
  });

  test("TC-1238 [failure] an amendment needs a whole quantity and a note, and a refused one shows why", async () => {
    amendEquipmentRequestLine.mockRejectedValue(new Error("This request line has already been fulfilled."));
    await panel();
    await userEvent.click(screen.getByRole("button", { name: "Save amendment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A note explaining the amendment is required.");
    await userEvent.clear(screen.getByLabelText("AUDIO quantity"));
    await userEvent.type(screen.getByLabelText("AUDIO quantity"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save amendment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quantity must be a whole number greater than zero.");
    await userEvent.clear(screen.getByLabelText("AUDIO quantity"));
    await userEvent.type(screen.getByLabelText("AUDIO quantity"), "2");
    await userEvent.type(screen.getByLabelText("Amendment note"), "Same again");
    await userEvent.click(screen.getByRole("button", { name: "Save amendment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This request line has already been fulfilled.");
  });

  test("TC-1269 [failure] G3 a line that cannot be marked shows why", async () => {
    markEquipmentLineUnableToFulfill.mockRejectedValue(new Error("Only Technical Support Staff can resolve equipment requests."));
    await panel();
    await userEvent.type(screen.getByLabelText("Reason unable to fulfil"), "No stock");
    await userEvent.click(screen.getByRole("button", { name: "Mark unable to fulfil" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only Technical Support Staff can resolve equipment requests.");
  });

  test("TC-1239 [failure] a release that is refused shows why and keeps the reservation", async () => {
    releaseEquipmentReservation.mockRejectedValue(new Error("The equipment reservation could not be released."));
    await panel({ reservations: [{ reservation_id: "res-9", equipment_type: "AUDIO", quantity: 2, status: "RESERVED" }] });
    expect(screen.getByRole("status")).toHaveTextContent("Reserved: 2 AUDIO for this event.");
    await userEvent.click(screen.getByRole("button", { name: "Release reservation" }));
    expect(releaseEquipmentReservation).toHaveBeenCalledWith({ reservationId: "res-9" });
    expect(await screen.findByRole("alert")).toHaveTextContent("The equipment reservation could not be released.");
  });

  test("TC-1240 [boundary] a reservation without a status does not count; finished lines show their outcome", async () => {
    await panel({
      lines: [
        { equipment_type: "AUDIO", quantity: 2, fulfillment_status: "RESERVED" },
        { equipment_type: "VISUAL", quantity: 1, fulfillment_status: "RESOLVED", resolution_reason: "None free", resolved_by: "Tech A" }
      ],
      reservations: [{ id: "old", equipment_type: "AUDIO", quantity: 2 }]
    });
    const statuses = screen.getAllByRole("status").map((item) => item.textContent);
    expect(statuses).toEqual(["Reserved for this event.", "Unable to fulfil: None free · Tech A"]);
    expect(screen.queryByRole("button", { name: "Release reservation" })).not.toBeInTheDocument();
  });
});

test("TC-1270 [failure] G3 when the queue cannot be re-read after a reservation, the screen says why", async () => {
  const pending = { ...bare, event_name: "Summit", event_date: "2026-11-04", start_time: "09:00", end_time: "17:00" };
  listPendingEquipmentRequests.mockResolvedValueOnce([pending]).mockRejectedValueOnce(new Error("The equipment queue could not be refreshed."));
  reserveEquipmentForEvent.mockResolvedValue({ id: "res-1", quantity: 1, status: "RESERVED" });
  render(<EquipmentAvailabilityScreen />);
  await userEvent.click(await screen.findByRole("button", { name: "Reserve equipment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The equipment queue could not be refreshed.");
});
