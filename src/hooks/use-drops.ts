"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiClient, mapApiErrorToMessage, type Drop } from "@/lib/api-client";

type UseDropsState = {
  drops: Drop[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useDrops(limit = 20): UseDropsState {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiClient.listDrops(limit);
      setDrops(result.drops);
    } catch (err) {
      setError(mapApiErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.listDrops(limit, controller.signal);
        if (!mounted) {
          return;
        }
        setDrops(result.drops);
      } catch (err) {
        if (!mounted) {
          return;
        }
        if (err instanceof ApiClientError && err.code === "REQUEST_ABORTED") {
          return;
        }
        setError(mapApiErrorToMessage(err));
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
  }, [limit]);

  return useMemo(
    () => ({
      drops,
      loading,
      error,
      refresh
    }),
    [drops, loading, error, refresh]
  );
}
