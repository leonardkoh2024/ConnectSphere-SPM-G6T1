// The coordinator's view of an event's equipment arrangements, beside its venue
// bookings: each requested line with the status Technical Support has given it,
// and Technical Support's decisions as Activity entries. No React and no
// Firebase — reviewApi.detail supplies the equipment_requests document, the
// event's equipment_reservations and its equipment_request_history rows, all
// written by the backend equipment service.

export const equipmentTypeLabel = (type) => {
  const words = String(type || "equipment").replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// A reserved line is shown as Approved on the event's Arrangements tab, the word
// the coordinator sees on an approved venue booking; the tones are the
// event-status tones in domain/events.
export const equipmentLineStatus = (line = {}) => {
  if (line.fulfillment_status === "RESERVED") return { label: "Approved", tone: "positive" };
  if (line.fulfillment_status === "RESOLVED") return { label: "Unable to fulfil", tone: "danger" };
  return { label: "Pending", tone: "warning" };
};

// The whole request, in the words the coordinator sees. A request Technical
// Support has finished (stored as ARRANGED: every line reserved or refused) reads
// Reserved, Partly reserved when some lines were refused, or Unable to fulfil
// when none could be reserved.
export const equipmentRequestStatus = (request) => {
  if (!request) return { label: "Not submitted", tone: "neutral" };
  if (request.status !== "ARRANGED") return { label: "Pending", tone: "warning" };
  const lines = request.lines || [];
  const reserved = lines.filter((line) => line.fulfillment_status === "RESERVED").length;
  if (lines.length && reserved === lines.length) return { label: "Reserved", tone: "positive" };
  if (reserved > 0) return { label: "Partly reserved", tone: "warning" };
  return { label: "Unable to fulfil", tone: "danger" };
};

// One Technical Support decision as a sentence, for the coordinator's updates list.
export const equipmentUpdateText = (row = {}) => {
  const what = `${Number(row.quantity) || 1} × ${equipmentTypeLabel(row.equipment_type).toLowerCase()}`;
  const why = (text) => (text ? `: ${text}` : "");
  if (row.action === "LINE_RESERVED") return `Reserved ${what}`;
  if (row.action === "LINE_RESERVATION_RELEASED") return `Released ${what}${why(row.reason)}`;
  if (row.action === "LINE_UNABLE_TO_FULFILL") return `Unable to fulfil ${what}${why(row.reason)}`;
  if (row.action === "LINE_AMENDED") {
    const from = `${Number(row.old_values?.quantity) || 1} × ${equipmentTypeLabel(row.old_values?.equipment_type).toLowerCase()}`;
    const to = `${Number(row.new_values?.quantity) || 1} × ${equipmentTypeLabel(row.new_values?.equipment_type).toLowerCase()}`;
    return `Amended ${from} → ${to}${why(row.note)}`;
  }
  return "Updated the request";
};

export const equipmentArrangements = (request, reservations = []) => {
  if (!request) return null;
  const byId = new Map(reservations.map((item) => [item.reservation_id || item.id, item]));
  return {
    status: equipmentRequestStatus(request),
    lines: (request.lines || []).map((line, index) => {
      const reservation = line.reservation_id ? byId.get(line.reservation_id) : null;
      return {
        key: `${index}-${line.equipment_type}`,
        label: `${equipmentTypeLabel(line.equipment_type)} × ${Number(line.quantity) || 1}`,
        status: equipmentLineStatus(line),
        reservedFrom: reservation?.start_datetime || null,
        reservedTo: reservation?.end_datetime || null,
        decidedAt: line.fulfilled_at || line.resolved_at || null,
        reason: line.resolution_reason || null
      };
    })
  };
};

// Technical Support's decisions, shaped like event_history rows so the Activity
// tab lists them alongside every other change. A coordinator cannot read a
// Technical Support profile, so the role stands in for the name.
const line = (row) => `${equipmentTypeLabel(row.equipment_type)} × ${Number(row.quantity) || 1}`;

const EQUIPMENT_ACTIVITY = {
  LINE_RESERVED: (row) => ({
    action_type: "EQUIPMENT_RESERVED", field_name: "equipment", old_value: `${line(row)} — Pending`, new_value: `${line(row)} — Approved`
  }),
  LINE_RESERVATION_RELEASED: (row) => ({
    action_type: "EQUIPMENT_RESERVATION_RELEASED", field_name: "equipment",
    old_value: `${line(row)} — Approved`, new_value: `${line(row)} — Released`, reason: row.reason || null
  }),
  LINE_UNABLE_TO_FULFILL: (row) => ({
    action_type: "EQUIPMENT_UNABLE_TO_FULFIL", field_name: "equipment",
    old_value: `${line(row)} — Pending`, new_value: `${line(row)} — Unable to fulfil`, reason: row.reason || null
  }),
  LINE_AMENDED: (row) => ({
    action_type: "EQUIPMENT_LINE_AMENDED", field_name: "equipment",
    old_value: line(row.old_values || {}), new_value: line(row.new_values || {}), reason: row.note || null
  })
};

export const equipmentActivity = (rows = []) => rows
  .filter((row) => EQUIPMENT_ACTIVITY[row.action])
  .map((row) => ({
    id: `equipment-${row.id}`,
    actor_id: row.actor_id,
    actor_role: "Technical Support",
    created_at: row.created_at,
    ...EQUIPMENT_ACTIVITY[row.action](row)
  }));
