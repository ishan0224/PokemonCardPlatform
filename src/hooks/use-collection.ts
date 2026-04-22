"use client";

import { useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
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
import { useCollectionMutations } from "./use-collection-mutations";
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

function isCollectionCardKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === "collection:card";
}

export function useCollection(input: UseCollectionInput = {}): UseCollectionState {
  const { user } = useAuth();
  const { mutate: mutateCache } = useSWRConfig();
  const enabled = input.enabled ?? true;
  const limit = input.limit ?? 24;

  const {
    data: portfolioData,
    error: portfolioError,
    mutate: mutatePortfolio
  } = useApiSWR(
    enabled ? swrKeys.collection.portfolio() : null,
    () => apiClient.getCollectionPortfolio().then((result) => result.portfolio),
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false
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
  const mutations = useCollectionMutations({
    revalidateList: mutate,
    revalidatePortfolio: mutatePortfolio
  });

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([mutate(), mutatePortfolio()]);
  }, [mutate, mutatePortfolio]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loadingMore) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, loadingMore, setSize]);

  useMarketplaceRoom(Boolean(input.enableRealtime && enabled), {
    onListingCreated: (event) => {
      void mutate();
      void mutatePortfolio();
      void mutateCache(swrKeys.collection.card(event.cardId));
    },
    onListingSold: (event) => {
      void mutate();
      void mutatePortfolio();
      void mutateCache(swrKeys.collection.card(event.cardId));
    },
    onListingCancelled: (event) => {
      void mutate();
      void mutatePortfolio();
      void mutateCache(swrKeys.collection.card(event.cardId));
    },
    onConnected: () => {
      void mutate();
      void mutatePortfolio();
      void mutateCache((key) => isCollectionCardKey(key));
    }
  });

  usePortfolioRoom(input.enableRealtime && enabled ? user?.id ?? null : null, {
    onPriceUpdate: (event) => {
      void mutate();
      void mutatePortfolio();
      const affectedCardIds = new Set(event.updates.map((entry) => entry.cardId));
      for (const cardId of affectedCardIds) {
        void mutateCache(swrKeys.collection.card(cardId));
      }
    },
    onConnected: () => {
      void mutate();
      void mutatePortfolio();
      void mutateCache((key) => isCollectionCardKey(key));
    }
  });

  const mappedError = error ?? portfolioError;

  return {
    cards,
    portfolio: portfolioData ?? null,
    loading: enabled ? isLoading && !data : false,
    loadingMore,
    error: mutations.error ?? (mappedError ? mapApiErrorToMessage(mappedError) || "Failed to load collection." : null),
    page: size,
    limit,
    total,
    hasMore,
    listingPendingCardId: mutations.listingPendingCardId,
    cancelPendingListingId: mutations.cancelPendingListingId,
    refresh,
    loadMore,
    createListing: mutations.createListing,
    cancelListing: mutations.cancelListing
  };
}
