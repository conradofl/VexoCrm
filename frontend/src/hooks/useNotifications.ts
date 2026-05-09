import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { toast } from "sonner";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  description: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

const POLL_INTERVAL = 15000;
const ERROR_POLL_INTERVAL = 60000;
const LAST_SEEN_KEY = "notifications_lastSeenCreatedAt";

function matchesSelectedClient(
  item: Notification,
  selectedClientName: string | null,
) {
  if (!selectedClientName) {
    return true;
  }

  const haystack = `${item.title} ${item.description || ""}`.toLowerCase();
  return haystack.includes(selectedClientName.toLowerCase());
}

export function useNotifications() {
  const { user, getIdToken, canAccessInternalPage } = useAuth();
  const crmClient = useOptionalCrmClient();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeenRef = useRef(localStorage.getItem(LAST_SEEN_KEY) || "");
  const inFlightRef = useRef(false);
  const lastFailureAtRef = useRef(0);
  const canReadNotifications = canAccessInternalPage("agente");
  const selectedClientName = crmClient?.selectedClient?.name || null;

  const filteredItems = useMemo(
    () => items.filter((item) => matchesSelectedClient(item, selectedClientName)),
    [items, selectedClientName],
  );
  const unreadCount = useMemo(
    () => filteredItems.filter((item) => !item.read).length,
    [filteredItems],
  );

  const fetchNotifications = useCallback(async () => {
    if (!user || !canReadNotifications) return;
    if (inFlightRef.current) {
      console.info("[notifications-api] skipped_duplicate_request");
      return;
    }

    const now = Date.now();
    if (lastFailureAtRef.current && now - lastFailureAtRef.current < ERROR_POLL_INTERVAL) {
      console.info("[notifications-api] skipped_error_cooldown", {
        retryInMs: ERROR_POLL_INTERVAL - (now - lastFailureAtRef.current),
      });
      return;
    }

    inFlightRef.current = true;
    const startedAt = Date.now();

    try {
      const token = await getIdToken();
      if (!token) return;

      const res = await fetchApi("/api/notifications?limit=20", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const message = await readApiErrorMessage(res, "Failed to fetch notifications");
        throw new Error(`Failed to fetch notifications: ${res.status} ${message}`);
      }

      const data = await readApiJson<{ items?: Notification[] }>(res, "notifications");
      setItems(data.items || []);
      setError(null);
      lastFailureAtRef.current = 0;
      console.info("[notifications-api] fetch_success", {
        total: data.items?.length || 0,
        durationMs: Date.now() - startedAt,
      });

      // Toast for new notifications
      const newItems = (data.items || []).filter(
        (item: Notification) =>
          lastSeenRef.current && item.created_at > lastSeenRef.current && !item.read
      );
      for (const item of newItems.slice(0, 3)) {
        toast.error(item.title, { description: item.description || undefined });
      }

      if (data.items?.length > 0) {
        const newest = data.items[0].created_at;
        if (newest > lastSeenRef.current) {
          lastSeenRef.current = newest;
          localStorage.setItem(LAST_SEEN_KEY, newest);
        }
      }
    } catch (err) {
      lastFailureAtRef.current = Date.now();
      const message = err instanceof Error ? err.message : "Failed to fetch notifications";
      setError(message);
      console.error("[notifications-api] fetch_failed", {
        message,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [canReadNotifications, getIdToken, user]);

  useEffect(() => {
    if (!user || !canReadNotifications) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [canReadNotifications, fetchNotifications, user]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!canReadNotifications) return;
      const token = await getIdToken();
      if (!token) return;

      const res = await fetchApi("/api/notifications", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, read: true }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Failed to mark notification as read"));
      }

      await fetchNotifications();
    },
    [canReadNotifications, fetchNotifications, getIdToken]
  );

  const markAllRead = useCallback(async () => {
    if (!canReadNotifications) return;
    const token = await getIdToken();
    if (!token) return;

    const res = await fetchApi("/api/notifications", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ markAllRead: true }),
    });

    if (!res.ok) {
      throw new Error(await readApiErrorMessage(res, "Failed to mark notifications as read"));
    }

    await fetchNotifications();
  }, [canReadNotifications, fetchNotifications, getIdToken]);

  return { items: filteredItems, unreadCount, loading, error, markAsRead, markAllRead };
}
