const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

export const eventEndInstant = (event = {}) => {
  if (!validDate(event.event_date) || !validTime(event.end_time)) return null;
  return new Date(`${event.event_date}T${event.end_time}:00+08:00`);
};

export const canCompleteEvent = (event, coordinatorId, now = new Date()) => {
  const end = eventEndInstant(event);
  return Boolean(event)
    && event.status === "CONFIRMED"
    && event.coordinator_id === coordinatorId
    && end !== null
    && now instanceof Date
    && now.getTime() > end.getTime();
};
