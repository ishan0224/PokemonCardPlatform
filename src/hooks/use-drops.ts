"use client";

import { useCallback, useMemo } from "react";
import { apiClient, mapApiErrorToMessage, type Drop } from "@/lib/api-client";
import { createApiKey, useApiSWRInfinite } from "@/lib/swr";

type DropsPage = {
  drops: Drop[];
  page: number;
  limit: number;
  hasMore: boolean;
};

type UseDropsState = {
  drops: Drop[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
};

export function useDrops(limit = 12): UseDropsState {
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useApiSWRInfinite(
    (index, previousPageData: DropsPage | null) => {
      if (previousPageData && !previousPageData.hasMore) {
        return null;
      }

      return createApiKey("drops:list:infinite", {
        page: index + 1,
        limit
      });
    },
    async (params) => {
      const page = (params as { page?: number }).page ?? 1;
      const pageLimit = (params as { limit?: number }).limit ?? limit;
      const expandedLimit = page * pageLimit;
      const result = await apiClient.listDrops(expandedLimit);
      const start = (page - 1) * pageLimit;
      const end = start + pageLimit;
      const pageDrops = result.drops.slice(start, end);

      return {
        drops: pageDrops,
        page,
        limit: pageLimit,
        hasMore: pageDrops.length === pageLimit
      } satisfies DropsPage;
    },
    {
      revalidateFirstPage: true,
      shouldRetryOnError: false,
      persistSize: true
    }
  );

  const drops = useMemo(() => (data ? data.flatMap((page) => page.drops) : []), [data]);
  const hasMore = data ? data[data.length - 1]?.hasMore ?? false : false;
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
    drops,
    loading: isLoading && !data,
    loadingMore,
    error: error ? mapApiErrorToMessage(error) || "Failed to load drops." : null,
    hasMore,
    refresh,
    loadMore
  };
}
