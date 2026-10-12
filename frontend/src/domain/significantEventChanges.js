export const editableEventStatuses = ["APPROVED", "PLANNING", "CONFIRMED"];

export const significantEventValues = (event = {}) => ({
  expected_attendance: event.expected_attendance ?? "",
  event_date: event.event_date || "",
  start_time: event.start_time || "",
  end_time: event.end_time || "",
  preferred_location: event.preferred_location || "",
  required_layout: event.required_layout || "",
  facilities_required: event.facilities_required ?? Boolean(event.facilities?.length),
  facilities: [...(event.facilities || [])].sort(),
  accessibility_needed: event.accessibility_needed ?? Boolean(event.accessibility?.length || event.accessibility_notes),
  accessibility: [...(event.accessibility || [])].sort(),
  accessibility_notes: event.accessibility_notes || ""
});

export const significantEventChanges = (before, after) => {
  const oldValues = significantEventValues(before);
  const newValues = significantEventValues(after);
  return Object.keys(oldValues).reduce((changes, field) => {
    if (JSON.stringify(oldValues[field]) !== JSON.stringify(newValues[field])) {
      changes[field] = { old_value: oldValues[field], new_value: newValues[field] };
    }
    return changes;
  }, {});
};

export const validateSignificantEventValues = (values) => {
  const attendance = Number(values.expected_attendance);
  if (!Number.isInteger(attendance) || attendance < 1) {
    return "Expected attendance must be a whole number greater than zero.";
  }
  if (!values.event_date || !values.start_time || !values.end_time) {
    return "Event date, start time and end time are required.";
  }
  const date = new Date(`${values.event_date}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== values.event_date) {
    return "Enter a valid event date.";
  }
  const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validTime(values.start_time) || !validTime(values.end_time)) {
    return "Enter valid start and end times.";
  }
  if (values.end_time <= values.start_time) {
    return "End time must be later than start time.";
  }
  return "";
};
