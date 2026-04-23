import "server-only";

import type {
  ApiBalance,
  Auction,
  AuctionDetail,
  CollectionCard,
  Drop,
  PackSummary
} from "@/lib/api-client";
import { getAuctionDetail, listActiveAuctions } from "@/server/services/auction.service";
import { getUserBalance } from "@/server/services/balance.service";
import { getCollectionPortfolio, listCollectionCards } from "@/server/services/collection.service";
import { listDrops as listDropsService, listPublicDropsByStatus } from "@/server/services/drop.service";
import { listUserPacks } from "@/server/services/pack.service";
import type { DropStatus } from "@/lib/types";

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
    const result = await listUserPacks({ userId, limit });
    return { packs: result.packs as PackSummary[] };
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
  },

  async getAuction(auctionId: string, viewerUserId?: string | null): Promise<AuctionDetail | null> {
    try {
      const detail = await getAuctionDetail({ auctionId, viewerUserId });
      return detail as unknown as AuctionDetail;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "statusCode" in error && (error as { statusCode: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  },

  async listDropsByStatus(statuses: DropStatus[], limit: number): Promise<{ drops: Drop[] }> {
    const drops = await listPublicDropsByStatus(statuses, limit);
    return { drops: drops as Drop[] };
  },

  async getCollectionPortfolioSummary(userId: string): Promise<{ totalValueCents: number; cardCount: number }> {
    const portfolio = await getCollectionPortfolio(userId);
    return { totalValueCents: portfolio.totalMarketValue, cardCount: portfolio.totalCards };
  }
};
