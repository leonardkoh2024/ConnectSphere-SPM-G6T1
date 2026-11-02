// J1 / SCRUM-150 — the inbox every role has under Notifications. AC1: each row
// shows the message, the related event and when it arrived. AC3: unread rows are
// marked, and opening one marks it read. AC4: read rows stay in the list.
// View opens the related event on the screen the workspace picks for the role
// (J6: a booking or equipment outcome opens that booking or request instead);
// with no `onViewEvent`, or an event this user can no longer read, there is none.
// J8: nor is there one on a Lead's "cancelled" notice, whose event has left the queue.
// J9: a Safety Officer can read an event only while it is in Safety Review, so a waiting
// notice whose event is refused (false) or gone (null) says the event has left the queue,
// without a name, details, View or outcome.
// `loadEvents` replaces the Firestore lookup for a role that reads its events
// another way (an attendee, through their registrations).
// J1 bug: a lookup that fails, or that leaves an event out of its answer, no longer leaves the
// row on "Loading event…". The row names the event from the notice if it can, else says the
// details could not be loaded (no View), and one "Try again" looks the events up again.
// The list itself comes from the workspace (useNotifications), which also feeds
// the sidebar badge, so the two never disagree.

import React, { useEffect, useMemo, useState } from "react";
import { eventLabel, isUnread, notificationTypeLabel } from "../../domain/notifications";
import { openLeadAssignmentNotice, openSafetyReviewNotice } from "../../domain/safetyAndNotices";
import { eventsFor } from "./notificationsApi";
import RecordLead from "../../components/RecordLead";
import Icon from "../../app/Icon";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Just now";

const EVENT_NOT_LOADED = "Event details could not be loaded";

export default function NotificationInbox({ notifications, loading, error, onOpen, onViewEvent, loadEvents = eventsFor }) {
  const [openId, setOpenId] = useState(null);
  const [events, setEvents] = useState({});
  // "loading" until a lookup has answered or failed; the attempt count re-runs the effect for Try again.
  const [lookup, setLookup] = useState("loading");
  const [attempt, setAttempt] = useState(0);

  // Joined into one string so the effect re-runs only when the set of events
  // changes, not every time the live list hands over a new array.
  const eventKey = useMemo(() => [...new Set(notifications.map((item) => item.event_id).filter(Boolean))].sort().join("|"), [notifications]);

  useEffect(() => {
    if (!eventKey) return undefined;
    let mounted = true;
    setLookup("loading");
    loadEvents(eventKey.split("|")).then((found) => {
      if (!mounted) return;
      setEvents(found);
      setLookup("answered");
    }).catch((lookupError) => {
      if (!mounted) return;
      console.error("Could not load the events for the notifications:", lookupError);
      setLookup("failed");
    });
    return () => { mounted = false; };
  }, [eventKey, loadEvents, attempt]);

  const toggle = (notification) => {
    const opening = openId !== notification.id;
    setOpenId(opening ? notification.id : null);
    if (opening && isUnread(notification)) onOpen(notification.id);
  };

  if (loading) return <p className="cs-panel-note">Loading your notifications…</p>;

  if (!notifications.length) {
    return <div className="cs-empty">
      {error && <p className="cs-error">{error}</p>}
      <p>You have no notifications yet.</p>
    </div>;
  }

  const eventText = (notification) => {
    if (!notification.event_id) return "No related event";
    if (!(notification.event_id in events)) return lookup === "loading" ? "Loading event…" : (notification.event_name || EVENT_NOT_LOADED);
    const record = events[notification.event_id];
    if (record) return eventLabel(record);
    // J4 — a notice may carry its event's name for a role that cannot read it.
    if (notification.event_name) return notification.event_name;
    return record === false ? "Event details not shared with your role" : "Event no longer available";
  };

  // Once the lookup is over, an event it did not return is one it failed to load.
  const lookupFailed = lookup !== "loading" && notifications.some((item) => item.event_id && !(item.event_id in events));

  // Viewing the event is attending to the notification, so it counts as opening it.
  const view = (notification, event) => {
    if (isUnread(notification)) onOpen(notification.id);
    onViewEvent(event, notification);
  };

  return <>
    {error && <p className="cs-error">{error}</p>}
    {lookupFailed && <p className="cs-error cs-notification-retry">
      We could not look up some of these events.{" "}
      <button type="button" className="cs-btn cs-btn-secondary cs-record-btn" onClick={() => setAttempt((count) => count + 1)}>Try again</button>
    </p>}
    <ul className="cs-record-list cs-notification-list" aria-label="Notifications">{notifications.map((notification) => {
      const unread = isUnread(notification);
      const open = openId === notification.id;
      const detailId = `notification-${notification.id}`;
      const event = onViewEvent ? events[notification.event_id] : null;
      const assignment = notification.type === "UNASSIGNED_EVENT" && event ? openLeadAssignmentNotice({ event }) : null;
      const looked = notification.event_id in events ? events[notification.event_id] : undefined;
      const safety = notification.type === "SAFETY_REVIEW_WAITING" && looked !== undefined ? openSafetyReviewNotice({ event: looked || undefined }) : null;
      const offerView = event && assignment?.offer_assignment !== false && !safety?.left_queue && notification.type !== "UNASSIGNED_EVENT_CANCELLED";
      return <li key={notification.id} className={unread ? "cs-record cs-notification cs-notification-unread" : "cs-record cs-notification"}>
        <div className="cs-notification-row">
          <button type="button" className="cs-notification-open" aria-expanded={open} aria-controls={detailId} onClick={() => toggle(notification)}>
            <RecordLead icon="bell" />
            <span className="cs-notification-summary">
              <span className="cs-notification-heading">
                {unread && <span className="cs-notification-dot" aria-hidden="true" />}
                <strong>{notificationTypeLabel(notification.type)}</strong>
                {unread && <span className="cs-visually-hidden">Unread</span>}
              </span>
              <span className="cs-notification-message">{open && safety?.left_queue ? safety.message : notification.message}</span>
              {!safety?.left_queue && <span className="cs-notification-event">{eventText(notification)}</span>}
            </span>
            <time className="cs-notification-time" dateTime={notification.created_at || undefined}>{shownTime(notification.created_at)}</time>
          </button>
          {offerView && <button type="button" className="cs-btn cs-btn-secondary cs-record-btn cs-notification-view" aria-label={`View ${eventLabel(event)}`} onClick={() => view(notification, event)}>View<Icon name="arrow-right" /></button>}
        </div>
        {open && <dl className="cs-detail-grid cs-record-expanded cs-notification-detail" id={detailId}>
          <div className="cs-detail-wide"><dt>Message</dt><dd>{safety?.left_queue ? safety.message : notification.message}</dd></div>
          {assignment && !assignment.offer_assignment && <div><dt>Coordinator</dt><dd>{event.coordinator_name || assignment.current_coordinator_id}</dd></div>}
          {!safety?.left_queue && <div><dt>Event</dt><dd>{eventText(notification)}</dd></div>}
          <div><dt>Received</dt><dd>{shownTime(notification.created_at)}</dd></div>
        </dl>}
      </li>;
    })}</ul>
  </>;
}
