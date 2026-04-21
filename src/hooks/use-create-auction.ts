"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { apiClient, mapApiErrorToMessage, type Auction, type AuctionDetail, type CollectionCard } from "@/lib/api-client";
import type { AuctionDurationType } from "@/lib/types";
import { useAuth } from "./use-auth";

type AuctionsPage = {
  auctions: Auction[];
  page: number;
  limit: number;
  total: number;
};

type CollectionPage = {
  cards: CollectionCard[];
  page: number;
  limit: number;
  total: number;
};

type CollectionCacheData = CollectionPage | CollectionPage[] | undefined;
type AuctionsCacheData = AuctionsPage | AuctionsPage[] | undefined;

type CreateAuctionInput = {
  card: CollectionCard;
  startingBid: number;
  durationType: AuctionDurationType;
};

type UseCreateAuctionState = {
  createAuction: (input: CreateAuctionInput) => Promise<string>;
  pendingCardId: string | null;
  error: string | null;
  lastCreatedAuctionId: string | null;
};

const COLLECTION_LIST_RESOURCE = "collection:list";
const AUCTIONS_LIST_RESOURCE = "auctions:list:infinite";

const DURATION_MS: Record<AuctionDurationType, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000
};

function isResourceKey(resource: string, key: unknown): boolean {
  return Array.isArray(key) && key[0] === resource;
}

function mapAuctionDetailToAuction(detail: AuctionDetail): Auction {
  return {
    id: detail.id,
    cardId: detail.cardId,
    sellerId: detail.sellerId,
    sellerUsername: detail.sellerUsername,
    startingBid: detail.startingBid,
    currentBid: detail.currentBid,
    currentBidderId: detail.currentBidderId,
    currentBidderUsername: detail.currentBidderUsername,
    endsAt: detail.endsAt,
    originalEndTime: detail.originalEndTime,
    durationType: detail.durationType,
    status: detail.status,
    createdAt: detail.createdAt,
    minNextBid: detail.minNextBid,
    card: detail.card
  };
}

function buildOptimisticAuction(input: {
  card: CollectionCard;
  sellerId: string;
  sellerUsername: string;
  startingBid: number;
  durationType: AuctionDurationType;
  optimisticId: string;
}): Auction {
  const createdAt = new Date();
  const endsAt = new Date(createdAt.getTime() + DURATION_MS[input.durationType]).toISOString();

  return {
    id: input.optimisticId,
    cardId: input.card.id,
    sellerId: input.sellerId,
    sellerUsername: input.sellerUsername,
    startingBid: input.startingBid,
    currentBid: null,
    currentBidderId: null,
    currentBidderUsername: null,
    endsAt,
    originalEndTime: endsAt,
    durationType: input.durationType,
    status: "active",
    createdAt: createdAt.toISOString(),
    minNextBid: input.startingBid,
    card: {
      id: input.card.id,
      slotNumber: input.card.slotNumber,
      rarityTier: input.card.pokemonCard.rarityTier,
      acquisitionPrice: input.card.acquisitionPrice,
      ownerId: input.card.ownerId,
      pokemonCard: {
        id: input.card.pokemonCard.id,
        tcgId: input.card.pokemonCard.tcgId,
        name: input.card.pokemonCard.name,
        setName: input.card.pokemonCard.setName,
        rarity: input.card.pokemonCard.rarity,
        rarityTier: input.card.pokemonCard.rarityTier,
        imageUrl: input.card.pokemonCard.imageUrl,
        imageUrlHires: input.card.pokemonCard.imageUrlHires,
        currentPrice: input.card.currentPrice
      }
    }
  };
}

function removeCardFromCollectionPages(data: CollectionCacheData, cardId: string): CollectionCacheData {
  if (!data) {
    return data;
  }

  if (!Array.isArray(data)) {
    const nextCards = data.cards.filter((card) => card.id !== cardId);
    if (nextCards.length === data.cards.length) {
      return data;
    }

    return {
      ...data,
      cards: nextCards,
      total: Math.max(0, data.total - 1)
    };
  }

  let removed = false;
  const next = data.map((page) => {
    const nextCards = page.cards.filter((card) => {
      if (card.id !== cardId) {
        return true;
      }

      removed = true;
      return false;
    });

    if (nextCards.length === page.cards.length) {
      return page;
    }

    return {
      ...page,
      cards: nextCards
    };
  });

  if (!removed) {
    return data;
  }

  return next.map((page) => ({
    ...page,
    total: Math.max(0, page.total - 1)
  }));
}

function restoreCardToCollectionPages(data: CollectionCacheData, card: CollectionCard): CollectionCacheData {
  if (!data) {
    return data;
  }

  if (!Array.isArray(data)) {
    const alreadyPresent = data.cards.some((current) => current.id === card.id);
    if (alreadyPresent) {
      return data;
    }

    return {
      ...data,
      cards: data.page === 1 ? [card, ...data.cards].slice(0, data.limit) : data.cards,
      total: data.total + 1
    };
  }

  if (data.length === 0) {
    return data;
  }

  const alreadyPresent = data.some((page) => page.cards.some((current) => current.id === card.id));
  if (alreadyPresent) {
    return data;
  }

  const [firstPage, ...restPages] = data;
  const nextFirstCards = [card, ...firstPage.cards].slice(0, firstPage.limit);

  return [
    {
      ...firstPage,
      cards: nextFirstCards,
      total: firstPage.total + 1
    },
    ...restPages.map((page) => ({
      ...page,
      total: page.total + 1
    }))
  ];
}

function prependAuctionToPages(data: AuctionsCacheData, auction: Auction): AuctionsCacheData {
  if (!data) {
    return data;
  }

  if (!Array.isArray(data)) {
    const alreadyPresent = data.auctions.some((current) => current.id === auction.id);
    if (alreadyPresent) {
      return data;
    }

    return {
      ...data,
      auctions: data.page === 1 ? [auction, ...data.auctions].slice(0, data.limit) : data.auctions,
      total: data.total + 1
    };
  }

  const alreadyPresent = data.some((page) => page.auctions.some((current) => current.id === auction.id));
  if (alreadyPresent) {
    return data;
  }

  const [firstPage, ...restPages] = data;
  const nextFirstAuctions = [auction, ...firstPage.auctions].slice(0, firstPage.limit);

  return [
    {
      ...firstPage,
      auctions: nextFirstAuctions,
      total: firstPage.total + 1
    },
    ...restPages.map((page) => ({
      ...page,
      total: page.total + 1
    }))
  ];
}

function removeAuctionFromPages(data: AuctionsCacheData, auctionId: string): AuctionsCacheData {
  if (!data) {
    return data;
  }

  if (!Array.isArray(data)) {
    const nextAuctions = data.auctions.filter((auction) => auction.id !== auctionId);
    if (nextAuctions.length === data.auctions.length) {
      return data;
    }

    return {
      ...data,
      auctions: nextAuctions,
      total: Math.max(0, data.total - 1)
    };
  }

  let removed = false;
  const next = data.map((page) => {
    const nextAuctions = page.auctions.filter((auction) => {
      if (auction.id !== auctionId) {
        return true;
      }

      removed = true;
      return false;
    });

    if (nextAuctions.length === page.auctions.length) {
      return page;
    }

    return {
      ...page,
      auctions: nextAuctions
    };
  });

  if (!removed) {
    return data;
  }

  return next.map((page) => ({
    ...page,
    total: Math.max(0, page.total - 1)
  }));
}

function replaceAuctionInPages(data: AuctionsCacheData, previousId: string, nextAuction: Auction): AuctionsCacheData {
  if (!data) {
    return data;
  }

  if (!Array.isArray(data)) {
    const hasPrevious = data.auctions.some((auction) => auction.id === previousId);
    if (hasPrevious) {
      return {
        ...data,
        auctions: data.auctions.map((auction) => (auction.id === previousId ? nextAuction : auction))
      };
    }

    if (data.page === 1) {
      return prependAuctionToPages(data, nextAuction);
    }

    return data;
  }

  if (data.length === 0) {
    return data;
  }

  let replaced = false;
  const replacedPages = data.map((page) => {
    let pageChanged = false;
    const nextAuctions = page.auctions.map((auction) => {
      if (auction.id !== previousId) {
        return auction;
      }

      replaced = true;
      pageChanged = true;
      return nextAuction;
    });

    if (!pageChanged) {
      return page;
    }

    return {
      ...page,
      auctions: nextAuctions
    };
  });

  if (replaced) {
    return replacedPages;
  }

  return prependAuctionToPages(data, nextAuction);
}

export function useCreateAuction(): UseCreateAuctionState {
  const { mutate } = useSWRConfig();
  const { user } = useAuth();

  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCreatedAuctionId, setLastCreatedAuctionId] = useState<string | null>(null);

  const createAuction = useCallback(
    async (input: CreateAuctionInput): Promise<string> => {
      if (!user) {
        const message = "Please log in to continue.";
        setError(message);
        throw new Error(message);
      }

      setPendingCardId(input.card.id);
      setError(null);

      const optimisticId = `optimistic-auction:${input.card.id}:${Date.now()}`;
      const optimisticAuction = buildOptimisticAuction({
        card: input.card,
        sellerId: user.id,
        sellerUsername: user.username,
        startingBid: input.startingBid,
        durationType: input.durationType,
        optimisticId
      });

      await Promise.all([
        mutate(
          (key: unknown) => isResourceKey(COLLECTION_LIST_RESOURCE, key),
          (current: CollectionCacheData) => removeCardFromCollectionPages(current, input.card.id),
          { revalidate: false, populateCache: true }
        ),
        mutate(
          (key: unknown) => isResourceKey(AUCTIONS_LIST_RESOURCE, key),
          (current: AuctionsCacheData) => prependAuctionToPages(current, optimisticAuction),
          { revalidate: false, populateCache: true }
        )
      ]);

      try {
        const result = await apiClient.createAuction({
          cardId: input.card.id,
          startingBid: input.startingBid,
          durationType: input.durationType
        });

        const createdAuction = mapAuctionDetailToAuction(result.auction);

        await Promise.all([
          mutate(
            (key: unknown) => isResourceKey(COLLECTION_LIST_RESOURCE, key),
            (current: CollectionCacheData) => removeCardFromCollectionPages(current, input.card.id),
            { revalidate: false, populateCache: true }
          ),
          mutate(
            (key: unknown) => isResourceKey(AUCTIONS_LIST_RESOURCE, key),
            (current: AuctionsCacheData) => replaceAuctionInPages(current, optimisticId, createdAuction),
            { revalidate: false, populateCache: true }
          )
        ]);

        setLastCreatedAuctionId(createdAuction.id);
        return createdAuction.id;
      } catch (caughtError) {
        const message = mapApiErrorToMessage(caughtError) || "Failed to create auction.";
        setError(message);

        await Promise.all([
          mutate(
            (key: unknown) => isResourceKey(COLLECTION_LIST_RESOURCE, key),
            (current: CollectionCacheData) => restoreCardToCollectionPages(current, input.card),
            { revalidate: false, populateCache: true }
          ),
          mutate(
            (key: unknown) => isResourceKey(AUCTIONS_LIST_RESOURCE, key),
            (current: AuctionsCacheData) => removeAuctionFromPages(current, optimisticId),
            { revalidate: false, populateCache: true }
          )
        ]);

        throw new Error(message);
      } finally {
        setPendingCardId(null);
      }
    },
    [mutate, user]
  );

  return {
    createAuction,
    pendingCardId,
    error,
    lastCreatedAuctionId
  };
}
