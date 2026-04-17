"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  apiClient,
  mapApiErrorToMessage,
  type CollectionCard,
  type CollectionPortfolio,
  type CollectionSort
} from "@/lib/api-client";
import type { CardState, RarityTier } from "@/lib/types";
import { useMarketplaceRoom } from "./use-socket";
import { useAuth } from "./use-auth";

type UseCollectionState = {
  cards: CollectionCard[];
  portfolio: CollectionPortfolio | null;
  loading: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  listingPendingCardId: string | null;
  cancelPendingListingId: string | null;
  refresh: () => Promise<void>;
  createListing: (cardId: string, price: number) => Promise<void>;
  cancelListing: (listingId: string) => Promise<void>;
};

type UseCollectionInput = {
  rarity?: RarityTier | null;
  state?: CardState | null;
  sort?: CollectionSort;
  page?: number;
  limit?: number;
  enabled?: boolean;
  enableRealtime?: boolean;
};

export function useCollection(input: UseCollectionInput = {}): UseCollectionState {
  const enabled = input.enabled ?? true;
  const { refreshAuth } = useAuth();
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [portfolio, setPortfolio] = useState<CollectionPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(input.page ?? 1);
  const [limit, setLimit] = useState(input.limit ?? 24);
  const [total, setTotal] = useState(0);
  const [listingPendingCardId, setListingPendingCardId] = useState<string | null>(null);
  const [cancelPendingListingId, setCancelPendingListingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [collection, portfolioResult] = await Promise.all([
        apiClient.listCollection({
          rarity: input.rarity ?? null,
          state: input.state ?? null,
          sort: input.sort ?? "newest",
          page: input.page ?? 1,
          limit: input.limit ?? 24
        }),
        apiClient.getCollectionPortfolio()
      ]);

      if (!mountedRef.current) {
        return;
      }

      setCards(collection.cards);
      setPage(collection.page);
      setLimit(collection.limit);
      setTotal(collection.total);
      setPortfolio(portfolioResult.portfolio);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      const message = mapApiErrorToMessage(err);
      setError(message || "Failed to load collection.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, input.limit, input.page, input.rarity, input.sort, input.state]);

  useEffect(() => {
    if (!enabled) {
      setCards([]);
      setPortfolio(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const [collection, portfolioResult] = await Promise.all([
          apiClient.listCollection(
            {
              rarity: input.rarity ?? null,
              state: input.state ?? null,
              sort: input.sort ?? "newest",
              page: input.page ?? 1,
              limit: input.limit ?? 24
            },
            controller.signal
          ),
          apiClient.getCollectionPortfolio(controller.signal)
        ]);

        if (!mounted) {
          return;
        }

        setCards(collection.cards);
        setPage(collection.page);
        setLimit(collection.limit);
        setTotal(collection.total);
        setPortfolio(portfolioResult.portfolio);
      } catch (err) {
        if (!mounted) {
          return;
        }
        if (err instanceof ApiClientError && err.code === "REQUEST_ABORTED") {
          return;
        }
        const message = mapApiErrorToMessage(err);
        setError(message || "Failed to load collection.");
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
  }, [enabled, input.limit, input.page, input.rarity, input.sort, input.state]);

  const createListing = useCallback(
    async (cardId: string, price: number): Promise<void> => {
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }

      setListingPendingCardId(cardId);
      setError(null);

      try {
        await apiClient.createListing({ cardId, price });
        await Promise.all([refresh(), refreshAuth()]);
      } catch (err) {
        if (!mountedRef.current) {
          throw err;
        }
        setError(mapApiErrorToMessage(err));
        throw err;
      } finally {
        if (mountedRef.current) {
          setListingPendingCardId(null);
        }
      }
    },
    [refresh, refreshAuth]
  );

  const cancelListing = useCallback(
    async (listingId: string): Promise<void> => {
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }

      setCancelPendingListingId(listingId);
      setError(null);

      try {
        await apiClient.cancelListing(listingId);
        await Promise.all([refresh(), refreshAuth()]);
      } catch (err) {
        if (!mountedRef.current) {
          throw err;
        }
        setError(mapApiErrorToMessage(err));
        throw err;
      } finally {
        if (mountedRef.current) {
          setCancelPendingListingId(null);
        }
      }
    },
    [refresh, refreshAuth]
  );

  useMarketplaceRoom(Boolean(input.enableRealtime), {
    onListingCreated: () => {
      void refresh();
    },
    onListingSold: () => {
      void refresh();
    },
    onListingCancelled: () => {
      void refresh();
    },
    onConnected: () => {
      void refresh();
    }
  });

  return useMemo(
    () => ({
      cards,
      portfolio,
      loading,
      error,
      page,
      limit,
      total,
      listingPendingCardId,
      cancelPendingListingId,
      refresh,
      createListing,
      cancelListing
    }),
    [
      cards,
      portfolio,
      loading,
      error,
      page,
      limit,
      total,
      listingPendingCardId,
      cancelPendingListingId,
      refresh,
      createListing,
      cancelListing
    ]
  );
}
