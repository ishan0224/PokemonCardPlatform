"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  apiClient,
  mapApiErrorToMessage,
  type Auction,
  type CollectionCard
} from "@/lib/api-client";
import type { AuctionDurationType } from "@/lib/types";
import { useAuctionsRoom } from "./use-socket";

type UseAuctionsState = {
  auctions: Auction[];
  ownedCards: CollectionCard[];
  loading: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  createPendingCardId: string | null;
  refresh: () => Promise<void>;
  createAuction: (input: {
    cardId: string;
    startingBid: number;
    durationType: AuctionDurationType;
  }) => Promise<string | null>;
};

const AUCTIONS_POLL_INTERVAL_MS = 60_000;
const AUCTIONS_REALTIME_REFRESH_DEBOUNCE_MS = 1_000;

export function useAuctions(includeOwnedCards: boolean): UseAuctionsState {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [ownedCards, setOwnedCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(24);
  const [total, setTotal] = useState(0);
  const [createPendingCardId, setCreatePendingCardId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;

      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
    };
  }, []);

  const applyAuctionSnapshot = useCallback((snapshot: { auctions: Auction[]; page: number; limit: number; total: number }): void => {
    setAuctions(snapshot.auctions);
    setPage(snapshot.page);
    setLimit(snapshot.limit);
    setTotal(snapshot.total);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const auctionPromise = apiClient.listAuctions({ page: 1, limit: 24 });
      const collectionPromise = includeOwnedCards
        ? apiClient.listCollection({ state: "owned", page: 1, limit: 100, sort: "newest" })
        : Promise.resolve<{ cards: CollectionCard[] }>({ cards: [] });
      const [auctionResult, collectionResult] = await Promise.all([auctionPromise, collectionPromise]);

      if (!mountedRef.current) {
        return;
      }

      applyAuctionSnapshot(auctionResult);
      setOwnedCards(collectionResult.cards);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }

      const message = mapApiErrorToMessage(err);
      if (message) {
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [applyAuctionSnapshot, includeOwnedCards]);

  const refreshAuctionsOnly = useCallback(
    async (options: { clearError?: boolean; showLoading?: boolean } = {}): Promise<void> => {
      if (!mountedRef.current) {
        return;
      }

      if (options.showLoading) {
        setLoading(true);
      }

      if (options.clearError) {
        setError(null);
      }

      try {
        const auctionResult = await apiClient.listAuctions({ page: 1, limit: 24 });
        if (!mountedRef.current) {
          return;
        }
        applyAuctionSnapshot(auctionResult);
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }

        const message = mapApiErrorToMessage(err);
        if (message) {
          setError(message);
        }
      } finally {
        if (mountedRef.current && options.showLoading) {
          setLoading(false);
        }
      }
    },
    [applyAuctionSnapshot]
  );

  const scheduleRealtimeRefresh = useCallback(
    (delayMs = AUCTIONS_REALTIME_REFRESH_DEBOUNCE_MS): void => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;

        if (document.visibilityState === "hidden") {
          return;
        }

        void refreshAuctionsOnly();
      }, delayMs);
    },
    [refreshAuctionsOnly]
  );

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const auctionPromise = apiClient.listAuctions({ page: 1, limit: 24 }, controller.signal);
        const collectionPromise = includeOwnedCards
          ? apiClient.listCollection(
              { state: "owned", page: 1, limit: 100, sort: "newest" },
              controller.signal
            )
          : Promise.resolve<{ cards: CollectionCard[] }>({ cards: [] });
        const [auctionResult, collectionResult] = await Promise.all([auctionPromise, collectionPromise]);

        if (!mounted) {
          return;
        }

        applyAuctionSnapshot(auctionResult);
        setOwnedCards(collectionResult.cards);
      } catch (err) {
        if (!mounted) {
          return;
        }
        if (err instanceof ApiClientError && err.code === "REQUEST_ABORTED") {
          return;
        }

        const message = mapApiErrorToMessage(err);
        if (message) {
          setError(message);
        }
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
  }, [applyAuctionSnapshot, includeOwnedCards]);

  useAuctionsRoom(true, {
    onAuctionCreated: () => {
      scheduleRealtimeRefresh();
    },
    onAuctionUpdated: () => {
      scheduleRealtimeRefresh();
    },
    onAuctionEnded: () => {
      scheduleRealtimeRefresh();
    },
    onConnected: () => {
      scheduleRealtimeRefresh(0);
    }
  });

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refreshAuctionsOnly();
    }, AUCTIONS_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [refreshAuctionsOnly]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        scheduleRealtimeRefresh(0);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [scheduleRealtimeRefresh]);

  const createAuction = useCallback(
    async (input: { cardId: string; startingBid: number; durationType: AuctionDurationType }): Promise<string | null> => {
      if (!mountedRef.current) {
        return null;
      }

      setCreatePendingCardId(input.cardId);
      setError(null);

      try {
        const result = await apiClient.createAuction({
          cardId: input.cardId,
          startingBid: input.startingBid,
          durationType: input.durationType
        });

        await refresh();
        return result.auction.id;
      } catch (err) {
        if (!mountedRef.current) {
          return null;
        }

        const message = mapApiErrorToMessage(err);
        if (message) {
          setError(message);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setCreatePendingCardId(null);
        }
      }
    },
    [refresh]
  );

  return useMemo(
    () => ({
      auctions,
      ownedCards,
      loading,
      error,
      page,
      limit,
      total,
      createPendingCardId,
      refresh,
      createAuction
    }),
    [auctions, ownedCards, loading, error, page, limit, total, createPendingCardId, refresh, createAuction]
  );
}
