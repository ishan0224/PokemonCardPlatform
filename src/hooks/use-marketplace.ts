"use client";

import { useCallback, useMemo, useState } from "react";
import {
  apiClient,
  mapApiErrorToMessage,
  type MarketplaceListing,
  type MarketplaceSort
} from "@/lib/api-client";
import { swrKeys, useApiSWRInfinite } from "@/lib/swr";
import type { RarityTier } from "@/lib/types";
import { useMarketplaceRoom } from "./use-socket";
import { useAuth } from "./use-auth";

type MarketplacePage = {
  listings: MarketplaceListing[];
  page: number;
  limit: number;
  total: number;
};

type UseMarketplaceState = {
  listings: MarketplaceListing[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  buyPendingListingId: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  buyListing: (listingId: string) => Promise<void>;
};

type UseMarketplaceInput = {
  rarity?: RarityTier | null;
  sort?: MarketplaceSort;
  limit?: number;
  enableRealtime?: boolean;
};

export function useMarketplace(input: UseMarketplaceInput = {}): UseMarketplaceState {
  const { refreshAuth } = useAuth();
  const [buyPendingListingId, setBuyPendingListingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const limit = input.limit ?? 24;

  const { data, error, isLoading, isValidating, size, setSize, mutate } = useApiSWRInfinite(
    (index, previousPageData: MarketplacePage | null) => {
      if (previousPageData && previousPageData.listings.length < previousPageData.limit) {
        return null;
      }

      return swrKeys.marketplace.list({
        rarity: input.rarity ?? null,
        sort: input.sort ?? "newest",
        page: index + 1,
        limit
      });
    },
    (params) =>
      apiClient.listMarketplaceListings({
        rarity: (params as { rarity?: RarityTier | null }).rarity ?? null,
        sort: (params as { sort?: MarketplaceSort }).sort ?? "newest",
        page: (params as { page?: number }).page ?? 1,
        limit: (params as { limit?: number }).limit ?? limit
      }),
    {
      revalidateFirstPage: true,
      shouldRetryOnError: false,
      persistSize: false
    }
  );

  const listings = useMemo(() => (data ? data.flatMap((page) => page.listings) : []), [data]);
  const total = data?.[0]?.total ?? 0;
  const page = size;
  const hasMore = listings.length < total;
  const loadingMore = Boolean(data) && isValidating;
  const loading = isLoading && !data;

  const refresh = useCallback(async (): Promise<void> => {
    setActionError(null);
    await mutate();
  }, [mutate]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loadingMore) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, loadingMore, setSize]);

  const buyListing = useCallback(
    async (listingId: string): Promise<void> => {
      setBuyPendingListingId(listingId);
      setActionError(null);

      try {
        await apiClient.buyListing(listingId);
        await Promise.all([mutate(), refreshAuth()]);
      } catch (caughtError) {
        setActionError(mapApiErrorToMessage(caughtError) || "Failed to buy listing.");
      } finally {
        setBuyPendingListingId(null);
      }
    },
    [mutate, refreshAuth]
  );

  useMarketplaceRoom(Boolean(input.enableRealtime), {
    onListingCreated: () => {
      void mutate();
    },
    onListingSold: () => {
      void mutate();
    },
    onListingCancelled: () => {
      void mutate();
    },
    onConnected: () => {
      void mutate();
    }
  });

  return {
    listings,
    loading,
    loadingMore,
    error: actionError ?? (error ? mapApiErrorToMessage(error) || "Failed to load marketplace." : null),
    page,
    limit,
    total,
    hasMore,
    buyPendingListingId,
    refresh,
    loadMore,
    buyListing
  };
}
