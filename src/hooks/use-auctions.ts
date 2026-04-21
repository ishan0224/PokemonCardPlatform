"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  apiClient,
  mapApiErrorToMessage,
  type Auction,
  type CollectionCard
} from "@/lib/api-client";
import { createApiKey, useApiSWR, useApiSWRInfinite } from "@/lib/swr";
import type { AuctionDurationType } from "@/lib/types";
import { useAuctionsRoom } from "./use-socket";

type AuctionsPage = {
  auctions: Auction[];
  page: number;
  limit: number;
  total: number;
};

type UseAuctionsState = {
  auctions: Auction[];
  ownedCards: CollectionCard[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  createPendingCardId: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  createAuction: (input: {
    cardId: string;
    startingBid: number;
    durationType: AuctionDurationType;
  }) => Promise<string | null>;
};

const AUCTIONS_POLL_INTERVAL_MS = 60_000;

export function useAuctions(includeOwnedCards: boolean): UseAuctionsState {
  const [createPendingCardId, setCreatePendingCardId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: ownedCardsData,
    error: ownedCardsError,
    mutate: mutateOwnedCards
  } = useApiSWR(
    includeOwnedCards ? createApiKey("auctions:owned-cards") : null,
    () =>
      apiClient
        .listCollection({ state: "owned", page: 1, limit: 100, sort: "newest" })
        .then((result) => result.cards),
    {
      revalidateOnFocus: true,
      shouldRetryOnError: false
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

  const auctions = useMemo(() => (data ? data.flatMap((page) => page.auctions) : []), [data]);
  const total = data?.[0]?.total ?? 0;
  const hasMore = auctions.length < total;

  const refresh = useCallback(async (): Promise<void> => {
    setActionError(null);
    if (includeOwnedCards) {
      await Promise.all([mutate(), mutateOwnedCards()]);
      return;
    }

    await mutate();
  }, [includeOwnedCards, mutate, mutateOwnedCards]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || isValidating) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, isValidating, setSize]);

  const createAuction = useCallback(
    async (input: { cardId: string; startingBid: number; durationType: AuctionDurationType }): Promise<string | null> => {
      setCreatePendingCardId(input.cardId);
      setActionError(null);

      try {
        const result = await apiClient.createAuction({
          cardId: input.cardId,
          startingBid: input.startingBid,
          durationType: input.durationType
        });

        await Promise.all([mutate(), mutateOwnedCards()]);
        return result.auction.id;
      } catch (caughtError) {
        setActionError(mapApiErrorToMessage(caughtError) || "Failed to create auction.");
        return null;
      } finally {
        setCreatePendingCardId(null);
      }
    },
    [mutate, mutateOwnedCards]
  );

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

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void mutate();
    }, AUCTIONS_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [mutate]);

  const mappedError = error ?? ownedCardsError;

  return {
    auctions,
    ownedCards: ownedCardsData ?? [],
    loading: isLoading && !data,
    loadingMore: Boolean(data) && isValidating,
    error: actionError ?? (mappedError ? mapApiErrorToMessage(mappedError) || "Failed to load auctions." : null),
    page: size,
    limit: 24,
    total,
    hasMore,
    createPendingCardId,
    refresh,
    loadMore,
    createAuction
  };
}
