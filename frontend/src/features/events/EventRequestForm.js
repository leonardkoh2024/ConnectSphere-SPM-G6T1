// Event request creation and drafts (epic B). One form serves both: "Save draft"
// writes status DRAFT, "Submit" writes status SUBMITTED and stamps submitted_at.
//
// A request spans four collections — events, event_venue_requirements,
// event_facilities and event_accessibility — so every write here must keep them
// consistent with each other.

import React, { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { LAYOUTS, FACILITIES, ACCESSIBILITY_OPTIONS } from "../../domain/events";
import ToggleList from "./components/ToggleList";

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
  accessibility: [],
  accessibilityNotes: ""
};

export default function EventRequestForm({ user, draft, onSaved }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    let mounted = true;
    const loadDraft = async () => {
      if (!draft) { setForm(initialForm); return; }
      try {
        const [venueRequirement, facilitySnapshot, accessibilitySnapshot] = await Promise.all([
          getDoc(doc(db, "event_venue_requirements", draft.id)),
          getDocs(query(collection(db, "event_facilities"), where("event_id", "==", draft.id))),
          getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", draft.id)))
        ]);
        const requirement = venueRequirement.exists() ? venueRequirement.data() : {};
        if (mounted) setForm({
          name: draft.name || "", purpose: draft.purpose || "", description: draft.description || "",
          eventDate: draft.event_date || "", startTime: draft.start_time || "", endTime: draft.end_time || "",
          expectedAttendance: draft.expected_attendance ? String(draft.expected_attendance) : "",
          preferredLocation: requirement.preferred_location || "", requiredLayout: requirement.required_layout || "",
          facilities: facilitySnapshot.docs.map((item) => item.data().facility_id),
          accessibility: accessibilitySnapshot.docs.map((item) => item.data().accessibility_id),
          accessibilityNotes: requirement.accessibility_notes || ""
        });
      } catch (loadError) { console.error("Could not load draft requirements:", loadError); if (mounted) setError("We could not load this draft. Please try again."); }
    };
    loadDraft();
    return () => { mounted = false; };
  }, [draft]);

  const validate = () => {
    const required = ["name", "purpose", "description", "eventDate", "startTime", "endTime", "expectedAttendance"];
    if (required.some((field) => !String(form[field]).trim())) return "Complete all core event details before submitting.";
    const today = new Date().toISOString().slice(0, 10);
    if (form.eventDate < today) return "The proposed event date cannot be in the past.";
    if (form.endTime <= form.startTime) return "End time must be later than start time.";
    if (!/^\d+$/.test(form.expectedAttendance) || Number(form.expectedAttendance) < 1) return "Expected attendance must be a whole number greater than zero.";
    return "";
  };

  const save = async (submit) => {
    const validationError = submit ? validate() : "";
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
        registration_required: false,
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
      const [existingFacilities, existingAccessibility] = await Promise.all([
        getDocs(query(collection(db, "event_facilities"), where("event_id", "==", eventRef.id))),
        getDocs(query(collection(db, "event_accessibility"), where("event_id", "==", eventRef.id)))
      ]);
      await Promise.all([
        ...existingFacilities.docs.map((item) => deleteDoc(item.ref)),
        ...existingAccessibility.docs.map((item) => deleteDoc(item.ref)),
        ...form.facilities.map((facilityId) =>
          setDoc(doc(db, "event_facilities", `${eventRef.id}_${facilityId}`), { event_id: eventRef.id, facility_id: facilityId })
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
      {draft && <p className="cs-panel-note">Editing draft {draft.reference_no}. Submit when you are ready for coordinator review.</p>}
      <section className="cs-form-section">
        <h2>Core details</h2>
        <div className="cs-form-grid">
          <label className="cs-field cs-field-wide">Event name<input required value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
          <label className="cs-field">Purpose<input required value={form.purpose} onChange={(e) => update("purpose", e.target.value)} /></label>
          <label className="cs-field">Expected attendance<input required type="number" min="1" step="1" value={form.expectedAttendance} onChange={(e) => update("expectedAttendance", e.target.value)} /></label>
          <label className="cs-field cs-field-wide">Description<textarea required rows="4" value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
          <label className="cs-field">Proposed date<input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.eventDate} onChange={(e) => update("eventDate", e.target.value)} /></label>
          <label className="cs-field">Start time<input required type="time" value={form.startTime} onChange={(e) => update("startTime", e.target.value)} /></label>
          <label className="cs-field">End time<input required type="time" value={form.endTime} onChange={(e) => update("endTime", e.target.value)} /></label>
        </div>
      </section>
      <section className="cs-form-section">
        <h2>Venue requirements <span>Optional for a draft</span></h2>
        <div className="cs-form-grid">
          <label className="cs-field">Preferred location or area<input value={form.preferredLocation} onChange={(e) => update("preferredLocation", e.target.value)} /></label>
          <label className="cs-field">Required layout<select value={form.requiredLayout} onChange={(e) => update("requiredLayout", e.target.value)}><option value="">No preference</option>{LAYOUTS.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        </div>
        <ToggleList label="Required facilities" options={FACILITIES} values={form.facilities} onChange={(value) => update("facilities", value)} />
      </section>
      <section className="cs-form-section">
        <h2>Accessibility needs</h2>
        <ToggleList label="Select all that apply" options={ACCESSIBILITY_OPTIONS} values={form.accessibility} onChange={(value) => update("accessibility", value)} />
        <label className="cs-field cs-field-wide">Additional accessibility notes<textarea rows="3" value={form.accessibilityNotes} onChange={(e) => update("accessibilityNotes", e.target.value)} /></label>
      </section>
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-form-actions"><button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="cs-btn cs-btn-primary" disabled={busy}>{busy ? "Saving…" : "Submit request"}</button></div>
    </form>
  );
}

