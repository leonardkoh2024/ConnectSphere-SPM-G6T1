// The signed-in shell: role sidebar, screen dispatch and the "not authorised"
// guard for a hash that does not belong to the current role. The sidebar carries
// everything chrome-like — brand, screens, and the signed-in user at its foot —
// so there is no top bar and the main panel gets the full height.
//
// As each epic is picked up its screens should be rendered from its own feature
// folder and added to the dispatch below, rather than growing this file inline.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { ROLES, ROLE_META } from "../domain/roles";
import { screenHash } from "./routes";
import OrganiserEventDetail from "../features/events/OrganiserEventDetail";
import EventList from "../features/events/EventList";
import EventReviewScreen from "../features/events/EventReviewScreen";
import LeadAssignmentScreen from "../features/events/LeadAssignmentScreen";
import VenueCatalogue from "../features/venues/VenueCatalogue";
import VenueAvailabilityCalendar from "../features/venues/VenueAvailability";
import VenueBookings from "../features/venues/VenueBookings";
import VenueBookingQueue from "../features/venues/VenueBookingQueue";
import VenueSearch from "../features/venues/VenueSearch";
import EquipmentRequestsScreen from "../features/equipment/EquipmentRequestsScreen";
import EquipmentQueueScreen from "../features/equipment/EquipmentQueueScreen";
import EquipmentAvailabilityScreen from "../features/equipment/EquipmentAvailabilityScreen";
import NotificationInbox from "../features/notifications/NotificationInbox";
import useNotifications from "../features/notifications/useNotifications";
import { badgeText, eventViewScreen } from "../domain/notifications";
import Icon from "./Icon";
import Toasts from "./Toasts";

export default function Workspace({ user, role }) {
  const meta = ROLE_META[role];
  // J1 — one live inbox for the session: the Notifications screen lists it and
  // the sidebar badge counts its unread items.
  const inbox = useNotifications(user.uid);
  const unreadBadge = badgeText(inbox.unread);
  const viewScreen = eventViewScreen(role);
  // Confirmations are toasts in the corner, not a line at the top of a panel the
   // organiser has scrolled away from. The account-created message arrives the same
   // way, having been left in sessionStorage by the landing page.
  const [toasts, setToasts] = useState(() => {
    const message = sessionStorage.getItem("cs-account-created") || "";
    sessionStorage.removeItem("cs-account-created");
    return message ? [{ id: "account-created", message }] : [];
  });

  const showToast = useCallback((message, tone = "success") => {
    setToasts((current) => [...current, { id: `${Date.now()}-${current.length}`, message, tone }]);
  }, []);

  const dismissToast = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("cs-nav-collapsed") === "1");
  const initialScreen = useMemo(() => meta.screens.find((item) => screenHash(role, item.name) === window.location.hash)?.name || meta.screens[0].name, [meta.screens, role]);
  const [activeScreen, setActiveScreen] = useState(initialScreen);
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [searchEvent, setSearchEvent] = useState(null);
  const [bookingTarget, setBookingTarget] = useState({ event: null, venue: null });
  const [venueCalendarOpen, setVenueCalendarOpen] = useState(false);
  const [bookingFormOpen, setBookingFormOpen] = useState(false);
  const [reviewEventId, setReviewEventId] = useState(null);
  // Where "Back to …" goes. `cameFrom` is the screen that opened this one from
  // inside a page (the sidebar clears it); `innerBack` is set by a screen while it
  // shows a detail view of its own, and closes that view.
  const [cameFrom, setCameFrom] = useState(null);
  const [innerBack, setInnerBack] = useState(null);
  const reportBack = useCallback((close) => setInnerBack(() => close || null), []);
  const requestedPath = currentHash;
  const pathLooksProtected = requestedPath.startsWith("#/") && requestedPath !== "#/sign-in";
  const requestedScreen = meta.screens.find((item) => screenHash(role, item.name) === requestedPath);
  const forbidden = pathLooksProtected && !requestedScreen;
  const screen = meta.screens.find((item) => item.name === activeScreen) || meta.screens[0];

  useEffect(() => {
    const syncFromHash = () => { setCurrentHash(window.location.hash); const found = meta.screens.find((item) => screenHash(role, item.name) === window.location.hash); if (found) setActiveScreen(found.name); };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [meta.screens, role]);

  useEffect(() => { localStorage.setItem("cs-nav-collapsed", navCollapsed ? "1" : "0"); }, [navCollapsed]);

  // Every screen opens with the same header, which is what `.cs-panel-head`
  // sticks to the top of the scrolling panel. The back button, when there is one,
  // is always its first line — never somewhere inside the screen.
  const head = (title, lede, action) => <header className="cs-panel-head">{forbidden ? null : backButton}<div className="cs-panel-head-row"><div className="cs-panel-title">{!forbidden && <span className="cs-panel-icon" aria-hidden="true"><Icon name={screen.icon} /></span>}<div><h1>{title}</h1>{lede ? <p className="cs-lede">{lede}</p> : null}</div></div>{action}</div></header>;

  const chooseScreen = (name, extras = {}) => {
    setCameFrom(extras.from && extras.from !== name ? extras.from : null);
    setActiveScreen(name);
    setCurrentHash(screenHash(role, name));
    if (name !== "New event request") setSelectedDraft(null);
    setVenueCalendarOpen(false);
    setBookingFormOpen(name === "Venue bookings" && Boolean(extras.event || extras.venue));
    setSearchEvent(name === "Venue catalogue" ? extras.event || null : null);
    setBookingTarget(name === "Venue bookings" ? { event: extras.event || null, venue: extras.venue || null } : { event: null, venue: null });
    setReviewEventId(name === "Assigned events" ? extras.eventId || null : null);
    window.location.hash = screenHash(role, name);
  };
  // E4 — one availability calendar shared by every venue, opened from the top
  // right of the Venue catalogue header. The catalogue swaps to it in place.
  const viewCalendar = venueCalendarOpen ? null : (
    <button type="button" className="cs-btn cs-btn-secondary" onClick={() => setVenueCalendarOpen(true)}>
      <Icon name="calendar" />View calendar
    </button>
  );
  // E8 — raising a booking starts from the page header, where the catalogue
  // offers View calendar, so the two venue screens read the same way.
  const newBooking = bookingFormOpen ? null : (
    <button type="button" className="cs-btn cs-btn-primary" onClick={() => setBookingFormOpen(true)}>
      <Icon name="plus" />New booking request
    </button>
  );
  // Same placement for the organiser's own list: the action that starts a new
  // request lives in the page header, not above the rows.
  const newEventRequest = (
    <button type="button" className="cs-btn cs-btn-primary" onClick={() => { setSelectedDraft(null); goTo("New event request"); }}>
      <Icon name="plus" />Create new event request
    </button>
  );
  const closeCalendar = () => setVenueCalendarOpen(false);

  // J1 — View on a notification. The organiser's request page takes the event
  // record itself, as My events hands it over; the coordinator's review screen
  // loads the event by id.
  const viewEvent = (event) => {
    if (viewScreen === "New event request") setSelectedDraft(event);
    goTo(viewScreen, { eventId: event.id });
  };

  // Navigation from inside a page remembers where it started, so the next screen
  // can offer the way back. The sidebar calls chooseScreen directly and does not.
  const goTo = (name, extras = {}) => chooseScreen(name, { ...extras, from: screen.name });

  // Innermost first: a detail view returns to its own list, the calendar to the
  // catalogue, and only then does the screen return to the one that opened it.
  // The organiser's request form always belongs to My events.
  const back = innerBack ? { to: screen.name, onClick: innerBack }
    : venueCalendarOpen ? { to: screen.name, onClick: closeCalendar }
    : cameFrom ? { to: cameFrom, onClick: () => chooseScreen(cameFrom) }
    : screen.name === "New event request" ? { to: "My events", onClick: () => chooseScreen("My events") }
    : null;
  const backButton = back && (
    <button type="button" className="cs-btn cs-btn-ghost cs-back" onClick={back.onClick}>
      <Icon name="chevron-left" />Back to {back.to.toLowerCase()}
    </button>
  );
  let contents;
  if (forbidden) contents = <>{head("Not authorised")}<p className="cs-error">You are not authorised to access this function.</p></>;
  else if (role === ROLES.ORGANISER && screen.name === "New event request") contents = <>{head(selectedDraft ? "Event request" : screen.name, "Save a draft any time, or submit when ready.")}<OrganiserEventDetail user={user} event={selectedDraft} onNotice={showToast} onSaved={(message, savedDraft) => { showToast(message); setSelectedDraft(savedDraft); if (!savedDraft) chooseScreen("My events"); }} /></>;
  else if (role === ROLES.ORGANISER && screen.name === "My events") contents = <>{head("My events", "Your requests and drafts.", newEventRequest)}<EventList user={user} role={role} headerHosted onCreate={() => { setSelectedDraft(null); goTo("New event request"); }} onEdit={(draft) => { setSelectedDraft(draft); goTo("New event request"); }} onView={(event) => { setSelectedDraft(event); goTo("New event request"); }} onDeleted={(message) => showToast(message)} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Review queue") contents = <>{head(screen.name, screen.blurb)}<EventReviewScreen queueOnly onNotice={showToast} onBackChange={reportBack} onFindVenues={(event) => goTo("Venue catalogue", { event })} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Assigned events") contents = <>{head(screen.name, screen.blurb)}<EventReviewScreen onNotice={showToast} initialEventId={reviewEventId} onBackChange={reportBack} onFindVenues={(event) => goTo("Venue catalogue", { event })} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Venue catalogue") contents = <>{head(screen.name, searchEvent ? `Shortlist for ${searchEvent.name || searchEvent.reference_no}.` : screen.blurb, viewCalendar)}<VenueSearch event={searchEvent} onBookVenue={(event, venue) => goTo("Venue bookings", { event, venue })} showCalendar={venueCalendarOpen} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Venue bookings") contents = <>{head(screen.name, screen.blurb, newBooking)}<VenueBookings user={user} creating={bookingFormOpen} onCreatingChange={setBookingFormOpen} event={bookingTarget.event} venue={bookingTarget.venue} onBackChange={reportBack} onViewEvent={(eventId) => goTo("Assigned events", { eventId })} /></>;
  else if (role === ROLES.COORDINATOR && screen.name === "Equipment requests") contents = <>{head(screen.name, screen.blurb)}<EquipmentRequestsScreen onNotice={showToast} /></>;
  else if (role === ROLES.TECH_SUPPORT && screen.name === "Equipment queue") contents = <>{head(screen.name, screen.blurb)}<EquipmentQueueScreen /></>;
  else if (role === ROLES.TECH_SUPPORT && screen.name === "Availability check") contents = <>{head(screen.name, screen.blurb)}<EquipmentAvailabilityScreen /></>;
  else if (role === ROLES.VENUE_STAFF && screen.name === "Booking requests") contents = <>{head(screen.name, screen.blurb)}<VenueBookingQueue user={user} onNotice={showToast} /></>;
  else if (role === ROLES.VENUE_STAFF && screen.name === "Venue catalogue") contents = <>{head(screen.name, screen.blurb, viewCalendar)}<VenueCatalogue user={user} role={role} showCalendar={venueCalendarOpen} /></>;
  else if (role === ROLES.VENUE_STAFF && screen.name === "Availability calendar") contents = <>{head(screen.name, screen.blurb)}<VenueAvailabilityCalendar user={user} role={role} /></>;
  else if (role === ROLES.COORDINATOR_LEAD && screen.name === "Unassigned queue") contents = <>{head(screen.name, screen.blurb)}<LeadAssignmentScreen view="queue" onNotice={showToast} /></>;
  else if (role === ROLES.COORDINATOR_LEAD && screen.name === "Oversight") contents = <>{head(screen.name, screen.blurb)}<LeadAssignmentScreen view="oversight" onNotice={showToast} /></>;
  else if (screen.name === "Notifications") contents = <>{head(screen.name, screen.blurb)}<NotificationInbox notifications={inbox.notifications} loading={inbox.loading} error={inbox.error} onOpen={inbox.markRead} onViewEvent={viewScreen ? viewEvent : undefined} /></>;
  else contents = <>{head(screen.name, screen.blurb)}<p className="cs-panel-note">This screen is ready to be connected to its workflow in a later increment.</p></>;

  return <div className={navCollapsed ? "cs-workspace cs-workspace-collapsed" : "cs-workspace"}><div className="cs-workspace-body"><nav className="cs-sidebar" aria-label="Your screens"><div className="cs-sidebar-head"><span className="cs-brand"><span className="cs-brand-mark" aria-hidden="true" /><span className="cs-sidebar-label">ConnectSphere</span></span><button type="button" className="cs-sidebar-toggle" aria-expanded={!navCollapsed} aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"} title={navCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setNavCollapsed((value) => !value)}><Icon name={navCollapsed ? "chevron-right" : "chevron-left"} /></button></div><div className="cs-sidebar-screens">{meta.screens.filter((item) => !item.hidden).map((item) => <button key={item.name} type="button" title={item.name} className={item.name === screen.name && !forbidden ? "cs-sidebar-item cs-sidebar-item-active" : "cs-sidebar-item"} onClick={() => chooseScreen(item.name)}><Icon name={item.icon} /><span className="cs-sidebar-label">{item.name}</span>{item.name === "Notifications" && unreadBadge && <span className="cs-nav-badge" aria-label={`${inbox.unread} unread`}>{unreadBadge}</span>}</button>)}</div><div className="cs-sidebar-user"><div className="cs-sidebar-user-row"><span className="cs-sidebar-avatar" aria-hidden="true">{(user.email || "?").charAt(0).toUpperCase()}</span><div className="cs-sidebar-label cs-sidebar-user-detail"><span className="cs-pill">{meta.label}</span><span className="cs-user-email" title={user.email}>{user.email}</span></div></div><button className="cs-btn cs-btn-ghost cs-sidebar-logout" type="button" title="Log out" aria-label="Log out" onClick={() => { window.location.hash = "#/sign-in"; signOut(auth); }}><Icon name="log-out" /><span className="cs-sidebar-label">Log out</span></button></div></nav><main className="cs-panel-scroll"><div className="cs-panel">{contents}</div></main></div><Toasts toasts={toasts} onDismiss={dismissToast} /></div>;
}
