"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  subscribeToAuctionRoom,
  subscribeToDropRoom,
  type AuctionNewBidEvent,
  type DropInventoryUpdateEvent
} from "@/lib/socket-client";
import { apiClient } from "@/lib/api-client";
import { NotificationEvent, toNotificationEvent } from "@/lib/notifications";
import { useAdminMetricsRoom, useMarketplaceRoom, usePortfolioRoom } from "@/hooks/use-socket";

type NotificationsContextValue = {
  events: NotificationEvent[];
  unreadCount: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  markAllRead: () => void;
  clear: () => void;
};

const MAX_EVENTS = 20;
const INVENTORY_NOTIFICATION_THROTTLE_MS = 30_000;

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function pushCapped<T>(items: T[], next: T): T[] {
  return [next, ...items].slice(0, MAX_EVENTS);
}

export function NotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const inventoryThrottleRef = useRef<Map<string, number>>(new Map());
  const wasLeadingByAuctionRef = useRef<Map<string, boolean>>(new Map());

  const markAllRead = useCallback((): void => {
    setUnreadCount(0);
  }, []);

  const clear = useCallback((): void => {
    setEvents([]);
    setUnreadCount(0);
  }, []);

  const push = useCallback(
    (event: NotificationEvent | null): void => {
      if (!event) {
        return;
      }

      setEvents((previous) => pushCapped(previous, event));
      if (!open) {
        setUnreadCount((previous) => Math.min(previous + 1, MAX_EVENTS));
      }
    },
    [open]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    markAllRead();
  }, [markAllRead, open]);

  useEffect(() => {
    if (user) {
      return;
    }

    setEvents([]);
    setUnreadCount(0);
    setOpen(false);
    inventoryThrottleRef.current.clear();
    wasLeadingByAuctionRef.current.clear();
  }, [user]);

  useMarketplaceRoom(Boolean(user), {
    onListingCreated: (payload) => {
      push(toNotificationEvent({ kind: "listing_created", payload }));
    },
    onListingSold: (payload) => {
      if (!user) {
        return;
      }
      push(toNotificationEvent({ kind: "listing_sold", payload, currentUserId: user.id }));
    },
    onListingCancelled: (payload) => {
      if (!user) {
        return;
      }
      push(toNotificationEvent({ kind: "listing_cancelled", payload, currentUserId: user.id }));
    }
  });

  usePortfolioRoom(user?.id ?? null, {
    onBalanceUpdate: (payload) => {
      if (!user) {
        return;
      }
      push(toNotificationEvent({ kind: "balance_update", payload, currentUserId: user.id }));
    }
  });

  useAdminMetricsRoom(user?.role === "admin", {
    onMetricsDelta: (payload) => {
      push(toNotificationEvent({ kind: "admin_metrics_delta", payload }));
    }
  });

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    const onInventoryUpdate = (payload: DropInventoryUpdateEvent): void => {
      const key = `${payload.dropId}:${payload.tier}`;
      const now = Date.now();
      const lastSent = inventoryThrottleRef.current.get(key) ?? 0;

      if (now - lastSent < INVENTORY_NOTIFICATION_THROTTLE_MS) {
        return;
      }

      inventoryThrottleRef.current.set(key, now);
      push(toNotificationEvent({ kind: "inventory_update", payload }));
    };

    const bootstrapDropSubscriptions = async (): Promise<void> => {
      const [upcomingResult, activeResult] = await Promise.allSettled([
        apiClient.listUpcomingDrops(10),
        apiClient.listActiveDrops(10)
      ]);

      if (cancelled) {
        return;
      }

      const drops = [
        ...(upcomingResult.status === "fulfilled" ? upcomingResult.value.drops : []),
        ...(activeResult.status === "fulfilled" ? activeResult.value.drops : [])
      ];

      const uniqueDropIds = Array.from(new Set(drops.map((drop) => drop.id)));
      for (const dropId of uniqueDropIds) {
        const unsubscribe = subscribeToDropRoom(dropId, {
          onDropStarted: (payload) => {
            push(toNotificationEvent({ kind: "drop_started", payload }));
          },
          onDropCompleted: (payload) => {
            push(toNotificationEvent({ kind: "drop_completed", payload }));
          },
          onSoldOut: (payload) => {
            push(toNotificationEvent({ kind: "sold_out", payload }));
          },
          onInventoryUpdate
        });

        unsubscribers.push(unsubscribe);
      }
    };

    void bootstrapDropSubscriptions().catch(() => undefined);

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [push, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    const onNewBid = (payload: AuctionNewBidEvent): void => {
      const wasLeading = wasLeadingByAuctionRef.current.get(payload.auctionId) ?? false;
      const nowLeading = payload.currentBidderId === user.id;
      wasLeadingByAuctionRef.current.set(payload.auctionId, nowLeading);

      push(
        toNotificationEvent({
          kind: "auction_new_bid",
          payload,
          currentUserId: user.id,
          wasLeading
        })
      );
    };

    const bootstrapAuctionSubscriptions = async (): Promise<void> => {
      const page = await apiClient.listAuctions({ page: 1, limit: 60 });
      if (cancelled) {
        return;
      }

      const myAuctionIds = page.auctions.filter((auction) => auction.currentBidderId === user.id).map((auction) => auction.id);
      for (const auctionId of myAuctionIds) {
        wasLeadingByAuctionRef.current.set(auctionId, true);
        const unsubscribe = subscribeToAuctionRoom(auctionId, {
          onNewBid,
          onAuctionEnded: (payload) => {
            push(toNotificationEvent({ kind: "auction_ended", payload, currentUserId: user.id }));
          }
        });
        unsubscribers.push(unsubscribe);
      }
    };

    void bootstrapAuctionSubscriptions().catch(() => undefined);

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [push, user]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      events,
      unreadCount,
      open,
      setOpen,
      markAllRead,
      clear
    }),
    [clear, events, markAllRead, open, unreadCount]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used inside NotificationsProvider.");
  }
  return context;
}
