// J1 / SCRUM-150 — the inbox every role has under Notifications. AC1: each row
// shows the message, the related event and when it arrived. AC3: unread rows are
// marked, and opening one marks it read. AC4: read rows stay in the list.
// View opens the related event on the screen the workspace picks for the role
// (J6: a booking or equipment outcome opens that booking or request instead);
// with no `onViewEvent`, or an event this user can no longer read, there is none.
// The list itself comes from the workspace (useNotifications), which also feeds
// the sidebar badge, so the two never disagree.

import React, { useEffect, useMemo, useState } from "react";
import { eventLabel, isUnread, notificationTypeLabel } from "../../domain/notifications";
import { eventsFor } from "./notificationsApi";
import RecordLead from "../../components/RecordLead";
import Icon from "../../app/Icon";

const shownTime = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Just now";

export default function NotificationInbox({ notifications, loading, error, onOpen, onViewEvent }) {
  const [openId, setOpenId] = useState(null);
  const [events, setEvents] = useState({});

  // Joined into one string so the effect re-runs only when the set of events
  // changes, not every time the live list hands over a new array.
  const eventKey = useMemo(() => [...new Set(notifications.map((item) => item.event_id).filter(Boolean))].sort().join("|"), [notifications]);

  useEffect(() => {
    if (!eventKey) return undefined;
    let mounted = true;
    eventsFor(eventKey.split("|")).then((found) => { if (mounted) setEvents(found); });
    return () => { mounted = false; };
  }, [eventKey]);

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
    if (!(notification.event_id in events)) return "Loading event…";
    return eventLabel(events[notification.event_id]) || "Event no longer available";
  };

  // Viewing the event is attending to the notification, so it counts as opening it.
  const view = (notification, event) => {
    if (isUnread(notification)) onOpen(notification.id);
    onViewEvent(event, notification);
  };

  return <>
    {error && <p className="cs-error">{error}</p>}
    <ul className="cs-record-list cs-notification-list" aria-label="Notifications">{notifications.map((notification) => {
      const unread = isUnread(notification);
      const open = openId === notification.id;
      const detailId = `notification-${notification.id}`;
      const event = onViewEvent ? events[notification.event_id] : null;
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
              <span className="cs-notification-message">{notification.message}</span>
              <span className="cs-notification-event">{eventText(notification)}</span>
            </span>
            <time className="cs-notification-time" dateTime={notification.created_at || undefined}>{shownTime(notification.created_at)}</time>
          </button>
          {event && <button type="button" className="cs-btn cs-btn-secondary cs-record-btn cs-notification-view" aria-label={`View ${eventLabel(event)}`} onClick={() => view(notification, event)}>View<Icon name="arrow-right" /></button>}
        </div>
        {open && <dl className="cs-detail-grid cs-record-expanded cs-notification-detail" id={detailId}>
          <div className="cs-detail-wide"><dt>Message</dt><dd>{notification.message}</dd></div>
          <div><dt>Event</dt><dd>{eventText(notification)}</dd></div>
          <div><dt>Received</dt><dd>{shownTime(notification.created_at)}</dd></div>
        </dl>}
      </li>;
    })}</ul>
  </>;
}
