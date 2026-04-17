import { withTransaction } from "../db/pool";
import {
  MARKETPLACE_EVENTS_CHANNEL,
  MIN_LISTING_PRICE_CENTS,
  TRADING_FEE_BPS
} from "../config/constants";
import { canUseRedisPubSub, publish } from "../redis/client";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";
import { calculateFeeFromBps } from "../../lib/decimal";
import type { ListingStatus, RarityTier } from "../../lib/types";

export type ListingSort = "newest" | "price_asc" | "price_desc";

export type MarketplaceListingView = {
  id: string;
  cardId: string;
  sellerId: string;
  sellerUsername: string;
  buyerId: string | null;
  price: number;
  status: ListingStatus;
  createdAt: string;
  soldAt: string | null;
  card: {
    id: string;
    slotNumber: number;
    rarityTier: RarityTier;
    acquisitionPrice: number;
    pokemonCard: {
      id: string;
      tcgId: string;
      name: string;
      setName: string;
      rarity: string;
      rarityTier: RarityTier;
      imageUrl: string | null;
      imageUrlHires: string | null;
      currentPrice: number;
    };
  };
};

export type BrowseListingsResult = {
  listings: MarketplaceListingView[];
  page: number;
  limit: number;
  total: number;
};

export type CreateListingResult = {
  listing: MarketplaceListingView;
};

export type CancelListingResult = {
  listing: MarketplaceListingView;
};

export type BuyListingResult = {
  listing: MarketplaceListingView;
  feeCharged: number;
  buyerNewBalance: number;
  sellerNewBalance: number;
};

export class TradeServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 400,
    code = "TRADE_SERVICE_ERROR",
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type ListingRow = {
  listing_id: string;
  card_id: string;
  seller_id: string;
  seller_username: string;
  buyer_id: string | null;
  price: string;
  status: ListingStatus;
  created_at: string;
  sold_at: string | null;
  slot_number: number;
  card_rarity_tier: RarityTier;
  acquisition_price: string;
  pokemon_card_id: string;
  tcg_id: string;
  card_name: string;
  set_name: string;
  rarity: string;
  pokemon_rarity_tier: RarityTier;
  image_url: string | null;
  image_url_hires: string | null;
  current_price: string;
};

type ListingLockRow = {
  id: string;
  card_id: string;
  seller_id: string;
  price: string;
  status: ListingStatus;
};

type MarketplaceRealtimeEventName = "new_listing" | "listing_sold" | "listing_cancelled";

const LISTING_SORT_SQL: Record<ListingSort, string> = {
  newest: "l.created_at DESC",
  price_asc: "l.price ASC, l.created_at DESC",
  price_desc: "l.price DESC, l.created_at DESC"
};

function mapListingRow(row: ListingRow): MarketplaceListingView {
  return {
    id: row.listing_id,
    cardId: row.card_id,
    sellerId: row.seller_id,
    sellerUsername: row.seller_username,
    buyerId: row.buyer_id,
    price: Number(row.price),
    status: row.status,
    createdAt: row.created_at,
    soldAt: row.sold_at,
    card: {
      id: row.card_id,
      slotNumber: row.slot_number,
      rarityTier: row.card_rarity_tier,
      acquisitionPrice: Number(row.acquisition_price),
      pokemonCard: {
        id: row.pokemon_card_id,
        tcgId: row.tcg_id,
        name: row.card_name,
        setName: row.set_name,
        rarity: row.rarity,
        rarityTier: row.pokemon_rarity_tier,
        imageUrl: row.image_url,
        imageUrlHires: row.image_url_hires,
        currentPrice: Number(row.current_price)
      }
    }
  };
}

function calculateTradingFee(price: number): number {
  return calculateFeeFromBps(Math.trunc(price), TRADING_FEE_BPS);
}

async function emitMarketplaceEventViaSocket(
  event: MarketplaceRealtimeEventName,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const io = getIO();
    io.to(roomNames.marketplace()).emit(event, payload);
  } catch (_error) {
    // Socket server may be unavailable in script/test context.
  }
}

async function maybeEmitMarketplaceEvent(
  event: MarketplaceRealtimeEventName,
  payload: Record<string, unknown>
): Promise<void> {
  const message = JSON.stringify({ event, payload });

  if (canUseRedisPubSub()) {
    try {
      await publish(MARKETPLACE_EVENTS_CHANNEL, message);
      return;
    } catch (error) {
      const typed = error as { message?: string };
      console.warn(`[marketplace-events] Redis publish failed: ${typed.message ?? "unknown error"}`);
      await emitMarketplaceEventViaSocket(event, payload);
      return;
    }
  }

  await emitMarketplaceEventViaSocket(event, payload);
}

async function fetchListingByIdForView(
  client: {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
  },
  listingId: string
): Promise<MarketplaceListingView | null> {
  const result = await client.query<ListingRow>(
    `SELECT l.id AS listing_id,
            l.card_id,
            l.seller_id,
            seller.username AS seller_username,
            l.buyer_id,
            l.price,
            l.status,
            l.created_at,
            l.sold_at,
            c.slot_number,
            c.rarity_tier AS card_rarity_tier,
            c.acquisition_price,
            pc.id AS pokemon_card_id,
            pc.tcg_id,
            pc.name AS card_name,
            pc.set_name,
            pc.rarity,
            pc.rarity_tier AS pokemon_rarity_tier,
            pc.image_url,
            pc.image_url_hires,
            pc.current_price
     FROM listings l
     JOIN cards c ON c.id = l.card_id
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     JOIN users seller ON seller.id = l.seller_id
     WHERE l.id = $1`,
    [listingId]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return mapListingRow(result.rows[0]);
}

export async function browseListings(input: {
  rarity?: RarityTier | null;
  sort?: ListingSort;
  page?: number;
  limit?: number;
}): Promise<BrowseListingsResult> {
  const page = Math.max(Math.trunc(input.page ?? 1), 1);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 24), 1), 100);
  const sort = input.sort ?? "newest";
  const offset = (page - 1) * limit;
  const orderBySql = LISTING_SORT_SQL[sort] ?? LISTING_SORT_SQL.newest;
  const rarityFilter = input.rarity ?? null;

  return withTransaction(async (client) => {
    const totalResult = await client.query<{ total: string }>(
      `SELECT COUNT(*)::BIGINT AS total
       FROM listings l
       JOIN cards c ON c.id = l.card_id
       WHERE l.status = 'active'
         AND ($1::text IS NULL OR c.rarity_tier = $1::text)`,
      [rarityFilter]
    );

    const result = await client.query<ListingRow>(
      `SELECT l.id AS listing_id,
              l.card_id,
              l.seller_id,
              seller.username AS seller_username,
              l.buyer_id,
              l.price,
              l.status,
              l.created_at,
              l.sold_at,
              c.slot_number,
              c.rarity_tier AS card_rarity_tier,
              c.acquisition_price,
              pc.id AS pokemon_card_id,
              pc.tcg_id,
              pc.name AS card_name,
              pc.set_name,
              pc.rarity,
              pc.rarity_tier AS pokemon_rarity_tier,
              pc.image_url,
              pc.image_url_hires,
              pc.current_price
       FROM listings l
       JOIN cards c ON c.id = l.card_id
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       JOIN users seller ON seller.id = l.seller_id
       WHERE l.status = 'active'
         AND ($1::text IS NULL OR c.rarity_tier = $1::text)
       ORDER BY ${orderBySql}
       LIMIT $2
       OFFSET $3`,
      [rarityFilter, limit, offset]
    );

    return {
      listings: result.rows.map(mapListingRow),
      page,
      limit,
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  });
}

export async function createListing(input: {
  userId: string;
  cardId: string;
  price: number;
}): Promise<CreateListingResult> {
  const normalizedPrice = Math.trunc(input.price);

  if (!Number.isFinite(normalizedPrice) || normalizedPrice < MIN_LISTING_PRICE_CENTS) {
    throw new TradeServiceError("Listing price must be at least $0.50.", 400, "INVALID_LISTING_PRICE", {
      minimumPrice: MIN_LISTING_PRICE_CENTS
    });
  }

  const listingId = await withTransaction(async (client) => {
    const cardResult = await client.query<{ id: string; owner_id: string; state: string }>(
      `SELECT id, owner_id, state
       FROM cards
       WHERE id = $1
       FOR UPDATE`,
      [input.cardId]
    );

    if (cardResult.rowCount !== 1) {
      throw new TradeServiceError("Card not found.", 404, "CARD_NOT_FOUND", { cardId: input.cardId });
    }

    const card = cardResult.rows[0];

    if (card.owner_id !== input.userId) {
      throw new TradeServiceError("Only the card owner can create a listing.", 403, "NOT_CARD_OWNER", {
        cardId: input.cardId
      });
    }

    if (card.state !== "owned") {
      throw new TradeServiceError("Card is not in a listable state.", 409, "CARD_NOT_LISTABLE", {
        cardId: input.cardId,
        state: card.state
      });
    }

    try {
      const listingResult = await client.query<{ id: string }>(
        `INSERT INTO listings (card_id, seller_id, price, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [input.cardId, input.userId, normalizedPrice]
      );

      await client.query("UPDATE cards SET state = 'listed' WHERE id = $1", [input.cardId]);

      return listingResult.rows[0].id;
    } catch (error) {
      const typed = error as { code?: string };

      if (typed.code === "23505") {
        throw new TradeServiceError("Card already has an active listing.", 409, "LISTING_ALREADY_ACTIVE", {
          cardId: input.cardId
        });
      }

      throw error;
    }
  });

  const listing = await withTransaction(async (client) => {
    const loaded = await fetchListingByIdForView(client, listingId);
    if (!loaded) {
      throw new TradeServiceError("Listing not found after creation.", 500, "LISTING_MISSING");
    }
    return loaded;
  });

  await maybeEmitMarketplaceEvent("new_listing", {
    listingId: listing.id,
    cardId: listing.cardId,
    sellerId: listing.sellerId,
    price: listing.price,
    createdAt: listing.createdAt
  });

  return { listing };
}

export async function cancelListing(input: {
  userId: string;
  listingId: string;
}): Promise<CancelListingResult> {
  await withTransaction(async (client) => {
    const listingResult = await client.query<ListingLockRow>(
      `SELECT id, card_id, seller_id, price, status
       FROM listings
       WHERE id = $1
       FOR UPDATE`,
      [input.listingId]
    );

    if (listingResult.rowCount !== 1) {
      throw new TradeServiceError("Listing not found.", 404, "LISTING_NOT_FOUND", { listingId: input.listingId });
    }

    const listing = listingResult.rows[0];

    if (listing.seller_id !== input.userId) {
      throw new TradeServiceError("Only the seller can cancel this listing.", 403, "LISTING_FORBIDDEN", {
        listingId: input.listingId
      });
    }

    if (listing.status !== "active") {
      throw new TradeServiceError("Listing is not active.", 409, "LISTING_NOT_ACTIVE", {
        listingId: input.listingId
      });
    }

    const cardResult = await client.query<{ id: string; state: string }>(
      `SELECT id, state
       FROM cards
       WHERE id = $1
         AND owner_id = $2
       FOR UPDATE`,
      [listing.card_id, input.userId]
    );

    if (cardResult.rowCount !== 1) {
      throw new TradeServiceError("Listing card could not be validated.", 409, "LISTING_CARD_MISSING", {
        listingId: input.listingId
      });
    }

    await client.query(
      `UPDATE listings
       SET status = 'cancelled'
       WHERE id = $1`,
      [input.listingId]
    );

    await client.query(
      `UPDATE cards
       SET state = 'owned'
       WHERE id = $1`,
      [listing.card_id]
    );
  });

  const listing = await withTransaction(async (client) => {
    const loaded = await fetchListingByIdForView(client, input.listingId);
    if (!loaded) {
      throw new TradeServiceError("Listing not found after cancellation.", 500, "LISTING_MISSING");
    }
    return loaded;
  });

  await maybeEmitMarketplaceEvent("listing_cancelled", {
    listingId: listing.id,
    cardId: listing.cardId,
    sellerId: listing.sellerId
  });

  return { listing };
}

export async function buyListing(input: {
  buyerId: string;
  listingId: string;
}): Promise<BuyListingResult> {
  const result = await withTransaction(async (client) => {
    const candidateResult = await client.query<ListingLockRow>(
      `SELECT id, card_id, seller_id, price, status
       FROM listings
       WHERE id = $1
         AND status = 'active'`,
      [input.listingId]
    );

    if (candidateResult.rowCount !== 1) {
      throw new TradeServiceError("Listing is not active.", 409, "LISTING_NOT_ACTIVE", { listingId: input.listingId });
    }

    const candidate = candidateResult.rows[0];
    const sellerId = candidate.seller_id;
    const price = Number(candidate.price);

    if (sellerId === input.buyerId) {
      throw new TradeServiceError("Cannot buy your own listing.", 409, "SELF_PURCHASE_NOT_ALLOWED", {
        listingId: input.listingId
      });
    }

    const sortedUserIds = [input.buyerId, sellerId].sort();
    const usersResult = await client.query<{ id: string; balance: string }>(
      `SELECT id, balance
       FROM users
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [sortedUserIds]
    );

    if (usersResult.rowCount !== 2) {
      throw new TradeServiceError("Buyer or seller was not found.", 404, "USER_NOT_FOUND");
    }

    const balances = new Map(usersResult.rows.map((row) => [row.id, Number(row.balance)]));
    const buyerBalance = balances.get(input.buyerId) ?? 0;
    const sellerBalance = balances.get(sellerId) ?? 0;

    const buyerHolds = await client.query<{ held: string }>(
      `SELECT COALESCE(SUM(amount), 0)::BIGINT AS held
       FROM balance_holds
       WHERE user_id = $1
         AND status = 'active'`,
      [input.buyerId]
    );

    const held = Number(buyerHolds.rows[0]?.held ?? 0);
    const available = buyerBalance - held;

    if (available < price) {
      throw new TradeServiceError("Insufficient available balance.", 409, "INSUFFICIENT_BALANCE", {
        availableBalance: available,
        price
      });
    }

    const cardResult = await client.query<{ id: string; owner_id: string; state: string }>(
      `SELECT id, owner_id, state
       FROM cards
       WHERE id = $1
         AND state = 'listed'
       FOR UPDATE`,
      [candidate.card_id]
    );

    if (cardResult.rowCount !== 1 || cardResult.rows[0].owner_id !== sellerId) {
      throw new TradeServiceError("Listing is not active.", 409, "LISTING_NOT_ACTIVE", {
        listingId: input.listingId
      });
    }

    const listingResult = await client.query<ListingLockRow>(
      `SELECT id, card_id, seller_id, price, status
       FROM listings
       WHERE id = $1
         AND status = 'active'
       FOR UPDATE`,
      [input.listingId]
    );

    if (listingResult.rowCount !== 1) {
      throw new TradeServiceError("Listing is not active.", 409, "LISTING_NOT_ACTIVE", {
        listingId: input.listingId
      });
    }

    const listing = listingResult.rows[0];
    if (listing.card_id !== candidate.card_id || listing.seller_id !== sellerId) {
      throw new TradeServiceError("Listing changed while processing purchase.", 409, "LISTING_NOT_ACTIVE", {
        listingId: input.listingId
      });
    }

    const tradeFee = calculateTradingFee(price);
    const buyerNewBalance = buyerBalance - price;
    const sellerBalanceAfterCredit = sellerBalance + price;
    const sellerNewBalance = sellerBalanceAfterCredit - tradeFee;

    await client.query("UPDATE users SET balance = $1 WHERE id = $2", [buyerNewBalance, input.buyerId]);
    await client.query("UPDATE users SET balance = $1 WHERE id = $2", [sellerNewBalance, sellerId]);

    await client.query(
      `UPDATE cards
       SET owner_id = $1,
           state = 'owned',
           acquisition_price = $2
       WHERE id = $3`,
      [input.buyerId, price, listing.card_id]
    );

    await client.query(
      `UPDATE listings
       SET status = 'sold',
           buyer_id = $1,
           sold_at = now()
       WHERE id = $2`,
      [input.buyerId, input.listingId]
    );

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
       VALUES ($1, 'trade_buy', $2, $3, $4)`,
      [input.buyerId, -price, input.listingId, buyerNewBalance]
    );

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
       VALUES ($1, 'trade_sell', $2, $3, $4)`,
      [sellerId, price, input.listingId, sellerBalanceAfterCredit]
    );

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
       VALUES ($1, 'trade_fee', $2, $3, $4)`,
      [sellerId, -tradeFee, input.listingId, sellerNewBalance]
    );

    await client.query(
      `INSERT INTO platform_revenue (type, amount, reference_id)
       VALUES ('trade_fee', $1, $2)`,
      [tradeFee, input.listingId]
    );

    return {
      feeCharged: tradeFee,
      buyerNewBalance,
      sellerNewBalance
    };
  });

  const listing = await withTransaction(async (client) => {
    const loaded = await fetchListingByIdForView(client, input.listingId);
    if (!loaded) {
      throw new TradeServiceError("Listing not found after purchase.", 500, "LISTING_MISSING");
    }
    return loaded;
  });

  await maybeEmitMarketplaceEvent("listing_sold", {
    listingId: listing.id,
    cardId: listing.cardId,
    sellerId: listing.sellerId,
    buyerId: listing.buyerId,
    price: listing.price,
    soldAt: listing.soldAt
  });

  return {
    listing,
    ...result
  };
}
