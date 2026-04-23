"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient, mapApiErrorToMessage, type Auction } from "@/lib/api-client";
import { createApiKey, useApiSWRInfinite } from "@/lib/swr";
import { isSocketConnected, onSocketConnectivityChange } from "@/lib/socket-client";
import { useAuctionsRoom } from "./use-socket";

type AuctionsPage = {
  auctions: Auction[];
  page: number;
  limit: number;
  total: number;
};

export type AuctionBrowseSort = "ending_soonest" | "newest" | "highest_bid";

type UseAuctionsInput = {
  sort?: AuctionBrowseSort;
};

type UseAuctionsState = {
  auctions: Auction[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
};

const AUCTIONS_POLL_INTERVAL_MS = 60_000;

function getAuctionReferenceBid(auction: Auction): number {
  return auction.currentBid ?? auction.startingBid;
}

function sortAuctions(auctions: Auction[], sort: AuctionBrowseSort): Auction[] {
  const sorted = [...auctions];

  if (sort === "newest") {
    sorted.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    return sorted;
  }

  if (sort === "highest_bid") {
    sorted.sort((left, right) => {
      const bidDelta = getAuctionReferenceBid(right) - getAuctionReferenceBid(left);
      if (bidDelta !== 0) {
        return bidDelta;
      }

      return new Date(left.endsAt).getTime() - new Date(right.endsAt).getTime();
    });
    return sorted;
  }

  sorted.sort((left, right) => {
    const endDelta = new Date(left.endsAt).getTime() - new Date(right.endsAt).getTime();
    if (endDelta !== 0) {
      return endDelta;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  return sorted;
}

export function useAuctions(input: UseAuctionsInput = {}): UseAuctionsState {
  const sort = input.sort ?? "ending_soonest";

  const { data, error, isLoading, isValidating, size, setSize, mutate } = useApiSWRInfinite(
    (index, previousPageData: AuctionsPage | null) => {
      if (previousPageData && previousPageData.auctions.length < previousPageData.limit) {
        return null;
      }

      return createApiKey("auctions:list:infinite", {
        page: index + 1,
        limit: 24
      });
    },
    (params) =>
      apiClient.listAuctions({
        page: (params as { page?: number }).page ?? 1,
        limit: (params as { limit?: number }).limit ?? 24
      }),
    {
      revalidateFirstPage: true,
      shouldRetryOnError: false,
      persistSize: true
    }
  );

  const auctions = useMemo(() => {
    const flattened = data ? data.flatMap((page) => page.auctions) : [];
    return sortAuctions(flattened, sort);
  }, [data, sort]);

  const total = data?.[0]?.total ?? 0;
  const hasMore = auctions.length < total;

  const refresh = useCallback(async (): Promise<void> => {
    await mutate();
  }, [mutate]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || isValidating) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, isValidating, setSize]);

  useAuctionsRoom(true, {
    onAuctionCreated: () => {
      void mutate();
    },
    onAuctionUpdated: () => {
      void mutate();
    },
    onAuctionEnded: () => {
      void mutate();
    },
    onConnected: () => {
      void mutate();
    }
  });

  // Poll only when the socket is disconnected — socket events cover the connected case
  const [socketUp, setSocketUp] = useState(isSocketConnected);

  useEffect(() => {
    return onSocketConnectivityChange(setSocketUp);
  }, []);

  useEffect(() => {
    if (socketUp) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void mutate();
    }, AUCTIONS_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [mutate, socketUp]);

  return {
    auctions,
    loading: isLoading && !data,
    loadingMore: Boolean(data) && isValidating,
    error: error ? mapApiErrorToMessage(error) || "Failed to load auctions." : null,
    page: size,
    limit: 24,
    total,
    hasMore,
    refresh,
    loadMore
  };
}
