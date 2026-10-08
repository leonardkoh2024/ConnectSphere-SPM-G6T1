// E4 / SCRUM-120 — See when a venue is free. One calendar shared by every venue,
// opened from "View calendar" at the top right of the Venue catalogue.
//
// A month grid shows every venue's bookings, pending requests and blocked periods
// by default; filters narrow it to a venue, a location or a kind of entry.
// Choosing a day opens its hour-by-hour detail underneath: per venue, a 24-hour
// track of free, booked, blocked and closed time, listed again in words for
// anyone not reading the colours.
//
// The screen is given the catalogue's already-loaded venues, bookings and
// blocks rather than fetching its own, so it shows exactly what the list beside
// it was built from. The rules live in domain/venueCalendar.js.

import React, { useState } from "react";
import Icon from "../../app/Icon";
import MultiSelectDropdown from "./components/MultiSelectDropdown";
import { PREFERRED_LOCATIONS } from "../../domain/events";
import {
  buildMonthCalendar,
  buildVenueCalendar,
  emptyCalendarFilters,
  ENTRY_KINDS,
  isoDay,
  monthLabel,
  monthOf,
  parseDay,
  shiftMonth,
  SLOT
} from "../../domain/venueCalendar";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHIPS_PER_DAY = 3;

const BADGE = {
  [SLOT.FREE]: "Free",
  [SLOT.BOOKED]: "Booked",
  [SLOT.PENDING]: "Pending",
  [SLOT.BLOCKED]: "Blocked",
  [SLOT.CLOSED]: "Closed",
  [SLOT.UNKNOWN]: "No data"
};

const LEGEND = [SLOT.FREE, SLOT.BOOKED, SLOT.PENDING, SLOT.BLOCKED, SLOT.CLOSED];

const shortDay = (date) => {
  const value = parseDay(date);
  return `${DAY_NAMES[value.getDay()]} ${value.getDate()} ${MONTHS[value.getMonth()]}`;
};

const longDay = (date) => {
  const value = parseDay(date);
  return `${LONG_DAY_NAMES[value.getDay()]} ${value.getDate()} ${LONG_MONTHS[value.getMonth()]} ${value.getFullYear()}`;
};

const locationLabel = (value) => PREFERRED_LOCATIONS.find((item) => item.value === value)?.label.split(" — ")[0] || String(value).replaceAll("_", " ");

const toPercent = (clock) => {
  const [hours, minutes] = clock.split(":").map(Number);
  return ((hours * 60 + minutes) / (24 * 60)) * 100;
};

// One venue on one day, hour by hour.
function VenueDay({ venue, day, hasAvailabilityData }) {
  // Closed and unknown time is summarised by the hours line, so the list holds
  // only what a coordinator can act on: free windows and what occupies the rest.
  const listed = [
    ...day.segments.filter((segment) => segment.kind !== SLOT.CLOSED && segment.kind !== SLOT.UNKNOWN),
    ...day.pending
  ].sort((left, right) => left.start.localeCompare(right.start));

  return (
    <section className="cs-calendar-day" aria-label={venue.name}>
      <header className="cs-calendar-day-head">
        <strong>{venue.name}</strong>
        <span>{day.hours ? `Open ${day.hours.opens_at}–${day.hours.closes_at}` : hasAvailabilityData ? "Closed all day" : "Hours not recorded"}</span>
      </header>
      <div className="cs-calendar-track" aria-hidden="true">
        {day.segments.map((segment) => (
          <span
            key={`${segment.kind}-${segment.start}`}
            className={`cs-calendar-segment cs-calendar-${segment.kind}`}
            style={{ flexGrow: segment.minutes }}
            title={`${segment.start}–${segment.end} ${BADGE[segment.kind]}${segment.label ? ` · ${segment.label}` : ""}`}
          />
        ))}
        {day.pending.map((item) => (
          <span
            key={item.key}
            className="cs-calendar-pending-mark"
            style={{ left: `${toPercent(item.start)}%`, width: `${toPercent(item.end) - toPercent(item.start)}%` }}
            title={`${item.start}–${item.end} Pending · ${item.label}`}
          />
        ))}
      </div>
      {listed.length > 0 && (
        <ul className="cs-calendar-slots">
          {listed.map((item) => (
            <li className="cs-calendar-slot" key={`${item.key || item.kind}-${item.start}`}>
              <span className="cs-calendar-time">{item.start}–{item.end}</span>
              <span className={`cs-calendar-badge cs-calendar-badge-${item.kind}`}>{BADGE[item.kind]}</span>
              {item.label && item.label !== BADGE[item.kind] && <span className="cs-calendar-label">{item.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MonthCell({ cell, today, selected, single, onSelect }) {
  const shown = cell.entries.slice(0, CHIPS_PER_DAY);
  const more = cell.entries.length - shown.length;
  const classes = [
    "cs-month-cell",
    cell.inMonth ? "" : "cs-month-cell-outside",
    cell.date === today ? "cs-month-cell-today" : "",
    selected ? "cs-month-cell-selected" : "",
    cell.closed ? "cs-month-cell-closed" : ""
  ].filter(Boolean).join(" ");

  return (
    <td className={classes} onClick={() => onSelect(cell.date)}>
      <button
        type="button"
        className="cs-month-day"
        aria-label={`${shortDay(cell.date)}${cell.entries.length ? `, ${cell.entries.length} ${cell.entries.length === 1 ? "entry" : "entries"}` : ""}`}
        aria-pressed={selected}
        onClick={(event) => { event.stopPropagation(); onSelect(cell.date); }}
      >
        {cell.day}
      </button>
      {cell.closed && <span className="cs-month-closed">Closed</span>}
      {shown.length > 0 && (
        <ul className="cs-month-chips">
          {shown.map((entry) => (
            <li
              key={`${entry.key}-${cell.date}`}
              className={`cs-month-chip cs-month-chip-${entry.kind}`}
              title={`${BADGE[entry.kind]} · ${entry.venue_name} · ${entry.allDay ? "All day" : `${entry.start}–${entry.end}`}${entry.label !== BADGE[entry.kind] ? ` · ${entry.label}` : ""}`}
            >
              <span className="cs-visually-hidden">{BADGE[entry.kind]}: </span>
              <span className="cs-month-chip-time">{entry.allDay ? "All day" : entry.start}</span>
              <span className="cs-month-chip-text">{single ? entry.label : entry.venue_name}</span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <span className="cs-month-more">+{more} more</span>}
    </td>
  );
}

export default function VenueCalendar({ venueId, venues = [], bookings = [], unavailability = [], role, today = new Date(), onBack }) {
  const todayIso = isoDay(today);
  const [month, setMonth] = useState(() => monthOf(today));
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [filters, setFilters] = useState(() => ({ ...emptyCalendarFilters(), venueIds: venueId ? [venueId] : [] }));

  const calendar = buildMonthCalendar({ month, venues, bookings, unavailability, role, filters });
  const single = calendar.venues.length === 1 ? calendar.venues[0] : null;
  const sortedVenues = [...venues].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }));
  const locations = [...new Set(venues.map((venue) => venue.location).filter(Boolean))].sort();
  const filtersActive = filters.venueIds.length > 0 || filters.location || filters.kinds.length !== ENTRY_KINDS.length;

  const goToMonth = (next) => {
    setMonth(next);
    // Land on today in the current month, otherwise on the 1st.
    setSelectedDate(next === monthOf(today) ? todayIso : `${next}-01`);
  };
  const updateFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  const toggleKind = (kind, on) => updateFilter("kinds", on ? ENTRY_KINDS.filter((item) => item === kind || filters.kinds.includes(item)) : filters.kinds.filter((item) => item !== kind));

  const detail = calendar.venues.map((venue) => ({
    venue,
    calendar: buildVenueCalendar({ venueId: venue.venue_id, venues, from: selectedDate, to: selectedDate, bookings, unavailability, role })
  }));

  return (
    <section className="cs-venue-calendar" aria-label="Availability calendar">
      {onBack && (
        <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={onBack}>
          <Icon name="chevron-left" />Back to catalogue
        </button>
      )}

      <div className="cs-form-section cs-calendar-filters" aria-label="Calendar filters" role="group">
        <div className="cs-calendar-filter-row">
          {/* No venue ticked is every venue, so the calendar opens across the whole catalogue. */}
          <MultiSelectDropdown
            label="Venues"
            allLabel="All venues"
            pluralLabel="venues"
            options={sortedVenues.map((item) => ({ value: item.venue_id, label: item.name }))}
            values={filters.venueIds}
            onChange={(value) => updateFilter("venueIds", value)}
          />
          <label className="cs-field cs-calendar-location"><span className="cs-field-name">Location</span>
            <select value={filters.location} onChange={(event) => updateFilter("location", event.target.value)}>
              <option value="">All locations</option>
              {locations.map((value) => <option value={value} key={value}>{locationLabel(value)}</option>)}
            </select>
          </label>
          <fieldset className="cs-choice-group">
            <legend>Show</legend>
            <div className="cs-choice-list">
              {ENTRY_KINDS.map((kind) => (
                <label className="cs-check" key={kind}>
                  <input type="checkbox" checked={filters.kinds.includes(kind)} onChange={(event) => toggleKind(kind, event.target.checked)} />
                  <span className={`cs-calendar-swatch cs-calendar-${kind}`} aria-hidden="true" />{BADGE[kind]}
                </label>
              ))}
            </div>
          </fieldset>
          {filtersActive && <button type="button" className="cs-btn cs-btn-ghost cs-calendar-clear" onClick={() => setFilters(emptyCalendarFilters())}>Clear filters</button>}
        </div>
      </div>

      {!calendar.found ? (
        <p className="cs-panel-note" role="status">This venue could not be found. Choose another venue above.</p>
      ) : (
        <>
          <div className="cs-month-toolbar">
            <div className="cs-month-nav">
              <button type="button" className="cs-btn cs-btn-ghost cs-icon-btn" aria-label="Previous month" onClick={() => goToMonth(shiftMonth(month, -1))}><Icon name="chevron-left" /></button>
              <h2>{monthLabel(month)}</h2>
              <button type="button" className="cs-btn cs-btn-ghost cs-icon-btn" aria-label="Next month" onClick={() => goToMonth(shiftMonth(month, 1))}><Icon name="chevron-right" /></button>
              <button type="button" className="cs-btn cs-btn-ghost" onClick={() => goToMonth(monthOf(today))}>Today</button>
            </div>
            <ul className="cs-calendar-legend" aria-label="Legend">
              {LEGEND.map((kind) => <li key={kind}><span className={`cs-calendar-swatch cs-calendar-${kind}`} aria-hidden="true" />{BADGE[kind]}</li>)}
            </ul>
          </div>

          {!calendar.hasAvailabilityData && (
            <p className="cs-panel-note" role="status">
              No availability data: {single?.name || "this venue"} has no operating hours recorded, so free time cannot be shown.
              Bookings and blocked periods still appear.
            </p>
          )}
          {calendar.venues.length === 0 && <p className="cs-panel-note">No venues match these filters.</p>}

          <div className="cs-month-frame">
            <table className="cs-month" aria-label={monthLabel(month)}>
              <thead>
                <tr>{WEEK_HEADINGS.map((name) => <th scope="col" key={name}>{name}</th>)}</tr>
              </thead>
              <tbody>
                {calendar.weeks.map((week) => (
                  <tr key={week[0].date}>
                    {week.map((cell) => (
                      <MonthCell key={cell.date} cell={cell} today={todayIso} selected={cell.date === selectedDate} single={Boolean(single)} onSelect={setSelectedDate} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail.length > 0 && (
            <section className="cs-calendar-days" aria-label="Day detail">
              <h3>{longDay(selectedDate)}</h3>
              <div className="cs-calendar-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
              {detail.map(({ venue, calendar: venueCalendar }) => (
                <VenueDay key={venue.venue_id} venue={venue} day={venueCalendar.days[0]} hasAvailabilityData={venueCalendar.hasAvailabilityData} />
              ))}
            </section>
          )}
        </>
      )}
    </section>
  );
}
