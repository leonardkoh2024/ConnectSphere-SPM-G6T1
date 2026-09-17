// The rules an event request has to satisfy (epic B — B1 to B5, and B9).
//
// No React and no Firebase here on purpose: these are the rules, not the screen,
// so they move into the service layer unchanged and stay cheap to unit test.
//
// Every rule reports the field it belongs to, because B9 AC4 requires the form to
// list exactly which fields are missing or invalid rather than showing one message
// covering all of them.
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

// B2 AC1, required at submission by B9 AC1. Facilities are the third venue
// requirement, but they are a list behind a Yes/No question and so are handled
// with the other sections below.
export const VENUE_REQUIREMENTS = [
  { field: "preferredLocation", label: "Preferred location or area" },
  { field: "requiredLayout", label: "Required layout" }
];

export const YES = "yes";
export const NO = "no";
export const UNANSWERED = "";

// B9 AC2 — facilities, equipment, accessibility and registration each have to be
// *answered*. Each section opens with a Yes/No question: an unanswered question is
// a gap in the request, a No is a decision, and only a Yes makes the detail behind
// it compulsory. Without the question there is no way to tell a section someone
// meant to leave empty from one they forgot.
export const SECTION_QUESTIONS = [
  { gate: "facilitiesRequired", question: "Does your event need facilities from the venue?" },
  { gate: "equipmentRequired", question: "Does your event need equipment?" },
  { gate: "accessibilityRequired", question: "Does your event have accessibility needs?" },
  { gate: "registrationRequired", question: "Do attendees need to register?" }
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

// B9 AC5 — the reference number has to be unique. A timestamp on its own repeats
// whenever two requests are created in the same millisecond, so a counter sits
// behind it: within one browser session, two references can never be equal. The
// random pair separates two sessions that start in the same millisecond, which
// makes a clash unlikely rather than impossible — a guarantee across every client
// at once would have to come from the server, and there is no service layer yet.
// An existing draft keeps whatever reference it was already given.
let referenceStamp = 0;
let referenceSequence = 0;

export const createReferenceNo = () => {
  const stamp = Date.now();
  if (stamp === referenceStamp) referenceSequence += 1;
  else {
    referenceStamp = stamp;
    referenceSequence = 0;
  }
  const moment = stamp.toString(36).toUpperCase().slice(-6);
  const sequence = (referenceSequence % 46656).toString(36).toUpperCase().padStart(3, "0");
  const random = Math.random().toString(36).slice(2, 4).padEnd(2, "0").toUpperCase();
  return `EVT-${moment}-${sequence}${random}`;
};

/**
 * @returns {{field: string, message: string}[]} one issue per field that is
 * missing or invalid, in the order the fields appear on the form. Empty when the
 * request is ready.
 */
export function validateEventRequest(form, { mode = "submit", today = todayIso() } = {}) {
  const submitting = mode === "submit";
  const issues = [];
  const add = (field, message) => issues.push({ field, message });

  const given = {};
  const checkPresence = ({ field, label }) => {
    given[field] = !blank(form[field]);
    if (submitting && !given[field]) add(field, `${label} is required.`);
  };

  CORE_DETAILS.forEach(checkPresence);
  if (given.eventDate && form.eventDate < today) add("eventDate", "The proposed event date cannot be in the past.");
  if (given.startTime && given.endTime && form.endTime <= form.startTime) add("endTime", "End time must be later than start time.");
  if (given.expectedAttendance && !isWholeNumberFrom(form.expectedAttendance, 1)) {
    add("expectedAttendance", "Expected attendance must be a whole number greater than zero.");
  }

  VENUE_REQUIREMENTS.forEach(checkPresence);

  const answered = (gate) => form[gate] === YES || form[gate] === NO;
  const askedFor = (gate) => form[gate] === YES;
  const checkAnswered = ({ gate, question }) => {
    if (submitting && !answered(gate)) add(gate, `Answer “${question}”`);
  };
  SECTION_QUESTIONS.forEach(checkAnswered);

  if (submitting && askedFor("facilitiesRequired") && (form.facilities || []).length === 0) {
    add("facilities", "Select at least one required facility, or answer No above.");
  }

  if (askedFor("equipmentRequired")) {
    const equipment = equipmentLinesWithContent(form);
    if (submitting && equipment.length === 0) add("equipmentLines", "Add at least one equipment line, or answer No above.");
    equipment.forEach((line, index) => {
      if (blank(line.equipmentType)) add(`equipmentLines.${index}.equipmentType`, `Equipment type ${index + 1} is required.`);
      if (!isWholeNumberFrom(line.quantity, 1)) {
        add(`equipmentLines.${index}.quantity`, `Equipment quantity ${index + 1} must be a whole number greater than zero.`);
      }
    });
  }

  if (submitting && askedFor("accessibilityRequired") && (form.accessibility || []).length === 0) {
    add("accessibility", "Select at least one accessibility need, or answer No above.");
  }

  if (askedFor("registrationRequired")) {
    const capacityGiven = !blank(form.registrationCapacity);
    if ((submitting && !capacityGiven) || (capacityGiven && !isWholeNumberFrom(form.registrationCapacity, 1))) {
      add("registrationCapacity", "Registration capacity must be a whole number greater than zero.");
    } else if (capacityGiven && isWholeNumberFrom(form.expectedAttendance, 1) && Number(form.registrationCapacity) > Number(form.expectedAttendance)) {
      add("registrationCapacity", "Registration capacity cannot exceed the expected attendance.");
    }

    const windowFields = ["registrationOpenDate", "registrationOpenTime", "registrationCloseDate", "registrationCloseTime"];
    const windowGiven = windowFields.every((field) => !blank(form[field]));
    if (submitting && !windowGiven) {
      add("registrationWindow", "Registration open and close date/time are required when registration is enabled.");
    }
    if (windowGiven) {
      const opens = new Date(`${form.registrationOpenDate}T${form.registrationOpenTime}`);
      const closes = new Date(`${form.registrationCloseDate}T${form.registrationCloseTime}`);
      if (opens > closes) add("registrationCloseDate", "Registration close date/time must be after registration open date/time.");
      else if (given.eventDate && given.startTime && closes > new Date(`${form.eventDate}T${form.startTime}`)) {
        add("registrationCloseDate", "Registration close date/time must be at or before the event start.");
      }
    }
  }

  return issues;
}
