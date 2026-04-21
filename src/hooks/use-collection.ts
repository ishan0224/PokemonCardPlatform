"use client";

import { useCallback, useMemo, useState } from "react";
import {
  apiClient,
  mapApiErrorToMessage,
  type CollectionCard,
  type CollectionPortfolio,
  type CollectionSort
} from "@/lib/api-client";
import { swrKeys, useApiSWR, useApiSWRInfinite } from "@/lib/swr";
import type { CardState, RarityTier } from "@/lib/types";
import { useMarketplaceRoom, usePortfolioRoom } from "./use-socket";
import { useAuth } from "./use-auth";

type CollectionPage = {
  cards: CollectionCard[];
  page: number;
  limit: number;
  total: number;
};

type UseCollectionState = {
  cards: CollectionCard[];
  portfolio: CollectionPortfolio | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  listingPendingCardId: string | null;
  cancelPendingListingId: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  createListing: (cardId: string, price: number) => Promise<void>;
  cancelListing: (listingId: string) => Promise<void>;
};

type UseCollectionInput = {
  rarity?: RarityTier | null;
  state?: CardState | null;
  sort?: CollectionSort;
  limit?: number;
  enabled?: boolean;
  enableRealtime?: boolean;
};

export function useCollection(input: UseCollectionInput = {}): UseCollectionState {
  const { user, refreshAuth } = useAuth();
  const enabled = input.enabled ?? true;
  const limit = input.limit ?? 24;

  const [listingPendingCardId, setListingPendingCardId] = useState<string | null>(null);
  const [cancelPendingListingId, setCancelPendingListingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: portfolioData,
    error: portfolioError,
    mutate: mutatePortfolio
  } = useApiSWR(
    enabled ? swrKeys.collection.portfolio() : null,
    () => apiClient.getCollectionPortfolio().then((result) => result.portfolio),
    {
      shouldRetryOnError: false,
      revalidateOnFocus: true
    }
  );

  const {
    data,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate
  } = useApiSWRInfinite(
    (index, previousPageData: CollectionPage | null) => {
      if (!enabled) {
        return null;
      }

      if (previousPageData && previousPageData.cards.length < previousPageData.limit) {
        return null;
      }

      return swrKeys.collection.list({
        rarity: input.rarity ?? null,
        state: input.state ?? null,
        sort: input.sort ?? "newest",
        page: index + 1,
        limit
      });
    },
    (params) =>
      apiClient.listCollection({
        rarity: (params as { rarity?: RarityTier | null }).rarity ?? null,
        state: (params as { state?: CardState | null }).state ?? null,
        sort: (params as { sort?: CollectionSort }).sort ?? "newest",
        page: (params as { page?: number }).page ?? 1,
        limit: (params as { limit?: number }).limit ?? limit
      }),
    {
      revalidateFirstPage: true,
      shouldRetryOnError: false,
      persistSize: false
    }
  );

  const cards = useMemo(() => (data ? data.flatMap((page) => page.cards) : []), [data]);
  const total = data?.[0]?.total ?? 0;
  const hasMore = cards.length < total;
  const loadingMore = Boolean(data) && isValidating;

  const refresh = useCallback(async (): Promise<void> => {
    setActionError(null);
    await Promise.all([mutate(), mutatePortfolio()]);
  }, [mutate, mutatePortfolio]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loadingMore) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, loadingMore, setSize]);

  const createListing = useCallback(
    async (cardId: string, price: number): Promise<void> => {
      setListingPendingCardId(cardId);
      setActionError(null);

      try {
        await apiClient.createListing({ cardId, price });
        await Promise.all([mutate(), mutatePortfolio(), refreshAuth()]);
      } catch (caughtError) {
        setActionError(mapApiErrorToMessage(caughtError) || "Failed to create listing.");
        throw caughtError;
      } finally {
        setListingPendingCardId(null);
      }
    },
    [mutate, mutatePortfolio, refreshAuth]
  );

  const cancelListing = useCallback(
    async (listingId: string): Promise<void> => {
      setCancelPendingListingId(listingId);
      setActionError(null);

      try {
        await apiClient.cancelListing(listingId);
        await Promise.all([mutate(), mutatePortfolio(), refreshAuth()]);
      } catch (caughtError) {
        setActionError(mapApiErrorToMessage(caughtError) || "Failed to cancel listing.");
        throw caughtError;
      } finally {
        setCancelPendingListingId(null);
      }
    },
    [mutate, mutatePortfolio, refreshAuth]
  );

  useMarketplaceRoom(Boolean(input.enableRealtime && enabled), {
    onListingCreated: () => {
      void mutate();
      void mutatePortfolio();
    },
    onListingSold: () => {
      void mutate();
      void mutatePortfolio();
    },
    onListingCancelled: () => {
      void mutate();
      void mutatePortfolio();
    },
    onConnected: () => {
      void mutate();
      void mutatePortfolio();
    }
  });

  usePortfolioRoom(input.enableRealtime && enabled ? user?.id ?? null : null, {
    onPriceUpdate: () => {
      void mutate();
      void mutatePortfolio();
    },
    onConnected: () => {
      void mutate();
      void mutatePortfolio();
    }
  });

  const mappedError = error ?? portfolioError;

  return {
    cards,
    portfolio: portfolioData ?? null,
    loading: enabled ? isLoading && !data : false,
    loadingMore,
    error: actionError ?? (mappedError ? mapApiErrorToMessage(mappedError) || "Failed to load collection." : null),
    page: size,
    limit,
    total,
    hasMore,
    listingPendingCardId,
    cancelPendingListingId,
    refresh,
    loadMore,
    createListing,
    cancelListing
  };
}
