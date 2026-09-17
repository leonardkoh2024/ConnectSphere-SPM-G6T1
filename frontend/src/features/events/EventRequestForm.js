// Event request creation and drafts (epic B). One form serves both: "Save draft"
// writes status DRAFT, "Submit" writes status SUBMITTED and stamps submitted_at.
//
// A request spans five collections — events, event_venue_requirements,
// event_facilities, event_equipment and event_accessibility — so every write here
// must keep them consistent with each other.

import React, { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { LAYOUTS, FACILITIES, ACCESSIBILITY_OPTIONS } from "../../domain/events";
import { equipmentLinesWithContent, todayIso, validateEventRequest } from "../../domain/eventRequest";
import ToggleList from "./components/ToggleList";

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
  facilities: [],
  equipmentLines: [createEquipmentLine()],
  registrationRequired: false,
  registrationCapacity: "",
  registrationOpenDate: "",
  registrationOpenTime: "",
  registrationCloseDate: "",
  registrationCloseTime: "",
  accessibility: [],
  accessibilityNotes: ""
};

export default function EventRequestForm({ user, draft, onSaved, readOnly = false }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isReadOnly = readOnly || (draft && String(draft.status || "").toUpperCase() !== "DRAFT");

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

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
          facilities: facilitySnapshot.docs.map((item) => item.data().facility_id),
          equipmentLines,
          registrationRequired: Boolean(draft.registration_required),
          registrationCapacity: draft.registration_capacity ? String(draft.registration_capacity) : "",
          registrationOpenDate: draft.registration_open_date || "",
          registrationOpenTime: draft.registration_open_time || "",
          registrationCloseDate: draft.registration_close_date || "",
          registrationCloseTime: draft.registration_close_time || "",
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
    const validationError = validateEventRequest(form, { mode: submit ? "submit" : "draft" });
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const eventData = {
        reference_no: `EVT-${Date.now().toString().slice(-6)}`,
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
        registration_required: Boolean(form.registrationRequired),
        registration_capacity: form.registrationRequired && form.registrationCapacity ? Number(form.registrationCapacity) : null,
        registration_open_date: form.registrationRequired ? form.registrationOpenDate || null : null,
        registration_open_time: form.registrationRequired ? form.registrationOpenTime || null : null,
        registration_close_date: form.registrationRequired ? form.registrationCloseDate || null : null,
        registration_close_time: form.registrationRequired ? form.registrationCloseTime || null : null,
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
        accessibility_notes: form.accessibilityNotes.trim()
      });
      const equipmentLines = equipmentLinesWithContent(form);
      const [existingFacilities, existingEquipment, existingAccessibility] = await Promise.all([
        getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventRef.id))),
        getDocs(query(collection(db, "event_equipment"), where("event_id", "==", eventRef.id))),
        getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventRef.id)))
      ]);
      await Promise.all([
        ...existingFacilities.docs.map((item) => deleteDoc(item.ref)),
        ...existingEquipment.docs.map((item) => deleteDoc(item.ref)),
        ...existingAccessibility.docs.map((item) => deleteDoc(item.ref)),
        ...form.facilities.map((facilityId) =>
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
        ...form.accessibility.map((accessibilityId) =>
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
      onSaved(submit ? "Event request submitted for coordinator review." : "Draft saved. You can return to it from My drafts.", submit ? null : { id: eventRef.id, ...eventData });
    } catch (saveError) {
      console.error("Could not save event request:", saveError);
      setError("We could not save your event request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="cs-event-form" onSubmit={(event) => { event.preventDefault(); save(true); }}>
      {draft && <p className="cs-panel-note">{isReadOnly ? `Viewing request ${draft.reference_no}. This request is no longer editable.` : `Editing draft ${draft.reference_no}. Submit when you are ready for coordinator review.`}</p>}
      <section className="cs-form-section">
        <h2>Core details</h2>
        <div className="cs-form-grid">
          <label className="cs-field cs-field-wide">Event name<input required readOnly={isReadOnly} value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
          <label className="cs-field">Purpose<input required readOnly={isReadOnly} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} /></label>
          <label className="cs-field">Expected attendance<input required readOnly={isReadOnly} type="number" min="1" step="1" value={form.expectedAttendance} onChange={(e) => update("expectedAttendance", e.target.value)} /></label>
          <label className="cs-field cs-field-wide">Description<textarea required readOnly={isReadOnly} rows="4" value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
          <label className="cs-field">Proposed date<input required readOnly={isReadOnly} type="date" min={todayIso()} value={form.eventDate} onChange={(e) => update("eventDate", e.target.value)} /></label>
          <label className="cs-field">Start time<input required readOnly={isReadOnly} type="time" value={form.startTime} onChange={(e) => update("startTime", e.target.value)} /></label>
          <label className="cs-field">End time<input required readOnly={isReadOnly} type="time" value={form.endTime} onChange={(e) => update("endTime", e.target.value)} /></label>
        </div>
      </section>
      <section className="cs-form-section">
        <h2>Venue requirements <span>Optional for a draft</span></h2>
        <div className="cs-form-grid">
          <label className="cs-field">Preferred location or area<input readOnly={isReadOnly} value={form.preferredLocation} onChange={(e) => update("preferredLocation", e.target.value)} /></label>
          <label className="cs-field">Required layout<select disabled={isReadOnly} value={form.requiredLayout} onChange={(e) => update("requiredLayout", e.target.value)}><option value="">No preference</option>{LAYOUTS.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        </div>
        <ToggleList label="Required facilities" options={FACILITIES} values={form.facilities} onChange={isReadOnly ? () => {} : (value) => update("facilities", value)} disabled={isReadOnly} />
      </section>
      <section className="cs-form-section">
        <h2>Equipment requirements</h2>
        <div className="cs-form-stack">
          {form.equipmentLines.map((line, index) => (
            <div className="cs-form-grid cs-equipment-line" key={line.id}>
              <label className="cs-field">Equipment type<input aria-label={`Equipment type ${index + 1}`} readOnly={isReadOnly} value={line.equipmentType} onChange={(e) => updateEquipmentLine(line.id, "equipmentType", e.target.value)} /></label>
              <label className="cs-field">Quantity<input aria-label={`Quantity ${index + 1}`} readOnly={isReadOnly} type="number" min="1" step="1" value={line.quantity} onChange={(e) => updateEquipmentLine(line.id, "quantity", e.target.value)} /></label>
              <label className="cs-field cs-field-wide">Technical note (optional)<textarea aria-label={`Technical note ${index + 1}`} readOnly={isReadOnly} rows="2" value={line.technicalNote} onChange={(e) => updateEquipmentLine(line.id, "technicalNote", e.target.value)} /></label>
              {form.equipmentLines.length > 1 && !isReadOnly && <button type="button" className="cs-btn cs-btn-ghost" onClick={() => removeEquipmentLine(line.id)}>Remove line</button>}
            </div>
          ))}
          {!isReadOnly && <button type="button" className="cs-btn cs-btn-secondary" onClick={addEquipmentLine}>Add equipment line</button>}
        </div>
      </section>
      <section className="cs-form-section">
        <h2>Registration</h2>
        <label className="cs-field cs-field-inline" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={form.registrationRequired} onChange={(e) => update("registrationRequired", e.target.checked)} disabled={isReadOnly} style={{ width: "0.9rem", height: "0.9rem" }} />
          Registration required
        </label>
        {form.registrationRequired && (
          <div className="cs-form-grid">
            <label className="cs-field">Registration capacity<input readOnly={isReadOnly} type="number" min="1" step="1" value={form.registrationCapacity} onChange={(e) => update("registrationCapacity", e.target.value)} /></label>
            <label className="cs-field">Registration open date<input readOnly={isReadOnly} type="date" value={form.registrationOpenDate} onChange={(e) => update("registrationOpenDate", e.target.value)} /></label>
            <label className="cs-field">Registration open time<input readOnly={isReadOnly} type="time" value={form.registrationOpenTime} onChange={(e) => update("registrationOpenTime", e.target.value)} /></label>
            <label className="cs-field">Registration close date<input readOnly={isReadOnly} type="date" value={form.registrationCloseDate} onChange={(e) => update("registrationCloseDate", e.target.value)} /></label>
            <label className="cs-field">Registration close time<input readOnly={isReadOnly} type="time" value={form.registrationCloseTime} onChange={(e) => update("registrationCloseTime", e.target.value)} /></label>
          </div>
        )}
      </section>
      <section className="cs-form-section">
        <h2>Accessibility needs</h2>
        <ToggleList label="Select all that apply" options={ACCESSIBILITY_OPTIONS} values={form.accessibility} onChange={isReadOnly ? () => {} : (value) => update("accessibility", value)} disabled={isReadOnly} />
        <label className="cs-field cs-field-wide">Additional accessibility notes<textarea readOnly={isReadOnly} rows="3" value={form.accessibilityNotes} onChange={(e) => update("accessibilityNotes", e.target.value)} /></label>
      </section>
      {error && <p className="cs-error" role="alert">{error}</p>}
      {!isReadOnly && <div className="cs-form-actions"><button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="cs-btn cs-btn-primary" disabled={busy}>{busy ? "Saving…" : "Submit request"}</button></div>}
    </form>
  );
}

