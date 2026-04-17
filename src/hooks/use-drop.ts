"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiClient, mapApiErrorToMessage, type Drop, type PurchaseResult } from "@/lib/api-client";
import type { PackTier } from "@/lib/types";
import { useDropRoom } from "./use-socket";
import { useRef } from "react";

type UseDropState = {
  drop: Drop | null;
  loading: boolean;
  error: string | null;
  purchasePendingTier: PackTier | null;
  lastPurchase: PurchaseResult | null;
  refresh: () => Promise<void>;
  purchaseTier: (tier: PackTier) => Promise<PurchaseResult>;
  clearPurchaseResult: () => void;
};

export function useDrop(dropId: string, enableRealtime = true): UseDropState {
  const [drop, setDrop] = useState<Drop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasePendingTier, setPurchasePendingTier] = useState<PackTier | null>(null);
  const [lastPurchase, setLastPurchase] = useState<PurchaseResult | null>(null);
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
      const result = await apiClient.getDrop(dropId);
      if (!mountedRef.current) {
        return;
      }
      setDrop(result.drop);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      setError(mapApiErrorToMessage(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [dropId]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.getDrop(dropId, controller.signal);
        if (!mounted) {
          return;
        }
        setDrop(result.drop);
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
  }, [dropId]);

  const purchaseTier = useCallback(
    async (tier: PackTier): Promise<PurchaseResult> => {
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }

      setPurchasePendingTier(tier);
      setError(null);

      try {
        const result = await apiClient.purchaseDropTier(dropId, tier);
        if (!mountedRef.current) {
          throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
        }
        setLastPurchase(result.purchase);
        setDrop((previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,
            tiers: previous.tiers.map((item) =>
              item.tier === tier
                ? { ...item, remainingInventory: result.purchase.remainingInventory }
                : item
            )
          };
        });

        return result.purchase;
      } catch (err) {
        if (!mountedRef.current) {
          throw err;
        }
        const message = mapApiErrorToMessage(err);
        if (message) {
          setError(message);
        }
        throw err;
      } finally {
        if (mountedRef.current) {
          setPurchasePendingTier(null);
        }
      }
    },
    [dropId]
  );

  const clearPurchaseResult = useCallback((): void => {
    setLastPurchase(null);
  }, []);

  useDropRoom(enableRealtime ? dropId : null, {
    onInventoryUpdate: (event) => {
      setDrop((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          tiers: previous.tiers.map((item) =>
            item.tier === event.tier ? { ...item, remainingInventory: event.remainingInventory } : item
          )
        };
      });
    },
    onSoldOut: (event) => {
      setDrop((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          tiers: previous.tiers.map((item) =>
            item.tier === event.tier ? { ...item, remainingInventory: 0 } : item
          )
        };
      });
    },
    onDropStarted: () => {
      setDrop((previous) => (previous ? { ...previous, status: "active" } : previous));
    },
    onDropCompleted: () => {
      setDrop((previous) => (previous ? { ...previous, status: "completed" } : previous));
    },
    onConnected: () => {
      void (async () => {
        try {
          const result = await apiClient.getDrop(dropId);
          if (!mountedRef.current) {
            return;
          }
          setDrop(result.drop);
        } catch (_error) {
          // Realtime reconnect sync is best-effort; UI keeps last known state on transient failures.
        }
      })();
    }
  });

  return useMemo(
    () => ({
      drop,
      loading,
      error,
      purchasePendingTier,
      lastPurchase,
      refresh,
      purchaseTier,
      clearPurchaseResult
    }),
    [drop, loading, error, purchasePendingTier, lastPurchase, refresh, purchaseTier, clearPurchaseResult]
  );
}
