"use client";

import { useCallback, useMemo } from "react";
import { apiClient, mapApiErrorToMessage, type FairnessMyPack } from "@/lib/api-client";
import { swrKeys, useApiSWRInfinite } from "@/lib/swr";

type FairnessMyPacksPage = {
  packs: FairnessMyPack[];
  nextCursor: string | null;
};

type UseFairnessMyPacksInput = {
  date: string;
  dropId?: string | null;
  limit?: number;
  enabled?: boolean;
};

type UseFairnessMyPacksResult = {
  packs: FairnessMyPack[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useFairnessMyPacks(input: UseFairnessMyPacksInput): UseFairnessMyPacksResult {
  const limit = input.limit ?? 20;
  const enabled = input.enabled ?? true;

  const { data, error, isLoading, isValidating, setSize, mutate } = useApiSWRInfinite(
    (index, previousPageData: FairnessMyPacksPage | null) => {
      if (!enabled) {
        return null;
      }

      if (index > 0 && previousPageData && !previousPageData.nextCursor) {
        return null;
      }

      return swrKeys.fairness.myPacks({
        date: input.date,
        dropId: input.dropId ?? null,
        cursor: index === 0 ? null : (previousPageData?.nextCursor ?? null),
        limit
      });
    },
    (params) =>
      apiClient.getMyFairnessPacks({
        date: (params as { date?: string | null }).date ?? null,
        dropId: (params as { dropId?: string | null }).dropId ?? null,
        cursor: (params as { cursor?: string | null }).cursor ?? null,
        limit: (params as { limit?: number }).limit ?? limit
      }),
    {
      revalidateFirstPage: true,
      shouldRetryOnError: false,
      persistSize: false
    }
  );

  const packs = useMemo(() => (data ? data.flatMap((page) => page.packs) : []), [data]);
  const lastPage = data && data.length > 0 ? data[data.length - 1] : null;
  const hasMore = Boolean(lastPage?.nextCursor);
  const loadingMore = Boolean(data) && isValidating;

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loadingMore) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, loadingMore, setSize]);

  const refresh = useCallback(async (): Promise<void> => {
    await mutate();
  }, [mutate]);

  return {
    packs,
    loading: enabled ? isLoading && !data : false,
    loadingMore,
    error: error ? mapApiErrorToMessage(error) || "Failed to load fairness packs." : null,
    hasMore,
    loadMore,
    refresh
  };
}
