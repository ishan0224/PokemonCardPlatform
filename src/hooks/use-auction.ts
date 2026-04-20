"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  apiClient,
  mapApiErrorToMessage,
  type AuctionBid,
  type AuctionDetail
} from "@/lib/api-client";
import { useAuth } from "./use-auth";
import { useAuctionRoom } from "./use-socket";

export type PlaceBidOutcome = { ok: true } | { ok: false; error: unknown };

type UseAuctionState = {
  auction: AuctionDetail | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  bidPending: boolean;
  watcherCount: number;
  refresh: () => Promise<void>;
  placeBid: (amount: number, options?: { confirmHighBid?: boolean }) => Promise<PlaceBidOutcome>;
};

export function useAuction(auctionId: string, enableRealtime = true): UseAuctionState {
  const { user, refreshAuth } = useAuth();
  const [auction, setAuction] = useState<AuctionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidPending, setBidPending] = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await apiClient.getAuction(auctionId);
      if (!mountedRef.current) {
        return;
      }
      setAuction(result.auction);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      setError(mapApiErrorToMessage(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [auctionId]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.getAuction(auctionId, controller.signal);
        if (!mounted) {
          return;
        }
        setAuction(result.auction);
      } catch (err) {
        if (!mounted) {
          return;
        }
        if (err instanceof ApiClientError && err.code === "REQUEST_ABORTED") {
          return;
        }
        setError(mapApiErrorToMessage(err));
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [auctionId]);

  const placeBid = useCallback(
    async (amount: number, options?: { confirmHighBid?: boolean }): Promise<PlaceBidOutcome> => {
      if (!mountedRef.current) {
        return { ok: false, error: new Error("unmounted") };
      }

      setBidPending(true);
      setError(null);

      try {
        const result = await apiClient.placeBid(auctionId, amount, {
          confirmHighBid: options?.confirmHighBid
        });
        if (!mountedRef.current) {
          return { ok: true };
        }
        setAuction(result.auction);
        return { ok: true };
      } catch (err) {
        if (!mountedRef.current) {
          return { ok: false, error: err };
        }
        // Mirror into local state for the default error banner; return the
        // raw error so callers can inspect ApiClientError.code / .details
        // (e.g. CONFIRMATION_REQUIRED + suspiciousCeiling) and render a
        // confirm prompt instead of the default banner when appropriate.
        const message = mapApiErrorToMessage(err);
        if (message) {
          setError(message);
        }
        return { ok: false, error: err };
      } finally {
        if (mountedRef.current) {
          setBidPending(false);
        }
      }
    },
    [auctionId]
  );

  const clearError = useCallback((): void => {
    if (!mountedRef.current) {
      return;
    }
    setError(null);
  }, []);

  useAuctionRoom(enableRealtime ? auctionId : null, {
    onNewBid: (event) => {
      let shouldRefreshBalance = false;

      setAuction((previous) => {
        if (!previous || previous.id !== event.auctionId) {
          return previous;
        }

        if (user?.id) {
          const wasLeading = previous.currentBidderId === user.id;
          const isLeading = event.currentBidderId === user.id;
          shouldRefreshBalance = wasLeading !== isLeading;
        }

        const hasBid = previous.bids.some((bid) => bid.id === event.bid.id);
        const bids: AuctionBid[] = hasBid ? previous.bids : [event.bid, ...previous.bids];

        return {
          ...previous,
          currentBid: event.currentBid,
          currentBidderId: event.currentBidderId,
          currentBidderUsername: event.currentBidderUsername,
          minNextBid: event.minNextBid,
          endsAt: event.endsAt,
          bids
        };
      });

      if (shouldRefreshBalance) {
        void refreshAuth();
      }
    },
    onTimeExtended: (event) => {
      setAuction((previous) =>
        previous && previous.id === event.auctionId ? { ...previous, endsAt: event.endsAt } : previous
      );
    },
    onAuctionEnded: (event) => {
      let shouldRefreshBalance = false;

      setAuction((previous) =>
        previous && previous.id === event.auctionId
          ? {
              ...previous,
              status: "completed",
              endsAt: event.endedAt
            }
          : previous
      );

      if (user?.id) {
        shouldRefreshBalance = event.winnerId === user.id || event.sellerId === user.id;
      }

      if (shouldRefreshBalance) {
        void refreshAuth();
      }
    },
    onWatcherCount: (event) => {
      setWatcherCount(event.count);
    },
    onConnected: () => {
      void refresh();
    }
  });

  return useMemo(
    () => ({
      auction,
      loading,
      error,
      clearError,
      bidPending,
      watcherCount,
      refresh,
      placeBid
    }),
    [auction, loading, error, clearError, bidPending, watcherCount, refresh, placeBid]
  );
}
