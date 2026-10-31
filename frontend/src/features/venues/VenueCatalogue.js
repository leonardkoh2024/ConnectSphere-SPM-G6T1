import React, { useEffect, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "../../domain/events";
import { ROLES } from "../../domain/roles";
import { listCatalogue } from "../../domain/venueSearch";
import ToggleList from "../events/components/ToggleList";
import { VenueUnavailabilityManager } from "./VenueAvailability";
import VenueCalendar from "./VenueCalendar";
import { loadVenueSearchContext, saveVenueCatalogue, saveVenuePlanningDetails, saveVenueUnavailability } from "./venuesApi";
import VenueDetail, { VenueRows } from "./VenueDetail";

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const draftFrom = (venue) => ({
  ...venue,
  layouts: [...venue.layouts],
  facilities: [...venue.facilities],
  accessibility: [...venue.accessibility],
  operating_hours: venue.operating_hours.map((hours) => ({ ...hours }))
});

export default function VenueCatalogue({ user, role, showCalendar = false, onCloseCalendar }) {
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [unavailability, setUnavailability] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadVenueSearchContext({ userId: user?.uid, role })
      .then((context) => {
        if (!mounted) return;
        setVenues(context.venues);
        setBookings(context.bookings);
        setUnavailability(context.unavailability);
      })
      .catch((loadError) => { if (mounted) setError(loadError.message || "The venue catalogue could not be loaded."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [role, user?.uid]);

  if (loading) return <p className="cs-panel-note">Loading venue catalogue…</p>;
  if (error) return <p className="cs-error">{error}</p>;

  const listed = listCatalogue(venues).map((row) => {
    const full = venues.find((item) => item.venue_id === row.venue_id);
    return { ...full, ...row, facilities: row.headline_facilities };
  }).filter((venue) => !mineOnly || venue.is_assigned_to_user === true)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));

  const canEditVenue = (venue) => role === ROLES.VENUE_STAFF && venue.is_assigned_to_user === true;
  const canEditSelected = selected && canEditVenue(selected);
  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  // The time inputs render only for a weekday that already has hours, so there is always a row to update.
  const updateHours = (weekday, field, value) => setDraft((current) => ({
    ...current,
    operating_hours: current.operating_hours.map((row) => row.weekday === weekday ? { ...row, [field]: value } : row)
  }));
  const toggleWeekday = (weekday, enabled) => setDraft((current) => ({
    ...current,
    operating_hours: enabled
      ? [...current.operating_hours, { weekday, opens_at: "09:00", closes_at: "17:00" }]
      : current.operating_hours.filter((row) => row.weekday !== weekday)
  }));

  const saveChanges = async (event) => {
    event.preventDefault();
    if (!Number.isInteger(Number(draft.max_capacity)) || Number(draft.max_capacity) <= 0) {
      setSaveError("Maximum capacity must be a whole number greater than zero.");
      return;
    }
    if (!draft.layouts.length) {
      setSaveError("Select at least one supported room layout.");
      return;
    }
    if (!Number.isInteger(Number(draft.setup_minutes)) || Number(draft.setup_minutes) < 0) {
      setSaveError("Setup time must be a whole number of minutes at least zero.");
      return;
    }
    if (!Number.isInteger(Number(draft.turnaround_minutes)) || Number(draft.turnaround_minutes) < 0) {
      setSaveError("Turnaround time must be a whole number of minutes at least zero.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const saved = {
        ...draft,
        max_capacity: Number(draft.max_capacity),
        setup_minutes: Number(draft.setup_minutes),
        turnaround_minutes: Number(draft.turnaround_minutes),
        emergency_access_notes: String(draft.emergency_access_notes || "").trim(),
        known_restrictions: String(draft.known_restrictions || "").trim()
      };
      await saveVenueCatalogue(saved);
      await saveVenuePlanningDetails({
        user,
        venueId: saved.venue_id,
        changes: {
          setup_minutes: saved.setup_minutes,
          turnaround_minutes: saved.turnaround_minutes,
          emergency_access_notes: saved.emergency_access_notes,
          known_restrictions: saved.known_restrictions
        }
      });
      setVenues((current) => current.map((venue) => venue.venue_id === saved.venue_id ? saved : venue));
      setSelected(saved);
      setDraft(null);
    } catch (saveFailure) {
      setSaveError(saveFailure.message || "The venue record could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveUnavailabilityChanges = async ({ venueId, keepPeriodIds, additions, confirmOverlaps }) => {
    const result = await saveVenueUnavailability({ user, venueId, keepPeriodIds, additions, confirmOverlaps });
    setUnavailability((current) => [
      ...current.filter((period) => period.venue_id !== venueId),
      ...result.periods
    ]);
  };

  const venueEditor = draft && canEditSelected && (
    <form className="cs-form-section cs-venue-editor" aria-label="Edit venue" noValidate onSubmit={saveChanges}>
      <h2>Edit venue</h2>
      {saveError && <p className="cs-error" role="alert">{saveError}</p>}
      <div className="cs-form-grid">
        <label className="cs-field"><span className="cs-field-name">Venue name</span><input required value={draft.name || ""} onChange={(event) => updateDraft("name", event.target.value)} /></label>
        <label className="cs-field"><span className="cs-field-name">Building</span><input required value={draft.building || ""} onChange={(event) => updateDraft("building", event.target.value)} /></label>
        <label className="cs-field"><span className="cs-field-name">Location</span><select required value={draft.location || ""} onChange={(event) => updateDraft("location", event.target.value)}><option value="">Choose a location</option>{PREFERRED_LOCATIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="cs-field"><span className="cs-field-name">Maximum capacity</span><input required type="number" min="1" step="1" value={draft.max_capacity ?? ""} onChange={(event) => updateDraft("max_capacity", event.target.value === "" ? "" : Number(event.target.value))} /></label>
        <label className="cs-field"><span className="cs-field-name">Setup time (minutes)</span><input required type="number" min="0" step="1" value={draft.setup_minutes ?? 0} onChange={(event) => updateDraft("setup_minutes", event.target.value)} /></label>
        <label className="cs-field"><span className="cs-field-name">Turnaround time (minutes)</span><input required type="number" min="0" step="1" value={draft.turnaround_minutes ?? 0} onChange={(event) => updateDraft("turnaround_minutes", event.target.value)} /></label>
      </div>
      <ToggleList label="Supported room layouts" options={LAYOUTS} values={draft.layouts} onChange={(value) => updateDraft("layouts", value)} required />
      <ToggleList label="Facilities" options={FACILITIES} values={draft.facilities} onChange={(value) => updateDraft("facilities", value)} />
      <ToggleList label="Accessibility features" options={ACCESSIBILITY_OPTIONS} values={draft.accessibility} onChange={(value) => updateDraft("accessibility", value)} />
      <fieldset className="cs-choice-group">
        <legend>Operating hours</legend>
        <div className="cs-choice-list cs-venue-hours">
          {WEEKDAYS.map((weekday) => {
            const hours = draft.operating_hours.find((row) => row.weekday === weekday);
            return <div className="cs-venue-hours-row" key={weekday}>
              <label className="cs-check"><input type="checkbox" checked={Boolean(hours)} onChange={(event) => toggleWeekday(weekday, event.target.checked)} />{weekday.replaceAll("_", " ")}</label>
              {hours && <><label className="cs-field"><span className="cs-field-name">Opens</span><input aria-label={`${weekday} opens`} required type="time" value={hours.opens_at} onChange={(event) => updateHours(weekday, "opens_at", event.target.value)} /></label><label className="cs-field"><span className="cs-field-name">Closes</span><input aria-label={`${weekday} closes`} required type="time" value={hours.closes_at} onChange={(event) => updateHours(weekday, "closes_at", event.target.value)} /></label></>}
            </div>;
          })}
        </div>
      </fieldset>
      <label className="cs-field"><span className="cs-field-name">Space availability for special requirements</span><textarea rows="3" value={draft.special_space_availability || ""} onChange={(event) => updateDraft("special_space_availability", event.target.value)} /></label>
      <label className="cs-field"><span className="cs-field-name">Emergency access notes</span><textarea rows="3" value={draft.emergency_access_notes || ""} onChange={(event) => updateDraft("emergency_access_notes", event.target.value)} /></label>
      <label className="cs-field"><span className="cs-field-name">Known restrictions</span><textarea rows="3" value={draft.known_restrictions || ""} onChange={(event) => updateDraft("known_restrictions", event.target.value)} /></label>
      <div className="cs-form-actions"><button type="button" className="cs-btn cs-btn-ghost" onClick={() => { setDraft(null); setSaveError(""); }}>Cancel</button><button type="submit" className="cs-btn cs-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save venue"}</button></div>
    </form>
  );

  // E4 — "View calendar" in the page header swaps the list for the shared
  // availability calendar; Back returns to the list as it was left.
  if (showCalendar) {
    return <VenueCalendar venues={venues} bookings={bookings} unavailability={unavailability} role={role} onBack={onCloseCalendar} />;
  }

  return (
    <>
      <div className="cs-list-actions">
        <p className="cs-result-count" aria-live="polite">{listed.length} venue{listed.length === 1 ? "" : "s"}</p>
        {role === ROLES.VENUE_STAFF && (
          <button
            type="button"
            className={`cs-btn ${mineOnly ? "cs-btn-primary" : "cs-btn-ghost"}`}
            aria-pressed={mineOnly}
            onClick={() => {
              setMineOnly((current) => !current);
              setSelected(null);
              setDraft(null);
              setSaveError("");
            }}
          >
            My venues
          </button>
        )}
      </div>
      <VenueRows
        venues={listed}
        selectedId={selected?.venue_id}
        canEdit={canEditVenue}
        onSelect={(venue) => {
          const closing = selected?.venue_id === venue.venue_id && !draft;
          setSelected(closing ? null : venue);
          setDraft(null);
          setSaveError("");
        }}
        onUpdate={(venue) => {
          const closing = selected?.venue_id === venue.venue_id && draft?.venue_id === venue.venue_id;
          setSelected(closing ? null : venue);
          setDraft(closing ? null : draftFrom(venue));
          setSaveError("");
        }}
        renderSelected={(venue) => <>
          {draft?.venue_id === venue.venue_id ? venueEditor : <VenueDetail venue={venue} />}
          <VenueUnavailabilityManager
            venue={venue}
            periods={unavailability.filter((period) => period.venue_id === venue.venue_id)}
            canEdit={canEditVenue(venue)}
            bookings={bookings.filter((booking) => booking.venue_id === venue.venue_id)}
            onSave={saveUnavailabilityChanges}
          />
        </>}
      />
    </>
  );
}
