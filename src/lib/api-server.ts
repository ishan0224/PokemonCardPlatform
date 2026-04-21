import "server-only";

import type {
  ApiBalance,
  Auction,
  CollectionCard,
  Drop,
  PackSummary
} from "@/lib/api-client";
import { listActiveAuctions } from "@/server/services/auction.service";
import { getUserBalance } from "@/server/services/balance.service";
import { listCollectionCards } from "@/server/services/collection.service";
import { listDrops as listDropsService } from "@/server/services/drop.service";
import { listUserPacks } from "@/server/services/pack.service";

export const serverApiClient = {
  async listDrops(limit: number): Promise<{ drops: Drop[] }> {
    const drops = await listDropsService(limit);
    return { drops: drops as Drop[] };
  },

  async listAuctions(input: {
    page: number;
    limit: number;
  }): Promise<{ auctions: Auction[]; page: number; limit: number; total: number }> {
    const result = await listActiveAuctions(input);

    return {
      auctions: result.auctions as Auction[],
      page: result.page,
      limit: result.limit,
      total: result.total
    };
  },

  async listPacks(userId: string, limit: number): Promise<{ packs: PackSummary[] }> {
    const packs = await listUserPacks(userId, limit);
    return { packs: packs as PackSummary[] };
  },

  async listCollection(
    userId: string,
    input: { sort: "value_desc"; page: number; limit: number }
  ): Promise<{ cards: CollectionCard[]; page: number; limit: number; total: number }> {
    const result = await listCollectionCards({
      userId,
      sort: input.sort,
      page: input.page,
      limit: input.limit
    });

    return {
      cards: result.cards as CollectionCard[],
      page: result.page,
      limit: result.limit,
      total: result.total
    };
  },

  async getBalance(userId: string): Promise<ApiBalance> {
    return getUserBalance(userId);
  }
};
