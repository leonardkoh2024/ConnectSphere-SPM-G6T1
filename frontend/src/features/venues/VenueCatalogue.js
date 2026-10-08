import React, { useEffect, useState } from "react";
import { ACCESSIBILITY_OPTIONS, FACILITIES, LAYOUTS, PREFERRED_LOCATIONS } from "../../domain/events";
import { ROLES } from "../../domain/roles";
import { listCatalogue } from "../../domain/venueSearch";
import ToggleList from "../events/components/ToggleList";
import { VenueUnavailabilityManager } from "./VenueAvailability";
import VenueCalendar from "./VenueCalendar";
import { loadVenueSearchContext, saveVenueCatalogue, saveVenueUnavailability } from "./venuesApi";
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
  }).sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));

  const canEditVenue = (venue) => role === ROLES.VENUE_STAFF && venue.is_assigned_to_user === true;
  const canEditSelected = selected && canEditVenue(selected);
  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const updateHours = (weekday, field, value) => setDraft((current) => {
    const existing = current.operating_hours.find((row) => row.weekday === weekday);
    const operatingHours = existing
      ? current.operating_hours.map((row) => row.weekday === weekday ? { ...row, [field]: value } : row)
      : [...current.operating_hours, { weekday, opens_at: "09:00", closes_at: "17:00", [field]: value }];
    return { ...current, operating_hours: operatingHours };
  });
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
    setSaving(true);
    setSaveError("");
    try {
      const saved = { ...draft, max_capacity: Number(draft.max_capacity) };
      await saveVenueCatalogue(saved);
      setVenues((current) => current.map((venue) => venue.venue_id === saved.venue_id ? saved : venue));
      setSelected(saved);
      setDraft(null);
    } catch (saveFailure) {
      setSaveError(saveFailure.message || "The venue record could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveUnavailabilityChanges = async ({ venueId, keepPeriodIds, additions }) => {
    const result = await saveVenueUnavailability({ user, venueId, keepPeriodIds, additions });
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
      <p className="cs-result-count" aria-live="polite">{listed.length} venue{listed.length === 1 ? "" : "s"}</p>
      <VenueRows
        venues={listed}
        selectedId={selected?.venue_id}
        canEdit={canEditVenue}
        onSelect={(venue) => { setSelected(venue); setDraft(null); setSaveError(""); }}
        onUpdate={(venue) => { setSelected(venue); setDraft(draftFrom(venue)); setSaveError(""); }}
        renderSelected={(venue) => <>
          {draft?.venue_id === venue.venue_id ? venueEditor : <VenueDetail venue={venue} />}
          <VenueUnavailabilityManager
            venue={venue}
            periods={unavailability.filter((period) => period.venue_id === venue.venue_id)}
            canEdit={canEditVenue(venue)}
            onSave={saveUnavailabilityChanges}
          />
        </>}
      />
    </>
  );
}
