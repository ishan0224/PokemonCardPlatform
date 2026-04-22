"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { apiClient, mapApiErrorToMessage } from "@/lib/api-client";
import { swrKeys } from "@/lib/swr";
import { useAuth } from "./use-auth";

type UseCollectionMutationsInput = {
  revalidateList?: () => Promise<unknown>;
  revalidatePortfolio?: () => Promise<unknown>;
};

type UseCollectionMutationsState = {
  listingPendingCardId: string | null;
  cancelPendingListingId: string | null;
  error: string | null;
  createListing: (cardId: string, price: number) => Promise<void>;
  cancelListing: (listingId: string) => Promise<void>;
};

function isCollectionListKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === "collection:list";
}

function isCollectionCardKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === "collection:card";
}

export function useCollectionMutations(input: UseCollectionMutationsInput = {}): UseCollectionMutationsState {
  const { refreshAuth } = useAuth();
  const { mutate: mutateCache } = useSWRConfig();
  const [listingPendingCardId, setListingPendingCardId] = useState<string | null>(null);
  const [cancelPendingListingId, setCancelPendingListingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revalidateList = useCallback(async (): Promise<void> => {
    if (input.revalidateList) {
      await input.revalidateList();
      return;
    }
    await mutateCache((key) => isCollectionListKey(key));
  }, [input.revalidateList, mutateCache]);

  const revalidatePortfolio = useCallback(async (): Promise<void> => {
    if (input.revalidatePortfolio) {
      await input.revalidatePortfolio();
      return;
    }
    await mutateCache(swrKeys.collection.portfolio());
  }, [input.revalidatePortfolio, mutateCache]);

  const createListing = useCallback(
    async (cardId: string, price: number): Promise<void> => {
      setListingPendingCardId(cardId);
      setError(null);

      try {
        await apiClient.createListing({ cardId, price });
        await Promise.all([revalidateList(), revalidatePortfolio(), mutateCache(swrKeys.collection.card(cardId)), refreshAuth()]);
      } catch (caughtError) {
        setError(mapApiErrorToMessage(caughtError) || "Failed to create listing.");
        throw caughtError;
      } finally {
        setListingPendingCardId(null);
      }
    },
    [mutateCache, refreshAuth, revalidateList, revalidatePortfolio]
  );

  const cancelListing = useCallback(
    async (listingId: string): Promise<void> => {
      setCancelPendingListingId(listingId);
      setError(null);

      try {
        await apiClient.cancelListing(listingId);
        await Promise.all([revalidateList(), revalidatePortfolio(), mutateCache((key) => isCollectionCardKey(key)), refreshAuth()]);
      } catch (caughtError) {
        setError(mapApiErrorToMessage(caughtError) || "Failed to cancel listing.");
        throw caughtError;
      } finally {
        setCancelPendingListingId(null);
      }
    },
    [mutateCache, refreshAuth, revalidateList, revalidatePortfolio]
  );

  return {
    listingPendingCardId,
    cancelPendingListingId,
    error,
    createListing,
    cancelListing
  };
}
