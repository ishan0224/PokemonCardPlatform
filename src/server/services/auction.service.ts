import { withTransaction } from "../db/pool";
import {
  ANTI_SNIPE_EXTENSION_SECONDS,
  AUCTION_EVENTS_CHANNEL,
  BALANCE_EVENTS_CHANNEL,
  AUCTION_FEE_BPS,
  MIN_AUCTION_START_BID_CENTS,
  MIN_BID_INCREMENT_BPS,
  MIN_BID_INCREMENT_CENTS
} from "../config/constants";
import { canUseRedisPubSub, publish } from "../redis/client";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";
import {
  emitAuctionListEventWithCoalescing,
  type AuctionListRealtimeEventName
} from "../websocket/auctions-list-coalescer";
import { calculateFeeFromBps } from "../../lib/decimal";
import type { AuctionDurationType, AuctionStatus, RarityTier } from "../../lib/types";

export type AuctionBidView = {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderUsername: string;
  amount: number;
  createdAt: string;
};

export type AuctionCardView = {
  id: string;
  slotNumber: number;
  rarityTier: RarityTier;
  acquisitionPrice: number;
  ownerId: string;
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

export type AuctionView = {
  id: string;
  cardId: string;
  sellerId: string;
  sellerUsername: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderId: string | null;
  currentBidderUsername: string | null;
  endsAt: string;
  originalEndTime: string;
  durationType: AuctionDurationType;
  status: AuctionStatus;
  createdAt: string;
  minNextBid: number;
  card: AuctionCardView;
};

export type AuctionDetailView = AuctionView & {
  bids: AuctionBidView[];
  myActiveHold: number | null;
};

export type ListAuctionsResult = {
  auctions: AuctionView[];
  page: number;
  limit: number;
  total: number;
};

export type CreateAuctionResult = {
  auction: AuctionDetailView;
};

export type PlaceBidResult = {
  auction: AuctionDetailView;
  bid: AuctionBidView;
  timeExtended: boolean;
};

export class AuctionServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 400,
    code = "AUCTION_SERVICE_ERROR",
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type AuctionJoinedRow = {
  auction_id: string;
  card_id: string;
  seller_id: string;
  seller_username: string;
  starting_bid: string;
  current_bid: string | null;
  current_bidder_id: string | null;
  current_bidder_username: string | null;
  ends_at: string;
  original_end_time: string;
  duration_type: AuctionDurationType;
  status: AuctionStatus;
  created_at: string;
  card_slot_number: number;
  card_rarity_tier: RarityTier;
  card_acquisition_price: string;
  card_owner_id: string;
  pokemon_card_id: string;
  pokemon_tcg_id: string;
  pokemon_card_name: string;
  pokemon_set_name: string;
  pokemon_rarity: string;
  pokemon_rarity_tier: RarityTier;
  pokemon_image_url: string | null;
  pokemon_image_url_hires: string | null;
  pokemon_current_price: string;
};

type BidJoinedRow = {
  bid_id: string;
  auction_id: string;
  bidder_id: string;
  bidder_username: string;
  amount: string;
  created_at: string;
};

type AuctionLockRow = {
  id: string;
  card_id: string;
  seller_id: string;
  starting_bid: string;
  current_bid: string | null;
  current_bidder_id: string | null;
  ends_at: string;
  status: AuctionStatus;
};

type BalanceSummaryRow = {
  total: string;
  held: string;
};

type AuctionRealtimeEventName =
  | "new_bid"
  | "time_extended"
  | "auction_ended"
  | "auction_created"
  | "auction_updated";

const AUCTION_DETAIL_ROOM_EVENTS = new Set<AuctionRealtimeEventName>([
  "new_bid",
  "time_extended",
  "auction_ended"
]);
const AUCTIONS_LIST_ROOM_EVENTS = new Set<AuctionRealtimeEventName>([
  "auction_created",
  "auction_updated",
  "auction_ended"
]);

type BalanceRealtimeEventName = "balance_update";
type BalanceUpdatePayload = {
  userId: string;
  total: number;
  held: number;
  available: number;
  updatedAt: string;
  reason?: string;
  referenceId?: string;
};

const DURATION_SECONDS: Record<AuctionDurationType, number> = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60
};

function calculateBidIncrement(currentBid: number): number {
  const percentageIncrement = Math.ceil((currentBid * MIN_BID_INCREMENT_BPS) / 10_000);
  return Math.max(MIN_BID_INCREMENT_CENTS, percentageIncrement);
}

function calculateMinNextBid(startingBid: number, currentBid: number | null): number {
  if (currentBid === null) {
    return startingBid;
  }

  return currentBid + calculateBidIncrement(currentBid);
}

function mapAuctionJoinedRow(row: AuctionJoinedRow): AuctionView {
  const startingBid = Number(row.starting_bid);
  const currentBid = row.current_bid === null ? null : Number(row.current_bid);

  return {
    id: row.auction_id,
    cardId: row.card_id,
    sellerId: row.seller_id,
    sellerUsername: row.seller_username,
    startingBid,
    currentBid,
    currentBidderId: row.current_bidder_id,
    currentBidderUsername: row.current_bidder_username,
    endsAt: row.ends_at,
    originalEndTime: row.original_end_time,
    durationType: row.duration_type,
    status: row.status,
    createdAt: row.created_at,
    minNextBid: calculateMinNextBid(startingBid, currentBid),
    card: {
      id: row.card_id,
      slotNumber: row.card_slot_number,
      rarityTier: row.card_rarity_tier,
      acquisitionPrice: Number(row.card_acquisition_price),
      ownerId: row.card_owner_id,
      pokemonCard: {
        id: row.pokemon_card_id,
        tcgId: row.pokemon_tcg_id,
        name: row.pokemon_card_name,
        setName: row.pokemon_set_name,
        rarity: row.pokemon_rarity,
        rarityTier: row.pokemon_rarity_tier,
        imageUrl: row.pokemon_image_url,
        imageUrlHires: row.pokemon_image_url_hires,
        currentPrice: Number(row.pokemon_current_price)
      }
    }
  };
}

function mapBidJoinedRow(row: BidJoinedRow): AuctionBidView {
  return {
    id: row.bid_id,
    auctionId: row.auction_id,
    bidderId: row.bidder_id,
    bidderUsername: row.bidder_username,
    amount: Number(row.amount),
    createdAt: row.created_at
  };
}

function toAuctionView(detail: AuctionDetailView): AuctionView {
  const { bids: _bids, myActiveHold: _myActiveHold, ...auctionView } = detail;
  return auctionView;
}

async function emitAuctionEventViaSocket(
  auctionId: string,
  event: AuctionRealtimeEventName,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const io = getIO();

    if (AUCTION_DETAIL_ROOM_EVENTS.has(event)) {
      io.to(roomNames.auction(auctionId)).emit(event, payload);
    }

    if (AUCTIONS_LIST_ROOM_EVENTS.has(event)) {
      emitAuctionListEventWithCoalescing(io, event as AuctionListRealtimeEventName, payload);
    }
  } catch (_error) {
    // Socket server may be unavailable in script/test contexts.
  }
}

async function emitBalanceEventViaSocket(
  event: BalanceRealtimeEventName,
  payload: BalanceUpdatePayload
): Promise<void> {
  try {
    const io = getIO();
    io.to(roomNames.portfolio(payload.userId)).emit(event, payload);
  } catch (_error) {
    // Socket server may be unavailable in script/test contexts.
  }
}

export async function emitAuctionRealtimeEvent(
  auctionId: string,
  event: AuctionRealtimeEventName,
  payload: Record<string, unknown>
): Promise<void> {
  const message = JSON.stringify({ event, payload });

  if (canUseRedisPubSub()) {
    try {
      await publish(AUCTION_EVENTS_CHANNEL, message);
      return;
    } catch (error) {
      const typed = error as { message?: string };
      console.warn(`[auction-events] Redis publish failed: ${typed.message ?? "unknown error"}`);
      await emitAuctionEventViaSocket(auctionId, event, payload);
      return;
    }
  }

  await emitAuctionEventViaSocket(auctionId, event, payload);
}

async function fetchUserBalanceSummary(userId: string): Promise<BalanceUpdatePayload> {
  const snapshot = await withTransaction(async (client) => {
    const result = await client.query<BalanceSummaryRow>(
      `SELECT u.balance::BIGINT AS total,
              COALESCE(SUM(h.amount), 0)::BIGINT AS held
       FROM users u
       LEFT JOIN balance_holds h
         ON h.user_id = u.id
        AND h.status = 'active'
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId]
    );

    if (result.rowCount !== 1) {
      throw new AuctionServiceError("User not found.", 404, "USER_NOT_FOUND", { userId });
    }

    const total = Number(result.rows[0].total);
    const held = Number(result.rows[0].held);
    return { total, held, available: total - held };
  });

  return {
    userId,
    ...snapshot,
    updatedAt: new Date().toISOString()
  };
}

export async function emitBalanceUpdateRealtime(
  userId: string,
  metadata?: { reason?: string; referenceId?: string }
): Promise<void> {
  let payload: BalanceUpdatePayload;

  try {
    payload = await fetchUserBalanceSummary(userId);
  } catch (error) {
    const typed = error as { message?: string };
    console.warn(`[balance-events] Failed to fetch balance snapshot: ${typed.message ?? "unknown error"}`);
    return;
  }

  if (metadata?.reason) {
    payload.reason = metadata.reason;
  }
  if (metadata?.referenceId) {
    payload.referenceId = metadata.referenceId;
  }

  const event: BalanceRealtimeEventName = "balance_update";
  const message = JSON.stringify({ event, payload });

  if (canUseRedisPubSub()) {
    try {
      await publish(BALANCE_EVENTS_CHANNEL, message);
      return;
    } catch (error) {
      const typed = error as { message?: string };
      console.warn(`[balance-events] Redis publish failed: ${typed.message ?? "unknown error"}`);
      await emitBalanceEventViaSocket(event, payload);
      return;
    }
  }

  await emitBalanceEventViaSocket(event, payload);
}

function dispatchBidRealtimeFanout(input: {
  auctionId: string;
  auction: AuctionDetailView;
  bid: AuctionBidView;
  timeExtended: boolean;
  balanceUserIds: string[];
}): void {
  void (async () => {
    const operations: Promise<unknown>[] = [
      emitAuctionRealtimeEvent(input.auctionId, "new_bid", {
        auctionId: input.auctionId,
        bid: input.bid,
        currentBid: input.auction.currentBid,
        currentBidderId: input.auction.currentBidderId,
        currentBidderUsername: input.auction.currentBidderUsername,
        minNextBid: input.auction.minNextBid,
        endsAt: input.auction.endsAt
      }),
      emitAuctionRealtimeEvent(input.auctionId, "auction_updated", {
        auctionId: input.auctionId,
        auction: toAuctionView(input.auction)
      }),
      ...input.balanceUserIds.map((userId) =>
        emitBalanceUpdateRealtime(userId, {
          reason: "auction_bid_hold_change",
          referenceId: input.auctionId
        })
      )
    ];

    if (input.timeExtended) {
      operations.push(
        emitAuctionRealtimeEvent(input.auctionId, "time_extended", {
          auctionId: input.auctionId,
          endsAt: input.auction.endsAt
        })
      );
    }

    const results = await Promise.allSettled(operations);
    for (const result of results) {
      if (result.status === "rejected") {
        const typed = result.reason as { message?: string };
        console.warn(`[auction-events] Post-bid realtime fanout failed: ${typed?.message ?? "unknown error"}`);
      }
    }
  })();
}

async function fetchAuctionById(
  client: {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
  },
  auctionId: string
): Promise<AuctionView | null> {
  const result = await client.query<AuctionJoinedRow>(
    `SELECT a.id AS auction_id,
            a.card_id,
            a.seller_id,
            seller.username AS seller_username,
            a.starting_bid,
            a.current_bid,
            a.current_bidder_id,
            current_bidder.username AS current_bidder_username,
            a.ends_at,
            a.original_end_time,
            a.duration_type,
            a.status,
            a.created_at,
            c.slot_number AS card_slot_number,
            c.rarity_tier AS card_rarity_tier,
            c.acquisition_price AS card_acquisition_price,
            c.owner_id AS card_owner_id,
            pc.id AS pokemon_card_id,
            pc.tcg_id AS pokemon_tcg_id,
            pc.name AS pokemon_card_name,
            pc.set_name AS pokemon_set_name,
            pc.rarity AS pokemon_rarity,
            pc.rarity_tier AS pokemon_rarity_tier,
            pc.image_url AS pokemon_image_url,
            pc.image_url_hires AS pokemon_image_url_hires,
            pc.current_price AS pokemon_current_price
     FROM auctions a
     JOIN cards c ON c.id = a.card_id
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     JOIN users seller ON seller.id = a.seller_id
     LEFT JOIN users current_bidder ON current_bidder.id = a.current_bidder_id
     WHERE a.id = $1`,
    [auctionId]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return mapAuctionJoinedRow(result.rows[0]);
}

async function fetchAuctionBids(
  client: {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
  },
  auctionId: string,
  limit = 100
): Promise<AuctionBidView[]> {
  const result = await client.query<BidJoinedRow>(
    `SELECT b.id AS bid_id,
            b.auction_id,
            b.bidder_id,
            u.username AS bidder_username,
            b.amount,
            b.created_at
     FROM bids b
     JOIN users u ON u.id = b.bidder_id
     WHERE b.auction_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [auctionId, Math.max(Math.trunc(limit), 1)]
  );

  return result.rows.map(mapBidJoinedRow);
}

export async function listActiveAuctions(input: {
  page?: number;
  limit?: number;
}): Promise<ListAuctionsResult> {
  const page = Math.max(Math.trunc(input.page ?? 1), 1);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 24), 1), 100);
  const offset = (page - 1) * limit;

  return withTransaction(async (client) => {
    const totalResult = await client.query<{ total: string }>(
      "SELECT COUNT(*)::BIGINT AS total FROM auctions WHERE status = 'active'"
    );

    const result = await client.query<AuctionJoinedRow>(
      `SELECT a.id AS auction_id,
              a.card_id,
              a.seller_id,
              seller.username AS seller_username,
              a.starting_bid,
              a.current_bid,
              a.current_bidder_id,
              current_bidder.username AS current_bidder_username,
              a.ends_at,
              a.original_end_time,
              a.duration_type,
              a.status,
              a.created_at,
              c.slot_number AS card_slot_number,
              c.rarity_tier AS card_rarity_tier,
              c.acquisition_price AS card_acquisition_price,
              c.owner_id AS card_owner_id,
              pc.id AS pokemon_card_id,
              pc.tcg_id AS pokemon_tcg_id,
              pc.name AS pokemon_card_name,
              pc.set_name AS pokemon_set_name,
              pc.rarity AS pokemon_rarity,
              pc.rarity_tier AS pokemon_rarity_tier,
              pc.image_url AS pokemon_image_url,
              pc.image_url_hires AS pokemon_image_url_hires,
              pc.current_price AS pokemon_current_price
       FROM auctions a
       JOIN cards c ON c.id = a.card_id
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       JOIN users seller ON seller.id = a.seller_id
       LEFT JOIN users current_bidder ON current_bidder.id = a.current_bidder_id
       WHERE a.status = 'active'
       ORDER BY a.ends_at ASC, a.created_at DESC
       LIMIT $1
       OFFSET $2`,
      [limit, offset]
    );

    return {
      auctions: result.rows.map(mapAuctionJoinedRow),
      page,
      limit,
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  });
}

export async function getAuctionDetail(input: {
  auctionId: string;
  viewerUserId?: string | null;
}): Promise<AuctionDetailView> {
  return withTransaction(async (client) => {
    const auction = await fetchAuctionById(client, input.auctionId);

    if (!auction) {
      throw new AuctionServiceError("Auction not found.", 404, "AUCTION_NOT_FOUND", {
        auctionId: input.auctionId
      });
    }

    const bids = await fetchAuctionBids(client, input.auctionId);
    let myActiveHold: number | null = null;

    if (input.viewerUserId) {
      const holdResult = await client.query<{ amount: string }>(
        `SELECT amount
         FROM balance_holds
         WHERE auction_id = $1
           AND user_id = $2
           AND status = 'active'
         LIMIT 1`,
        [input.auctionId, input.viewerUserId]
      );

      if (holdResult.rowCount === 1) {
        myActiveHold = Number(holdResult.rows[0].amount);
      }
    }

    return {
      ...auction,
      bids,
      myActiveHold
    };
  });
}

export async function createAuction(input: {
  sellerId: string;
  cardId: string;
  startingBid: number;
  durationType: AuctionDurationType;
}): Promise<CreateAuctionResult> {
  const startingBid = Math.trunc(input.startingBid);
  const durationSeconds = DURATION_SECONDS[input.durationType];

  if (!durationSeconds) {
    throw new AuctionServiceError("Auction duration type is invalid.", 400, "INVALID_AUCTION_DURATION");
  }

  if (!Number.isFinite(startingBid) || startingBid < MIN_AUCTION_START_BID_CENTS) {
    throw new AuctionServiceError("Starting bid must be at least $0.50.", 400, "INVALID_STARTING_BID", {
      minimumStartingBid: MIN_AUCTION_START_BID_CENTS
    });
  }

  const auctionId = await withTransaction(async (client) => {
    const cardResult = await client.query<{ id: string; owner_id: string; state: string }>(
      `SELECT id, owner_id, state
       FROM cards
       WHERE id = $1
       FOR UPDATE`,
      [input.cardId]
    );

    if (cardResult.rowCount !== 1) {
      throw new AuctionServiceError("Card not found.", 404, "CARD_NOT_FOUND", { cardId: input.cardId });
    }

    const card = cardResult.rows[0];

    if (card.owner_id !== input.sellerId) {
      throw new AuctionServiceError("Only the card owner can create an auction.", 403, "NOT_CARD_OWNER", {
        cardId: input.cardId
      });
    }

    if (card.state !== "owned") {
      throw new AuctionServiceError("Card is not in an auctionable state.", 409, "CARD_NOT_AUCTIONABLE", {
        cardId: input.cardId,
        state: card.state
      });
    }

    try {
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO auctions (
          card_id,
          seller_id,
          starting_bid,
          ends_at,
          original_end_time,
          duration_type,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          now() + make_interval(secs => $4),
          now() + make_interval(secs => $4),
          $5,
          'active'
        )
        RETURNING id`,
        [input.cardId, input.sellerId, startingBid, durationSeconds, input.durationType]
      );

      await client.query("UPDATE cards SET state = 'in_auction' WHERE id = $1", [input.cardId]);
      return insertResult.rows[0].id;
    } catch (error) {
      const typed = error as { code?: string };

      if (typed.code === "23505") {
        throw new AuctionServiceError("Card already has an active auction.", 409, "AUCTION_ALREADY_ACTIVE", {
          cardId: input.cardId
        });
      }

      throw error;
    }
  });

  const auction = await getAuctionDetail({
    auctionId,
    viewerUserId: input.sellerId
  });

  await emitAuctionRealtimeEvent(auctionId, "auction_created", {
    auctionId,
    auction: toAuctionView(auction)
  });

  return { auction };
}

export async function placeBid(input: {
  bidderId: string;
  auctionId: string;
  amount: number;
}): Promise<PlaceBidResult> {
  const bidAmount = Math.trunc(input.amount);

  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    throw new AuctionServiceError("Bid amount must be a positive integer (cents).", 400, "INVALID_BID_AMOUNT");
  }

  const result = await withTransaction(async (client) => {
    const auctionResult = await client.query<AuctionLockRow>(
      `SELECT id, card_id, seller_id, starting_bid, current_bid, current_bidder_id, ends_at, status
       FROM auctions
       WHERE id = $1
         AND status = 'active'
       FOR UPDATE`,
      [input.auctionId]
    );

    if (auctionResult.rowCount !== 1) {
      throw new AuctionServiceError("Auction is not active.", 409, "AUCTION_NOT_ACTIVE", {
        auctionId: input.auctionId
      });
    }

    const auction = auctionResult.rows[0];
    const previousEndsAt = auction.ends_at;
    const previousHighestBidderId = auction.current_bidder_id;
    const endsAtMs = new Date(auction.ends_at).getTime();

    if (!Number.isFinite(endsAtMs) || endsAtMs <= Date.now()) {
      throw new AuctionServiceError("Auction has ended.", 409, "AUCTION_ENDED", {
        auctionId: input.auctionId
      });
    }

    if (auction.seller_id === input.bidderId) {
      throw new AuctionServiceError("Cannot bid on your own auction.", 409, "SELF_BID_NOT_ALLOWED", {
        auctionId: input.auctionId
      });
    }

    if (auction.current_bidder_id === input.bidderId) {
      throw new AuctionServiceError("You already hold the highest bid.", 409, "ALREADY_HIGHEST_BIDDER", {
        auctionId: input.auctionId
      });
    }

    const minNextBid = calculateMinNextBid(Number(auction.starting_bid), auction.current_bid ? Number(auction.current_bid) : null);
    if (bidAmount < minNextBid) {
      throw new AuctionServiceError("Bid is below the minimum required amount.", 409, "BID_TOO_LOW", {
        minimumBid: minNextBid
      });
    }

    const bidderResult = await client.query<{ id: string; balance: string }>(
      `SELECT id, balance
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [input.bidderId]
    );

    if (bidderResult.rowCount !== 1) {
      throw new AuctionServiceError("Bidder not found.", 404, "USER_NOT_FOUND");
    }

    const bidderBalance = Number(bidderResult.rows[0].balance);
    const bidderHoldsResult = await client.query<{ held: string }>(
      `SELECT COALESCE(SUM(amount), 0)::BIGINT AS held
       FROM balance_holds
       WHERE user_id = $1
         AND status = 'active'`,
      [input.bidderId]
    );

    const held = Number(bidderHoldsResult.rows[0]?.held ?? 0);
    const available = bidderBalance - held;

    if (available < bidAmount) {
      throw new AuctionServiceError("Insufficient available balance.", 409, "INSUFFICIENT_BALANCE", {
        availableBalance: available,
        bidAmount
      });
    }

    await client.query(
      `UPDATE balance_holds
       SET status = 'released'
       WHERE auction_id = $1
         AND status = 'active'`,
      [input.auctionId]
    );

    await client.query(
      `INSERT INTO balance_holds (user_id, auction_id, amount, status)
       VALUES ($1, $2, $3, 'active')`,
      [input.bidderId, input.auctionId, bidAmount]
    );

    const updatedAuctionResult = await client.query<{ ends_at: string }>(
      `UPDATE auctions
       SET current_bid = $2,
           current_bidder_id = $3,
           ends_at = CASE
             WHEN ends_at <= now() + make_interval(secs => $4)
               THEN now() + make_interval(secs => $4)
             ELSE ends_at
           END
       WHERE id = $1
       RETURNING ends_at`,
      [input.auctionId, bidAmount, input.bidderId, ANTI_SNIPE_EXTENSION_SECONDS]
    );

    const bidResult = await client.query<BidJoinedRow>(
      `INSERT INTO bids (auction_id, bidder_id, amount)
       VALUES ($1, $2, $3)
       RETURNING id AS bid_id,
                 auction_id,
                 bidder_id,
                 (SELECT username FROM users WHERE id = $2) AS bidder_username,
                 amount,
                 created_at`,
      [input.auctionId, input.bidderId, bidAmount]
    );

    return {
      bid: mapBidJoinedRow(bidResult.rows[0]),
      previousHighestBidderId,
      previousEndsAt,
      currentEndsAt: updatedAuctionResult.rows[0].ends_at
    };
  });

  const auction = await getAuctionDetail({
    auctionId: input.auctionId,
    viewerUserId: input.bidderId
  });

  const timeExtended = new Date(result.currentEndsAt).getTime() > new Date(result.previousEndsAt).getTime();

  const balanceUserIds = new Set<string>([input.bidderId]);
  if (result.previousHighestBidderId && result.previousHighestBidderId !== input.bidderId) {
    balanceUserIds.add(result.previousHighestBidderId);
  }

  dispatchBidRealtimeFanout({
    auctionId: input.auctionId,
    auction,
    bid: result.bid,
    timeExtended,
    balanceUserIds: Array.from(balanceUserIds)
  });

  return {
    auction,
    bid: result.bid,
    timeExtended
  };
}

export function getMinimumNextBid(input: { startingBid: number; currentBid: number | null }): number {
  return calculateMinNextBid(input.startingBid, input.currentBid);
}

export function calculateAuctionFee(amount: number): number {
  return calculateFeeFromBps(Math.trunc(amount), AUCTION_FEE_BPS);
}
