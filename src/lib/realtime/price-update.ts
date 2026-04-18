import type { RarityTier } from "../types";

export const PRICE_UPDATE_EVENT = "price_update" as const;

export type PriceUpdateDeltaByRarity = {
  rarityTier: RarityTier;
  marketValueDelta: number;
};

export type PriceUpdateEntry = {
  cardId: string;
  pokemonCardId: string;
  rarityTier: RarityTier;
  newPrice: number;
  previousPrice: number;
  changePercent: number;
  updatedAt: string;
};

export type PriceUpdateEvent = {
  userId: string;
  updates: PriceUpdateEntry[];
  portfolioDelta: {
    totalMarketValueDelta: number;
    totalPnlDelta: number;
    byRarity: PriceUpdateDeltaByRarity[];
  };
  updatedAt: string;
};
