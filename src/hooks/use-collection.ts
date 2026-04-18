"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  apiClient,
  mapApiErrorToMessage,
  type CollectionCard,
  type CollectionPortfolio,
  type CollectionSort
} from "@/lib/api-client";
import type { PriceUpdateEvent } from "@/lib/socket-client";
import type { CardState, RarityTier } from "@/lib/types";
import { useMarketplaceRoom, usePortfolioRoom } from "./use-socket";
import { useAuth } from "./use-auth";

type UseCollectionState = {
  cards: CollectionCard[];
  portfolio: CollectionPortfolio | null;
  loading: boolean;
  error: string | null;
  page: number;
  limit: number;
  total: number;
  listingPendingCardId: string | null;
  cancelPendingListingId: string | null;
  refresh: () => Promise<void>;
  createListing: (cardId: string, price: number) => Promise<void>;
  cancelListing: (listingId: string) => Promise<void>;
};

type UseCollectionInput = {
  rarity?: RarityTier | null;
  state?: CardState | null;
  sort?: CollectionSort;
  page?: number;
  limit?: number;
  enabled?: boolean;
  enableRealtime?: boolean;
};

const PRICE_PATCH_BATCH_WINDOW_MS = 2_000;

export function useCollection(input: UseCollectionInput = {}): UseCollectionState {
  const enabled = input.enabled ?? true;
  const { user, refreshAuth } = useAuth();
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [portfolio, setPortfolio] = useState<CollectionPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(input.page ?? 1);
  const [limit, setLimit] = useState(input.limit ?? 24);
  const [total, setTotal] = useState(0);
  const [listingPendingCardId, setListingPendingCardId] = useState<string | null>(null);
  const [cancelPendingListingId, setCancelPendingListingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const batchedPriceEventRef = useRef<PriceUpdateEvent | null>(null);
  const priceBatchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      if (priceBatchTimerRef.current !== null) {
        window.clearTimeout(priceBatchTimerRef.current);
        priceBatchTimerRef.current = null;
      }
      mountedRef.current = false;
      batchedPriceEventRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (input.enableRealtime && user?.id) {
      return;
    }

    if (priceBatchTimerRef.current !== null) {
      window.clearTimeout(priceBatchTimerRef.current);
      priceBatchTimerRef.current = null;
    }

    batchedPriceEventRef.current = null;
  }, [input.enableRealtime, user?.id]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [collection, portfolioResult] = await Promise.all([
        apiClient.listCollection({
          rarity: input.rarity ?? null,
          state: input.state ?? null,
          sort: input.sort ?? "newest",
          page: input.page ?? 1,
          limit: input.limit ?? 24
        }),
        apiClient.getCollectionPortfolio()
      ]);

      if (!mountedRef.current) {
        return;
      }

      setCards(collection.cards);
      setPage(collection.page);
      setLimit(collection.limit);
      setTotal(collection.total);
      setPortfolio(portfolioResult.portfolio);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      const message = mapApiErrorToMessage(err);
      setError(message || "Failed to load collection.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, input.limit, input.page, input.rarity, input.sort, input.state]);

  useEffect(() => {
    if (!enabled) {
      setCards([]);
      setPortfolio(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const [collection, portfolioResult] = await Promise.all([
          apiClient.listCollection(
            {
              rarity: input.rarity ?? null,
              state: input.state ?? null,
              sort: input.sort ?? "newest",
              page: input.page ?? 1,
              limit: input.limit ?? 24
            },
            controller.signal
          ),
          apiClient.getCollectionPortfolio(controller.signal)
        ]);

        if (!mounted) {
          return;
        }

        setCards(collection.cards);
        setPage(collection.page);
        setLimit(collection.limit);
        setTotal(collection.total);
        setPortfolio(portfolioResult.portfolio);
      } catch (err) {
        if (!mounted) {
          return;
        }
        if (err instanceof ApiClientError && err.code === "REQUEST_ABORTED") {
          return;
        }
        const message = mapApiErrorToMessage(err);
        setError(message || "Failed to load collection.");
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
  }, [enabled, input.limit, input.page, input.rarity, input.sort, input.state]);

  const createListing = useCallback(
    async (cardId: string, price: number): Promise<void> => {
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }

      setListingPendingCardId(cardId);
      setError(null);

      try {
        await apiClient.createListing({ cardId, price });
        await Promise.all([refresh(), refreshAuth()]);
      } catch (err) {
        if (!mountedRef.current) {
          throw err;
        }
        setError(mapApiErrorToMessage(err));
        throw err;
      } finally {
        if (mountedRef.current) {
          setListingPendingCardId(null);
        }
      }
    },
    [refresh, refreshAuth]
  );

  const cancelListing = useCallback(
    async (listingId: string): Promise<void> => {
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }

      setCancelPendingListingId(listingId);
      setError(null);

      try {
        await apiClient.cancelListing(listingId);
        await Promise.all([refresh(), refreshAuth()]);
      } catch (err) {
        if (!mountedRef.current) {
          throw err;
        }
        setError(mapApiErrorToMessage(err));
        throw err;
      } finally {
        if (mountedRef.current) {
          setCancelPendingListingId(null);
        }
      }
    },
    [refresh, refreshAuth]
  );

  const applyPriceUpdate = useCallback((event: PriceUpdateEvent): void => {
    if (!mountedRef.current) {
      return;
    }

    const patchesByCardId = new Map(event.updates.map((entry) => [entry.cardId, entry]));
    const rarityDeltaByTier = new Map(event.portfolioDelta.byRarity.map((entry) => [entry.rarityTier, entry.marketValueDelta]));

    setCards((previous) => {
      if (previous.length === 0 || patchesByCardId.size === 0) {
        return previous;
      }

      let changed = false;
      const next = previous.map((card) => {
        const patch = patchesByCardId.get(card.id);
        if (!patch) {
          return card;
        }

        changed = true;
        const currentPrice = patch.newPrice;

        return {
          ...card,
          currentPrice,
          pnl: currentPrice - card.acquisitionPrice
        };
      });

      return changed ? next : previous;
    });

    setPortfolio((previous) => {
      if (!previous) {
        return previous;
      }

      return {
        ...previous,
        totalMarketValue: previous.totalMarketValue + event.portfolioDelta.totalMarketValueDelta,
        totalPnl: previous.totalPnl + event.portfolioDelta.totalPnlDelta,
        byRarity: previous.byRarity.map((entry) => ({
          ...entry,
          marketValue: entry.marketValue + (rarityDeltaByTier.get(entry.rarityTier) ?? 0)
        }))
      };
    });
  }, []);

  const flushBatchedPriceUpdate = useCallback((): void => {
    if (!mountedRef.current) {
      return;
    }

    const event = batchedPriceEventRef.current;
    batchedPriceEventRef.current = null;

    if (!event) {
      return;
    }

    applyPriceUpdate(event);
  }, [applyPriceUpdate]);

  const enqueuePriceUpdate = useCallback(
    (event: PriceUpdateEvent): void => {
      const existing = batchedPriceEventRef.current;

      if (!existing) {
        batchedPriceEventRef.current = {
          ...event,
          updates: [...event.updates],
          portfolioDelta: {
            totalMarketValueDelta: event.portfolioDelta.totalMarketValueDelta,
            totalPnlDelta: event.portfolioDelta.totalPnlDelta,
            byRarity: [...event.portfolioDelta.byRarity]
          }
        };
      } else {
        const updatesByCardId = new Map(existing.updates.map((entry) => [entry.cardId, entry]));
        for (const update of event.updates) {
          updatesByCardId.set(update.cardId, update);
        }

        const rarityDeltaByTier = new Map(
          existing.portfolioDelta.byRarity.map((entry) => [entry.rarityTier, entry.marketValueDelta])
        );
        for (const delta of event.portfolioDelta.byRarity) {
          rarityDeltaByTier.set(delta.rarityTier, (rarityDeltaByTier.get(delta.rarityTier) ?? 0) + delta.marketValueDelta);
        }

        batchedPriceEventRef.current = {
          ...existing,
          updates: Array.from(updatesByCardId.values()),
          portfolioDelta: {
            totalMarketValueDelta:
              existing.portfolioDelta.totalMarketValueDelta + event.portfolioDelta.totalMarketValueDelta,
            totalPnlDelta: existing.portfolioDelta.totalPnlDelta + event.portfolioDelta.totalPnlDelta,
            byRarity: Array.from(rarityDeltaByTier.entries()).map(([rarityTier, marketValueDelta]) => ({
              rarityTier,
              marketValueDelta
            }))
          },
          updatedAt: existing.updatedAt > event.updatedAt ? existing.updatedAt : event.updatedAt
        };
      }

      if (priceBatchTimerRef.current !== null) {
        return;
      }

      priceBatchTimerRef.current = window.setTimeout(() => {
        priceBatchTimerRef.current = null;
        flushBatchedPriceUpdate();
      }, PRICE_PATCH_BATCH_WINDOW_MS);
    },
    [flushBatchedPriceUpdate]
  );

  useMarketplaceRoom(Boolean(input.enableRealtime), {
    onListingCreated: () => {
      void refresh();
    },
    onListingSold: () => {
      void refresh();
    },
    onListingCancelled: () => {
      void refresh();
    },
    onConnected: () => {
      void refresh();
    }
  });

  usePortfolioRoom(input.enableRealtime && enabled ? user?.id ?? null : null, {
    onPriceUpdate: (event) => {
      enqueuePriceUpdate(event);
    },
    onConnected: () => {
      flushBatchedPriceUpdate();
      void refresh();
    }
  });

  return useMemo(
    () => ({
      cards,
      portfolio,
      loading,
      error,
      page,
      limit,
      total,
      listingPendingCardId,
      cancelPendingListingId,
      refresh,
      createListing,
      cancelListing
    }),
    [
      cards,
      portfolio,
      loading,
      error,
      page,
      limit,
      total,
      listingPendingCardId,
      cancelPendingListingId,
      refresh,
      createListing,
      cancelListing
    ]
  );
}
