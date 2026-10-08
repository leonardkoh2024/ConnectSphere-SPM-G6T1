// J1 / SCRUM-150 — one subscription per signed-in session, held by the
// workspace so the sidebar badge and the inbox screen count the same list.

import { useCallback, useEffect, useState } from "react";
import { unreadCount } from "../../domain/notifications";
import { markNotificationRead, watchNotifications } from "./notificationsApi";

export default function useNotifications(userId) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return undefined;
    setLoading(true);
    return watchNotifications(userId, (list) => {
      setNotifications(list);
      setError("");
      setLoading(false);
    }, (watchError) => {
      console.error("Could not load notifications:", watchError);
      setError("We could not load your notifications. Please refresh and try again.");
      setLoading(false);
    });
  }, [userId]);

  // Firestore applies the write to the live list straight away, so the badge
  // drops without waiting for the server.
  const markRead = useCallback(async (notificationId) => {
    try {
      await markNotificationRead(notificationId);
    } catch (markError) {
      console.error("Could not mark notification read:", markError);
      setError("We could not mark that notification as read. Please try again.");
    }
  }, []);

  return { notifications, unread: unreadCount(notifications), loading, error, markRead };
}
