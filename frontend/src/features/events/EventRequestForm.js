// Event request creation and drafts (epic B). One form serves both: "Save draft"
// writes status DRAFT, "Submit" writes status SUBMITTED and stamps submitted_at.
//
// A request spans five collections — events, event_venue_requirements,
// event_facilities, event_equipment and event_accessibility — so every write here
// must keep them consistent with each other.

import React, { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { LAYOUTS, FACILITIES, ACCESSIBILITY_OPTIONS, EQUIPMENT_TYPES } from "../../domain/events";
import { NO, UNANSWERED, YES, createReferenceNo, equipmentLinesWithContent, todayIso, validateEventRequest } from "../../domain/eventRequest";
import ToggleList from "./components/ToggleList";
import YesNo from "./components/YesNo";

// A red star marks a field that has to be filled in before the request can be
// submitted. A draft is never blocked by one.
const Required = () => <span className="cs-required" aria-hidden="true">*</span>;

// .cs-field lays its label and control out as a grid, so the name and whatever
// marks it have to travel as one grid item or the marker drops to its own line.
const FieldName = ({ children, required = false, optional = false }) => (
  <span className="cs-field-name">
    {children}
    {required && <Required />}
    {optional && <span className="cs-optional">Optional</span>}
  </span>
);

// Firestore stores a plain boolean; the form needs a third state for a question
// nobody has answered yet.
const toAnswer = (value) => (typeof value === "boolean" ? (value ? YES : NO) : UNANSWERED);

const createEquipmentLine = (line = {}) => ({
  id: line.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  equipmentType: line.equipmentType || "",
  quantity: line.quantity ?? "",
  technicalNote: line.technicalNote || ""
});

const initialForm = {
  name: "",
  purpose: "",
  description: "",
  eventDate: "",
  startTime: "",
  endTime: "",
  expectedAttendance: "",
  preferredLocation: "",
  requiredLayout: "",
  facilitiesRequired: UNANSWERED,
  facilities: [],
  equipmentRequired: UNANSWERED,
  equipmentLines: [createEquipmentLine()],
  // B5 AC1 — the registration flag defaults to off, so this one question starts
  // answered rather than blank.
  registrationRequired: NO,
  registrationCapacity: "",
  registrationOpenDate: "",
  registrationOpenTime: "",
  registrationCloseDate: "",
  registrationCloseTime: "",
  accessibilityRequired: UNANSWERED,
  accessibility: [],
  accessibilityNotes: ""
};

export default function EventRequestForm({ user, draft, onSaved, readOnly = false }) {
  const [form, setForm] = useState(initialForm);
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isReadOnly = readOnly || (draft && String(draft.status || "").toUpperCase() !== "DRAFT");

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  // Answering No puts the section away, so whatever was typed into it while the
  // answer was Yes does not travel to Firestore behind the organiser's back.
  const answerSection = (gate, value) => setForm((current) => ({
    ...current,
    [gate]: value,
    ...(value === NO && gate === "facilitiesRequired" ? { facilities: [] } : {}),
    ...(value === NO && gate === "accessibilityRequired" ? { accessibility: [] } : {}),
    ...(value === NO && gate === "equipmentRequired" ? { equipmentLines: [createEquipmentLine()] } : {}),
    ...(value === NO && gate === "registrationRequired"
      ? { registrationCapacity: "", registrationOpenDate: "", registrationOpenTime: "", registrationCloseDate: "", registrationCloseTime: "" }
      : {})
  }));

  const updateEquipmentLine = (lineId, field, value) => {
    setForm((current) => ({
      ...current,
      equipmentLines: current.equipmentLines.map((line) => line.id === lineId ? { ...line, [field]: value } : line)
    }));
  };

  const addEquipmentLine = () => setForm((current) => ({ ...current, equipmentLines: [...current.equipmentLines, createEquipmentLine()] }));

  const removeEquipmentLine = (lineId) => setForm((current) => ({
    ...current,
    equipmentLines: current.equipmentLines.length > 1
      ? current.equipmentLines.filter((line) => line.id !== lineId)
      : [createEquipmentLine()]
  }));

  useEffect(() => {
    let mounted = true;
    const loadDraft = async () => {
      if (!draft) { setForm(initialForm); return; }
      try {
        const [venueRequirement, facilitySnapshot, equipmentSnapshot, accessibilitySnapshot] = await Promise.all([
          getDoc(doc(db, "event_venue_requirements", draft.id)),
          getDocs(query(collection(db, "event_facilities"), where("event_id", "==", draft.id))),
          getDocs(query(collection(db, "event_equipment"), where("event_id", "==", draft.id))),
          getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", draft.id)))
        ]);
        const requirement = venueRequirement.exists() ? venueRequirement.data() : {};
        const equipmentLines = equipmentSnapshot.docs.length
          ? equipmentSnapshot.docs.map((item) => createEquipmentLine({
              id: `${draft.id}_${item.id}`,
              equipmentType: item.data().equipment_type || "",
              quantity: item.data().quantity != null ? String(item.data().quantity) : "",
              technicalNote: item.data().technical_note || ""
            }))
          : [createEquipmentLine()];
        if (mounted) setForm({
          name: draft.name || "", purpose: draft.purpose || "", description: draft.description || "",
          eventDate: draft.event_date || "", startTime: draft.start_time || "", endTime: draft.end_time || "",
          expectedAttendance: draft.expected_attendance ? String(draft.expected_attendance) : "",
          preferredLocation: requirement.preferred_location || "", requiredLayout: requirement.required_layout || "",
          facilitiesRequired: toAnswer(requirement.facilities_required),
          facilities: facilitySnapshot.docs.map((item) => item.data().facility_id),
          equipmentRequired: toAnswer(draft.equipment_required),
          equipmentLines,
          registrationRequired: toAnswer(draft.registration_required) || NO,
          registrationCapacity: draft.registration_capacity ? String(draft.registration_capacity) : "",
          registrationOpenDate: draft.registration_open_date || "",
          registrationOpenTime: draft.registration_open_time || "",
          registrationCloseDate: draft.registration_close_date || "",
          registrationCloseTime: draft.registration_close_time || "",
          accessibilityRequired: toAnswer(requirement.accessibility_needed),
          accessibility: accessibilitySnapshot.docs.map((item) => item.data().accessibility_id),
          accessibilityNotes: requirement.accessibility_notes || ""
        });
      } catch (loadError) { console.error("Could not load draft requirements:", loadError); if (mounted) setError("We could not load this draft. Please try again."); }
    };
    loadDraft();
    return () => { mounted = false; };
  }, [draft]);

  // The rules themselves live in domain/eventRequest.js. A draft is checked too,
  // but only on what has been entered — B6 lets an organiser save an unfinished
  // request, it does not let them save an impossible one.
  const save = async (submit) => {
    if (isReadOnly) return;
    const found = validateEventRequest(form, { mode: submit ? "submit" : "draft" });
    setIssues(found);
    if (found.length) return;
    setError("");
    setBusy(true);
    try {
      // B9 AC5 — a request keeps the reference number it was first given, so the
      // one an organiser was shown still finds their request after they submit it.
      const referenceNo = draft?.reference_no || createReferenceNo();
      const answeredAs = (answer) => (answer === YES ? true : answer === NO ? false : null);
      const needsRegistration = form.registrationRequired === YES;
      const eventData = {
        reference_no: referenceNo,
        organiser_id: user.uid,
        coordinator_id: null,
        name: form.name.trim(),
        purpose: form.purpose.trim(),
        description: form.description.trim(),
        event_date: form.eventDate || null,
        start_time: form.startTime || null,
        end_time: form.endTime || null,
        expected_attendance: form.expectedAttendance ? Number(form.expectedAttendance) : null,
        status: submit ? "SUBMITTED" : "DRAFT",
        // A Yes/No question that has not been answered yet is stored as null, so a
        // draft comes back with the question still open rather than silently No.
        equipment_required: answeredAs(form.equipmentRequired),
        registration_required: answeredAs(form.registrationRequired),
        registration_capacity: needsRegistration && form.registrationCapacity ? Number(form.registrationCapacity) : null,
        registration_open_date: needsRegistration ? form.registrationOpenDate || null : null,
        registration_open_time: needsRegistration ? form.registrationOpenTime || null : null,
        registration_close_date: needsRegistration ? form.registrationCloseDate || null : null,
        registration_close_time: needsRegistration ? form.registrationCloseTime || null : null,
        created_by: user.uid,
        updated_at: serverTimestamp(),
        ...(submit ? { submitted_at: serverTimestamp() } : {})
      };
      let eventRef;
      if (draft) {
        eventRef = doc(db, "events", draft.id);
        await updateDoc(eventRef, eventData);
      } else eventRef = await addDoc(collection(db, "events"), { ...eventData, created_at: serverTimestamp() });

      // Requirements are intentionally persisted for drafts too, including blank
      // values, so no information is lost when an organiser comes back later.
      await setDoc(doc(db, "event_venue_requirements", eventRef.id), {
        event_id: eventRef.id,
        preferred_location: form.preferredLocation.trim(),
        required_layout: form.requiredLayout || null,
        facilities_required: answeredAs(form.facilitiesRequired),
        accessibility_needed: answeredAs(form.accessibilityRequired),
        accessibility_notes: form.accessibilityNotes.trim()
      });
      // Only the sections answered Yes contribute rows; a No leaves none behind,
      // including when the answer has just been changed from Yes.
      const equipmentLines = form.equipmentRequired === YES ? equipmentLinesWithContent(form) : [];
      const facilities = form.facilitiesRequired === YES ? form.facilities : [];
      const accessibility = form.accessibilityRequired === YES ? form.accessibility : [];
      const [existingFacilities, existingEquipment, existingAccessibility] = await Promise.all([
        getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventRef.id))),
        getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventRef.id))),
        getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventRef.id)))
      ]);
      await Promise.all([
        ...existingFacilities.docs.map((item) => deleteDoc(item.ref)),
        ...existingEquipment.docs.map((item) => deleteDoc(item.ref)),
        ...existingAccessibility.docs.map((item) => deleteDoc(item.ref)),
        ...facilities.map((facilityId) =>
          setDoc(doc(db, "event_facilities", `${eventRef.id}_${facilityId}`), { event_id: eventRef.id, facility_id: facilityId })
        ),
        ...equipmentLines.map((line, index) =>
          setDoc(doc(db, "event_equipment", `${eventRef.id}_${index}`), {
            event_id: eventRef.id,
            equipment_type: line.equipmentType.trim(),
            quantity: Number(line.quantity),
            technical_note: line.technicalNote.trim() || null
          })
        ),
        ...accessibility.map((accessibilityId) =>
          setDoc(doc(db, "event_accessibility", `${eventRef.id}_${accessibilityId}`), { event_id: eventRef.id, accessibility_id: accessibilityId })
        )
      ]);
      await addDoc(collection(db, "event_history"), {
        event_id: eventRef.id,
        actor_id: user.uid,
        action_type: submit ? "EVENT_SUBMITTED" : "DRAFT_CREATED",
        description: submit ? "Event request submitted by organiser." : "Event draft created by organiser.",
        created_at: serverTimestamp()
      });
      setForm(initialForm);
      // B9 AC6 — the confirmation carries the reference number, which is the only
      // thing the organiser can quote when they follow the request up.
      onSaved(
        submit
          ? `Event request ${referenceNo} submitted for coordinator review.`
          : `Draft ${referenceNo} saved. You can return to it from My events.`,
        submit ? null : { id: eventRef.id, ...eventData }
      );
    } catch (saveError) {
      console.error("Could not save event request:", saveError);
      setError("We could not save your event request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    // noValidate, so the browser's own "please fill out this field" bubble does
    // not fire first and hide the list B9 AC4 asks for. The required attributes
    // stay for assistive technology.
    <form className="cs-event-form" noValidate onSubmit={(event) => { event.preventDefault(); save(true); }}>
      {draft && <p className="cs-panel-note">{isReadOnly ? `Viewing request ${draft.reference_no}. This request is no longer editable.` : `Editing draft ${draft.reference_no}. Submit when you are ready for coordinator review.`}</p>}
      {!isReadOnly && <p className="cs-form-legend"><Required /> Compulsory. A draft can be saved with anything still missing.</p>}
      <section className="cs-form-section">
        <h2>Core details</h2>
        <div className="cs-form-grid">
          <label className="cs-field cs-field-wide"><FieldName required>Event name</FieldName><input required readOnly={isReadOnly} value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
          <label className="cs-field"><FieldName required>Purpose</FieldName><input required readOnly={isReadOnly} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} /></label>
          <label className="cs-field"><FieldName required>Expected attendance</FieldName><input required readOnly={isReadOnly} type="number" min="1" step="1" value={form.expectedAttendance} onChange={(e) => update("expectedAttendance", e.target.value)} /></label>
          <label className="cs-field cs-field-wide"><FieldName required>Description</FieldName><textarea required readOnly={isReadOnly} rows="4" value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
          <label className="cs-field"><FieldName required>Proposed date</FieldName><input required readOnly={isReadOnly} type="date" min={todayIso()} value={form.eventDate} onChange={(e) => update("eventDate", e.target.value)} /></label>
          <label className="cs-field"><FieldName required>Start time</FieldName><input required readOnly={isReadOnly} type="time" value={form.startTime} onChange={(e) => update("startTime", e.target.value)} /></label>
          <label className="cs-field"><FieldName required>End time</FieldName><input required readOnly={isReadOnly} type="time" value={form.endTime} onChange={(e) => update("endTime", e.target.value)} /></label>
        </div>
      </section>
      <section className="cs-form-section">
        <h2>Venue requirements</h2>
        <div className="cs-form-grid">
          <label className="cs-field"><FieldName required>Preferred location or area</FieldName><input required readOnly={isReadOnly} value={form.preferredLocation} onChange={(e) => update("preferredLocation", e.target.value)} /></label>
          <label className="cs-field"><FieldName required>Required layout</FieldName><select required disabled={isReadOnly} value={form.requiredLayout} onChange={(e) => update("requiredLayout", e.target.value)}><option value="">Choose a layout</option>{LAYOUTS.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        </div>
        <YesNo
          question="Does your event need facilities from the venue?"
          name="facilitiesRequired"
          value={form.facilitiesRequired}
          onChange={(value) => answerSection("facilitiesRequired", value)}
          disabled={isReadOnly}
        />
        {form.facilitiesRequired === YES && (
          <ToggleList
            label="Required facilities"
            options={FACILITIES}
            values={form.facilities}
            onChange={isReadOnly ? () => {} : (value) => update("facilities", value)}
            disabled={isReadOnly}
            required
          />
        )}
      </section>
      <section className="cs-form-section">
        <h2>Equipment requirements</h2>
        <YesNo
          question="Does your event need equipment?"
          name="equipmentRequired"
          value={form.equipmentRequired}
          onChange={(value) => answerSection("equipmentRequired", value)}
          disabled={isReadOnly}
        />
        {form.equipmentRequired === YES && (
          <div className="cs-form-stack">
            {form.equipmentLines.map((line, index) => (
              <div className="cs-equipment-line" key={line.id}>
                <div className="cs-form-grid">
                  <label className="cs-field"><FieldName required>Equipment type</FieldName>
                    <select aria-label={`Equipment type ${index + 1}`} disabled={isReadOnly} value={line.equipmentType} onChange={(e) => updateEquipmentLine(line.id, "equipmentType", e.target.value)} required>
                      <option value="">Choose equipment type</option>
                      {EQUIPMENT_TYPES.map((item) => <option value={item} key={`${line.id}-${item}`}>{item.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <label className="cs-field"><FieldName required>Quantity</FieldName><input aria-label={`Quantity ${index + 1}`} readOnly={isReadOnly} type="number" min="1" step="1" value={line.quantity} onChange={(e) => updateEquipmentLine(line.id, "quantity", e.target.value)} /></label>
                  <label className="cs-field cs-field-wide"><FieldName optional>Technical note / Other Equipment Type</FieldName><textarea aria-label={`Technical note ${index + 1}`} readOnly={isReadOnly} rows="2" value={line.technicalNote} onChange={(e) => updateEquipmentLine(line.id, "technicalNote", e.target.value)} /></label>
                </div>
                {form.equipmentLines.length > 1 && !isReadOnly && <button type="button" className="cs-btn cs-btn-ghost" onClick={() => removeEquipmentLine(line.id)}>Remove line</button>}
              </div>
            ))}
            {!isReadOnly && <button type="button" className="cs-btn cs-btn-secondary" onClick={addEquipmentLine}>Add equipment line</button>}
          </div>
        )}
      </section>
      <section className="cs-form-section">
        <h2>Registration</h2>
        <YesNo
          question="Do attendees need to register?"
          name="registrationRequired"
          value={form.registrationRequired}
          onChange={(value) => answerSection("registrationRequired", value)}
          disabled={isReadOnly}
        />
        {form.registrationRequired === YES && (
          <div className="cs-form-grid">
            <label className="cs-field"><FieldName required>Registration capacity</FieldName><input readOnly={isReadOnly} type="number" min="1" step="1" value={form.registrationCapacity} onChange={(e) => update("registrationCapacity", e.target.value)} /></label>
            <label className="cs-field"><FieldName required>Registration open date</FieldName><input readOnly={isReadOnly} type="date" value={form.registrationOpenDate} onChange={(e) => update("registrationOpenDate", e.target.value)} /></label>
            <label className="cs-field"><FieldName required>Registration open time</FieldName><input readOnly={isReadOnly} type="time" value={form.registrationOpenTime} onChange={(e) => update("registrationOpenTime", e.target.value)} /></label>
            <label className="cs-field"><FieldName required>Registration close date</FieldName><input readOnly={isReadOnly} type="date" value={form.registrationCloseDate} onChange={(e) => update("registrationCloseDate", e.target.value)} /></label>
            <label className="cs-field"><FieldName required>Registration close time</FieldName><input readOnly={isReadOnly} type="time" value={form.registrationCloseTime} onChange={(e) => update("registrationCloseTime", e.target.value)} /></label>
          </div>
        )}
      </section>
      <section className="cs-form-section">
        <h2>Accessibility needs</h2>
        <YesNo
          question="Does your event have accessibility needs?"
          name="accessibilityRequired"
          value={form.accessibilityRequired}
          onChange={(value) => answerSection("accessibilityRequired", value)}
          disabled={isReadOnly}
        />
        {form.accessibilityRequired === YES && (
          <ToggleList
            label="Select all that apply"
            options={ACCESSIBILITY_OPTIONS}
            values={form.accessibility}
            onChange={isReadOnly ? () => {} : (value) => update("accessibility", value)}
            disabled={isReadOnly}
            required
          />
        )}
        <label className="cs-field cs-field-wide"><FieldName optional>Additional accessibility notes</FieldName><textarea readOnly={isReadOnly} rows="3" value={form.accessibilityNotes} onChange={(e) => update("accessibilityNotes", e.target.value)} /></label>
      </section>
      {/* B9 AC4 — every field that is missing or invalid is named, so the
          organiser knows exactly what to fix rather than hunting the form. */}
      {issues.length > 0 && (
        <div className="cs-error" role="alert">
          <p className="cs-error-lead">
            {issues.length === 1
              ? "One detail needs your attention before this request can be submitted:"
              : `${issues.length} details need your attention before this request can be submitted:`}
          </p>
          <ul className="cs-error-list">
            {issues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="cs-error" role="alert">{error}</p>}
      {!isReadOnly && <div className="cs-form-actions"><button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="cs-btn cs-btn-primary" disabled={busy}>{busy ? "Saving…" : "Submit request"}</button></div>}
    </form>
  );
}

