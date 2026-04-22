"use client";

import { apiClient, mapApiErrorToMessage, type CollectionCardDetail } from "@/lib/api-client";
import { swrKeys, useApiSWR } from "@/lib/swr";

type UseCollectionCardState = {
  card: CollectionCardDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<CollectionCardDetail | undefined>;
};

export function useCollectionCard(cardId: string | null, enabled = true): UseCollectionCardState {
  const key = enabled && cardId ? swrKeys.collection.card(cardId) : null;
  const { data, error, isLoading, mutate } = useApiSWR(
    key,
    (params) => apiClient.getCollectionCard((params as { cardId: string }).cardId).then((result) => result.card),
    {
      shouldRetryOnError: false,
      revalidateOnFocus: true
    }
  );

  return {
    card: data ?? null,
    loading: enabled ? isLoading && !data : false,
    error: error ? mapApiErrorToMessage(error) || "Failed to load card details." : null,
    refresh: async () => mutate()
  };
}
