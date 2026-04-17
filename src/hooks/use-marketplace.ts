"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  apiClient,
  mapApiErrorToMessage,
  type MarketplaceListing,
  type MarketplaceSort
} from "@/lib/api-client";
import type { RarityTier } from "@/lib/types";
import { useMarketplaceRoom } from "./use-socket";
import { useAuth } from "./use-auth";

type UseMarketplaceState = {
  listings: MarketplaceListing[];
  loading: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  buyPendingListingId: string | null;
  refresh: () => Promise<void>;
  buyListing: (listingId: string) => Promise<void>;
};

type UseMarketplaceInput = {
  rarity?: RarityTier | null;
  sort?: MarketplaceSort;
  page?: number;
  limit?: number;
  enableRealtime?: boolean;
};

export function useMarketplace(input: UseMarketplaceInput = {}): UseMarketplaceState {
  const { refreshAuth } = useAuth();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(input.page ?? 1);
  const [limit, setLimit] = useState(input.limit ?? 24);
  const [total, setTotal] = useState(0);
  const [buyPendingListingId, setBuyPendingListingId] = useState<string | null>(null);
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
      const result = await apiClient.listMarketplaceListings({
        rarity: input.rarity ?? null,
        sort: input.sort ?? "newest",
        page: input.page ?? 1,
        limit: input.limit ?? 24
      });

      if (!mountedRef.current) {
        return;
      }

      setListings(result.listings);
      setPage(result.page);
      setLimit(result.limit);
      setTotal(result.total);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      const message = mapApiErrorToMessage(err);
      setError(message || "Failed to load marketplace.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [input.limit, input.page, input.rarity, input.sort]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.listMarketplaceListings(
          {
            rarity: input.rarity ?? null,
            sort: input.sort ?? "newest",
            page: input.page ?? 1,
            limit: input.limit ?? 24
          },
          controller.signal
        );

        if (!mounted) {
          return;
        }

        setListings(result.listings);
        setPage(result.page);
        setLimit(result.limit);
        setTotal(result.total);
      } catch (err) {
        if (!mounted) {
          return;
        }
        if (err instanceof ApiClientError && err.code === "REQUEST_ABORTED") {
          return;
        }
        const message = mapApiErrorToMessage(err);
        setError(message || "Failed to load marketplace.");
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
  }, [input.limit, input.page, input.rarity, input.sort]);

  const buyListing = useCallback(
    async (listingId: string): Promise<void> => {
      if (!mountedRef.current) {
        return;
      }

      setBuyPendingListingId(listingId);
      setError(null);

      try {
        await apiClient.buyListing(listingId);
        await Promise.all([refresh(), refreshAuth()]);
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        setError(mapApiErrorToMessage(err));
      } finally {
        if (mountedRef.current) {
          setBuyPendingListingId(null);
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
      listings,
      loading,
      error,
      page,
      limit,
      total,
      buyPendingListingId,
      refresh,
      buyListing
    }),
    [listings, loading, error, page, limit, total, buyPendingListingId, refresh, buyListing]
  );
}
