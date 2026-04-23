"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiClient, mapApiErrorToMessage, type PackCard, type PackDetail } from "@/lib/api-client";
import { useRef } from "react";

// Light preload — warm the browser cache for each card image as soon as we
// know the URLs (after openPack or when revisiting an already-opened pack).
// This eats the /_next/image proxy + Sharp + Pokemon-CDN round-trip in the
// background while the user is still admiring the sealed pack, so per-slot
// reveal renders the image instantly. Pure client-side cache warmup; no API
// contract change, no server-side change, no React state mutation.
//
// Width 384 matches the next/image srcset entry that retina mobile browsers
// pick for a 160 CSS px (size="md") card. Other widths still benefit from a
// warm Sharp cache (raw-source fetch is the slow part) and a warm Pokemon CDN
// edge connection.
type PreloadableCard = {
  pokemonCard: {
    imageUrl: string | null;
    imageUrlHires: string | null;
  };
};

function preloadCardImages(cards: ReadonlyArray<PreloadableCard> | null | undefined): void {
  if (typeof window === "undefined" || !cards) {
    return;
  }

  for (const card of cards) {
    const rawUrl = card.pokemonCard.imageUrlHires ?? card.pokemonCard.imageUrl;
    if (!rawUrl) {
      continue;
    }
    const proxied = `/_next/image?url=${encodeURIComponent(rawUrl)}&w=384&q=75`;
    const img = new Image();
    img.decoding = "async";
    img.src = proxied;
  }
}

type UsePackRevealState = {
  pack: PackDetail | null;
  loading: boolean;
  error: string | null;
  openPending: boolean;
  revealPendingSlot: number | null;
  slotOrder: number[];
  revealedCardsBySlot: Record<number, PackCard>;
  openPack: () => Promise<void>;
  revealNext: () => Promise<void>;
  revealSlot: (slotNumber: number) => Promise<void>;
  refresh: () => Promise<void>;
};

export function usePackReveal(packId: string): UsePackRevealState {
  const [pack, setPack] = useState<PackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPending, setOpenPending] = useState(false);
  const [revealPendingSlot, setRevealPendingSlot] = useState<number | null>(null);
  const [slotOrder, setSlotOrder] = useState<number[]>([]);
  const [revealedCardsBySlot, setRevealedCardsBySlot] = useState<Record<number, PackCard>>({});
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
      const result = await apiClient.getPack(packId);
      if (!mountedRef.current) {
        return;
      }
      setPack(result.pack);

      if (result.pack.opened && result.pack.cards) {
        // Keep reveal pacing client-driven even after reload/navigation.
        setSlotOrder(result.pack.cards.map((card) => card.slotNumber));
        setRevealedCardsBySlot({});
        preloadCardImages(result.pack.cards);
      } else {
        setSlotOrder([]);
        setRevealedCardsBySlot({});
      }
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
  }, [packId]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.getPack(packId, controller.signal);

        if (!mounted) {
          return;
        }

        setPack(result.pack);

        if (result.pack.opened && result.pack.cards) {
          // Keep reveal pacing client-driven even after reload/navigation.
          setSlotOrder(result.pack.cards.map((card) => card.slotNumber));
          setRevealedCardsBySlot({});
          preloadCardImages(result.pack.cards);
        } else {
          setSlotOrder([]);
          setRevealedCardsBySlot({});
        }
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
  }, [packId]);

  const openPack = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) {
      throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
    }

    setOpenPending(true);
    setError(null);

    try {
      const result = await apiClient.openPack(packId);
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }
      setSlotOrder(result.pack.cards.map((slot) => slot.slotNumber));
      setRevealedCardsBySlot({});
      // Note: openPack response only carries { slotNumber, revealed } per slot
      // — no image URLs — so we can't preload here. URLs become known per-slot
      // via revealPackCard. Preload still helps the revisit/refresh paths
      // (getPack returns full card data when the pack is already opened).
      setPack((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          opened: true,
          openedAt: result.pack.openedAt
        };
      });
    } catch (err) {
      if (!mountedRef.current) {
        throw err;
      }
      setError(mapApiErrorToMessage(err));
      throw err;
    } finally {
      if (mountedRef.current) {
        setOpenPending(false);
      }
    }
  }, [packId]);

  const revealSlot = useCallback(
    async (slotNumber: number): Promise<void> => {
      if (!mountedRef.current) {
        throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
      }

      if (revealedCardsBySlot[slotNumber]) {
        return;
      }

      setRevealPendingSlot(slotNumber);
      setError(null);

      try {
        const result = await apiClient.revealPackCard(packId, slotNumber);
        if (!mountedRef.current) {
          throw new ApiClientError({ code: "REQUEST_ABORTED", message: "View is no longer mounted." }, 499);
        }
        setRevealedCardsBySlot((previous) => ({
          ...previous,
          [slotNumber]: result.card
        }));
      } catch (err) {
        if (!mountedRef.current) {
          throw err;
        }
        setError(mapApiErrorToMessage(err));
        throw err;
      } finally {
        if (mountedRef.current) {
          setRevealPendingSlot(null);
        }
      }
    },
    [packId, revealedCardsBySlot]
  );

  const revealNext = useCallback(async (): Promise<void> => {
    const nextSlot = slotOrder.find((slot) => !revealedCardsBySlot[slot]);
    if (!nextSlot) {
      return;
    }

    await revealSlot(nextSlot);
  }, [slotOrder, revealedCardsBySlot, revealSlot]);

  return useMemo(
    () => ({
      pack,
      loading,
      error,
      openPending,
      revealPendingSlot,
      slotOrder,
      revealedCardsBySlot,
      openPack,
      revealNext,
      revealSlot,
      refresh
    }),
    [
      pack,
      loading,
      error,
      openPending,
      revealPendingSlot,
      slotOrder,
      revealedCardsBySlot,
      openPack,
      revealNext,
      revealSlot,
      refresh
    ]
  );
}
