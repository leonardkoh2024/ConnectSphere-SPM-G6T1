// The rules an event request has to satisfy (epic B — B1 to B5).
//
// No React and no Firebase here on purpose: these are the rules, not the screen,
// so they move into the service layer unchanged and stay cheap to unit test.
//
// Two modes. On submission everything must be present; on a draft only what has
// actually been entered is checked, because B6 exists precisely so an organiser
// can save an unfinished request. A value that *has* been entered is judged the
// same way either way — B1 AC2 and AC3 are rules about the value, not about
// whether the organiser has finished yet.

// B1 AC1.
export const CORE_DETAILS = [
  { field: "name", label: "Event name" },
  { field: "purpose", label: "Purpose" },
  { field: "description", label: "Description" },
  { field: "eventDate", label: "Proposed date" },
  { field: "startTime", label: "Start time" },
  { field: "endTime", label: "End time" },
  { field: "expectedAttendance", label: "Expected attendance" }
];

export const todayIso = () => new Date().toISOString().slice(0, 10);

const blank = (value) => !String(value ?? "").trim();

const isWholeNumberFrom = (value, minimum) =>
  /^\d+$/.test(String(value ?? "").trim()) && Number(value) >= minimum;

const hasContent = (line) =>
  Boolean(String(line.equipmentType ?? "").trim() || String(line.quantity ?? "").trim() || String(line.technicalNote ?? "").trim());

// A blank trailing line is how the form offers the organiser somewhere to type,
// so it is not an equipment requirement until something is put in it.
export const equipmentLinesWithContent = (form) => (form.equipmentLines || []).filter(hasContent);

/**
 * @returns {string} the first thing wrong with the request, or "" when there is
 * nothing to report.
 */
export function validateEventRequest(form, { mode = "submit", today = todayIso() } = {}) {
  const submitting = mode === "submit";

  if (submitting && CORE_DETAILS.some(({ field }) => blank(form[field]))) {
    return "Complete all core event details before submitting.";
  }

  if (!blank(form.eventDate) && form.eventDate < today) return "The proposed event date cannot be in the past.";
  if (!blank(form.startTime) && !blank(form.endTime) && form.endTime <= form.startTime) {
    return "End time must be later than start time.";
  }
  if (!blank(form.expectedAttendance) && !isWholeNumberFrom(form.expectedAttendance, 1)) {
    return "Expected attendance must be a whole number greater than zero.";
  }

  const equipment = equipmentLinesWithContent(form);
  if (submitting && equipment.length === 0) return "Add at least one equipment line before submitting.";
  for (const line of equipment) {
    if (blank(line.equipmentType)) return "Each equipment line must include an equipment type.";
    if (!isWholeNumberFrom(line.quantity, 1)) return "Equipment quantity must be a whole number greater than zero.";
  }

  if (form.registrationRequired) {
    const capacityGiven = !blank(form.registrationCapacity);
    if ((submitting && !capacityGiven) || (capacityGiven && !isWholeNumberFrom(form.registrationCapacity, 1))) {
      return "Registration capacity must be a whole number greater than zero.";
    }
    if (capacityGiven && isWholeNumberFrom(form.expectedAttendance, 1) && Number(form.registrationCapacity) > Number(form.expectedAttendance)) {
      return "Registration capacity cannot exceed the expected attendance.";
    }

    const windowFields = ["registrationOpenDate", "registrationOpenTime", "registrationCloseDate", "registrationCloseTime"];
    const windowGiven = windowFields.every((field) => !blank(form[field]));
    if (submitting && !windowGiven) {
      return "Registration open and close date/time are required when registration is enabled.";
    }
    if (windowGiven) {
      const opens = new Date(`${form.registrationOpenDate}T${form.registrationOpenTime}`);
      const closes = new Date(`${form.registrationCloseDate}T${form.registrationCloseTime}`);
      if (opens > closes) return "Registration close date/time must be after registration open date/time.";
      if (!blank(form.eventDate) && !blank(form.startTime) && closes > new Date(`${form.eventDate}T${form.startTime}`)) {
        return "Registration close date/time must be at or before the event start.";
      }
    }
  }

  return "";
}
