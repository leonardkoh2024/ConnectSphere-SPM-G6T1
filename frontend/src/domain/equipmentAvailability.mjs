const toDate = (value) => {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const overlaps = (windowStart, windowEnd, recordStart, recordEnd) =>
  windowStart < recordEnd && recordStart < windowEnd;

const activeReservation = (record) => ["RESERVED", "APPROVED"].includes(String(record.status || "").toUpperCase());
const activeUnavailability = (record) => String(record.status || "UNAVAILABLE").toUpperCase() === "UNAVAILABLE";

export const equipmentWindowFromVenueBookings = (bookings) => {
  const approvedBookings = bookings.filter((booking) => String(booking.status || "").toUpperCase() === "APPROVED");
  if (!approvedBookings.length) {
    throw new Error("An approved venue booking is required to determine the event's setup and teardown window.");
  }
  const windows = approvedBookings.map((booking) => ({
    start: toDate(booking.occupied_start || booking.start_datetime),
    end: toDate(booking.occupied_end || booking.end_datetime)
  }));
  if (windows.some(({ start, end }) => !start || !end || start >= end)) {
    throw new Error("An approved venue booking has an invalid occupied window.");
  }
  return {
    windowStart: new Date(Math.min(...windows.map(({ start }) => start.getTime()))),
    windowEnd: new Date(Math.max(...windows.map(({ end }) => end.getTime())))
  };
};

export const calculateEquipmentAvailability = ({
  equipmentType,
  windowStart,
  windowEnd,
  requestedQuantity,
  eventId = null,
  inventory = {},
  reservations = [],
  unavailability = []
}) => {
  const start = toDate(windowStart);
  const end = toDate(windowEnd);
  if (!equipmentType) throw new Error("Choose an equipment type.");
  if (!start || !end || start >= end) throw new Error("Enter a valid availability window with an end after its start.");
  const requested = Number(requestedQuantity);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Requested quantity must be a whole number greater than zero.");
  }

  const heldQuantity = Number(inventory.total_quantity);
  if (!Number.isInteger(heldQuantity) || heldQuantity < 0) {
    throw new Error(`The held quantity for ${equipmentType} is missing or invalid.`);
  }

  const matching = (record) => String(record.equipment_type || "").toUpperCase() === equipmentType;
  const collectIntervals = (records, isActive) => {
    const intervals = [];
    records.forEach((record) => {
      if (!matching(record) || !isActive(record)) return;
      if (eventId && record.event_id === eventId) return;
      const recordStart = toDate(record.start_datetime);
      const recordEnd = toDate(record.end_datetime);
      const quantity = Number(record.quantity);
      if (!recordStart || !recordEnd || recordStart >= recordEnd) {
        throw new Error(`An active ${equipmentType} availability record has an invalid time window.`);
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`An active ${equipmentType} availability record has an invalid quantity.`);
      }
      if (!overlaps(start, end, recordStart, recordEnd)) return;
      intervals.push({
        start: new Date(Math.max(start.getTime(), recordStart.getTime())),
        end: new Date(Math.min(end.getTime(), recordEnd.getTime())),
        quantity
      });
    });
    return intervals;
  };
  const reservedIntervals = collectIntervals(reservations, activeReservation);
  const unavailableIntervals = collectIntervals(unavailability, activeUnavailability);
  const boundaries = [...new Set([
    start.getTime(),
    end.getTime(),
    ...reservedIntervals.flatMap(({ start: periodStart, end: periodEnd }) => [periodStart.getTime(), periodEnd.getTime()]),
    ...unavailableIntervals.flatMap(({ start: periodStart, end: periodEnd }) => [periodStart.getTime(), periodEnd.getTime()])
  ])].sort((left, right) => left - right);
  let reservedQuantity = 0;
  let unavailableQuantity = 0;
  let peakOccupied = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const periodStart = boundaries[index];
    const periodEnd = boundaries[index + 1];
    const reservedAtTime = reservedIntervals.reduce((total, period) =>
      period.start.getTime() <= periodStart && period.end.getTime() >= periodEnd
        ? total + period.quantity
        : total, 0);
    const unavailableAtTime = unavailableIntervals.reduce((total, period) =>
      period.start.getTime() <= periodStart && period.end.getTime() >= periodEnd
        ? total + period.quantity
        : total, 0);
    const occupiedAtTime = reservedAtTime + unavailableAtTime;
    if (occupiedAtTime > peakOccupied) {
      peakOccupied = occupiedAtTime;
      reservedQuantity = reservedAtTime;
      unavailableQuantity = unavailableAtTime;
    }
  }
  const freeQuantity = Math.max(0, heldQuantity - reservedQuantity - unavailableQuantity);
  const shortfall = Math.max(0, requested - freeQuantity);
  return {
    equipmentType,
    heldQuantity,
    reservedQuantity,
    unavailableQuantity,
    freeQuantity,
    requestedQuantity: requested,
    shortfall,
    available: shortfall === 0
  };
};
