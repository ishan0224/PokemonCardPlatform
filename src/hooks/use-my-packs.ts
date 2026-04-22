"use client";

import { useCallback, useMemo } from "react";
import { apiClient, mapApiErrorToMessage, type PackSummary } from "@/lib/api-client";
import { swrKeys, useApiSWRInfinite } from "@/lib/swr";

type MyPacksPage = {
  packs: PackSummary[];
  nextCursor: string | null;
};

type UseMyPacksInput = {
  opened?: boolean;
  limit?: number;
};

type UseMyPacksState = {
  packs: PackSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
};

export function useMyPacks(input: UseMyPacksInput = {}): UseMyPacksState {
  const limit = input.limit ?? 24;

  const { data, error, isLoading, isValidating, setSize, mutate } = useApiSWRInfinite(
    (index, previousPageData: MyPacksPage | null) => {
      if (index > 0 && previousPageData && !previousPageData.nextCursor) {
        return null;
      }

      return swrKeys.packs.my({
        opened: typeof input.opened === "boolean" ? input.opened : null,
        cursor: index === 0 ? null : (previousPageData?.nextCursor ?? null),
        limit
      });
    },
    (params) => {
      const parsed = params as { opened?: boolean | null; cursor?: string | null; limit?: number };
      return apiClient.listMyPacks({
        opened: typeof parsed.opened === "boolean" ? parsed.opened : undefined,
        cursor: parsed.cursor ?? null,
        limit: parsed.limit ?? limit
      });
    },
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

  const refresh = useCallback(async (): Promise<void> => {
    await mutate();
  }, [mutate]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loadingMore) {
      return;
    }

    await setSize((current) => current + 1);
  }, [hasMore, loadingMore, setSize]);

  return {
    packs,
    loading: isLoading && !data,
    loadingMore,
    error: error ? mapApiErrorToMessage(error) || "Failed to load packs." : null,
    hasMore,
    refresh,
    loadMore
  };
}
