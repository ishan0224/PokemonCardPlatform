"use client";

import { useCallback, useMemo } from "react";
import { apiClient, mapApiErrorToMessage, type Drop } from "@/lib/api-client";
import { createApiKey, useApiSWRInfinite } from "@/lib/swr";

export type PublicDropStatus = "upcoming" | "active";

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

type DropsStatusClient = {
  listActiveDrops?: (limit?: number) => Promise<{ drops: Drop[] }>;
  listUpcomingDrops?: (limit?: number) => Promise<{ drops: Drop[] }>;
};

function sortByStatusViewOrder(status: PublicDropStatus, drops: Drop[]): Drop[] {
  if (status === "upcoming") {
    return [...drops].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
  }

  return [...drops].sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
  );
}

function listDropsByStatus(status: PublicDropStatus, limit: number): Promise<{ drops: Drop[] }> {
  const statusClient = apiClient as DropsStatusClient;

  if (status === "active" && typeof statusClient.listActiveDrops === "function") {
    return statusClient.listActiveDrops(limit);
  }

  if (status === "upcoming" && typeof statusClient.listUpcomingDrops === "function") {
    return statusClient.listUpcomingDrops(limit);
  }

  // Fallback for stale client chunks/HMR mismatch: derive status-scoped list from the legacy mixed endpoint.
  return apiClient.listDrops(limit).then((result) => ({
    drops: sortByStatusViewOrder(
      status,
      result.drops.filter((drop) => drop.status === status)
    )
  }));
}

export function useDropsByStatus(status: PublicDropStatus, limit = 12): UseDropsState {
  const { data, error, isLoading, isValidating, setSize, mutate } = useApiSWRInfinite(
    (index, previousPageData: DropsPage | null) => {
      if (previousPageData && !previousPageData.hasMore) {
        return null;
      }

      return createApiKey("drops:list:status:infinite", {
        status,
        page: index + 1,
        limit
      });
    },
    async (params) => {
      const page = (params as { page?: number }).page ?? 1;
      const pageLimit = (params as { limit?: number }).limit ?? limit;
      const scopedStatus = (params as { status?: PublicDropStatus }).status ?? status;
      const expandedLimit = page * pageLimit;
      const result = await listDropsByStatus(scopedStatus, expandedLimit);
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

export function useDrops(limit = 12): UseDropsState {
  return useDropsByStatus("active", limit);
}
