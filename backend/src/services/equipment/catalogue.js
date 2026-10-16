// G2 / G3 / G5 — Technical Support's catalogue: stock held, recorded
// unavailability, and every reservation with the event it is for. The browser
// can read the first three itself, but once a request is arranged it leaves the
// Pending queue the rules let Technical Support read, so the event's name comes
// from the request here. Reads only this service's own collections.

const iso = (value) => {
  if (value == null) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const createEquipmentCatalogue = ({ firestore }) => {
  const load = async () => {
    const [inventory, reservations, unavailability] = await Promise.all([
      firestore.collection("equipment_inventory").get(),
      firestore.collection("equipment_reservations").get(),
      firestore.collection("equipment_unavailability").get()
    ]);
    const eventIds = [...new Set(reservations.docs.map((item) => item.data().event_id).filter(Boolean))];
    const requests = new Map(await Promise.all(eventIds.map(async (eventId) => {
      const snapshot = await firestore.collection("equipment_requests").doc(eventId).get();
      return [eventId, snapshot.exists ? snapshot.data() : null];
    })));

    return {
      inventory: inventory.docs.map((item) => ({
        equipment_type: item.data().equipment_type || item.id,
        total_quantity: item.data().total_quantity ?? null
      })),
      unavailability: unavailability.docs.map((item) => {
        const record = item.data();
        return {
          equipment_type: record.equipment_type,
          quantity: record.quantity,
          status: record.status || "UNAVAILABLE",
          start_datetime: iso(record.start_datetime),
          end_datetime: iso(record.end_datetime)
        };
      }),
      reservations: reservations.docs.map((item) => {
        const record = item.data();
        const request = requests.get(record.event_id) || {};
        return {
          id: item.id,
          event_id: record.event_id || null,
          equipment_type: record.equipment_type,
          quantity: record.quantity,
          line_index: record.line_index ?? null,
          status: record.status,
          start_datetime: iso(record.start_datetime),
          end_datetime: iso(record.end_datetime),
          reserved_by: record.reserved_by || null,
          created_at: iso(record.created_at),
          released_at: iso(record.released_at),
          released_by: record.released_by || null,
          release_reason: record.release_reason || null,
          event_name: request.event_name || null,
          reference_no: request.reference_no || null,
          event_date: request.event_date || null
        };
      })
    };
  };

  return { load };
};
