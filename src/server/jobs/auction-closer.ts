import { AUCTION_CLOSER_INTERVAL_MS } from "../config/constants";
import { withTransaction } from "../db/pool";
import {
  calculateAuctionFee,
  emitAuctionRealtimeEvent,
  emitBalanceUpdateRealtime
} from "../services/auction.service";
import type { JobStopper } from "./price-poller";

async function waitForTickDrain(isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

type ClaimedAuctionRow = {
  id: string;
  card_id: string;
  seller_id: string;
  current_bid: string | null;
  current_bidder_id: string | null;
};

type SettlementOutcome = {
  auctionId: string;
  cardId: string;
  sellerId: string;
  winnerId: string | null;
  winningBid: number | null;
  feeCharged: number;
};

class AuctionCloserError extends Error {}

async function emitAuctionEnded(outcome: SettlementOutcome): Promise<void> {
  await emitAuctionRealtimeEvent(outcome.auctionId, "auction_ended", {
    auctionId: outcome.auctionId,
    cardId: outcome.cardId,
    sellerId: outcome.sellerId,
    winnerId: outcome.winnerId,
    winningBid: outcome.winningBid,
    feeCharged: outcome.feeCharged,
    endedAt: new Date().toISOString()
  });
}

async function claimNextAuction(client: {
  query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
}): Promise<ClaimedAuctionRow | null> {
  const result = await client.query<ClaimedAuctionRow>(
    `SELECT id, card_id, seller_id, current_bid, current_bidder_id
     FROM auctions
     WHERE status = 'active'
       AND ends_at <= now()
     ORDER BY ends_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return result.rows[0];
}

async function settleNoBidAuction(
  client: {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
  },
  auction: ClaimedAuctionRow
): Promise<SettlementOutcome> {
  const cardResult = await client.query<{ id: string; owner_id: string; state: string }>(
    `SELECT id, owner_id, state
     FROM cards
     WHERE id = $1
     FOR UPDATE`,
    [auction.card_id]
  );

  if (cardResult.rowCount !== 1) {
    throw new AuctionCloserError(`Auction ${auction.id} card not found during no-bid settlement.`);
  }

  const card = cardResult.rows[0];
  if (card.state !== "in_auction") {
    const cancelResult = await client.query(
      `UPDATE auctions
       SET status = 'cancelled'
       WHERE id = $1
         AND status = 'active'`,
      [auction.id]
    );

    if (cancelResult.rowCount !== 1) {
      throw new AuctionCloserError(`Auction ${auction.id} stale-state recovery failed.`);
    }

    console.warn(
      `[auction-closer] Recovered stale no-bid auction ${auction.id}: card state=${card.state}, owner=${card.owner_id}; marked cancelled.`
    );

    return {
      auctionId: auction.id,
      cardId: auction.card_id,
      sellerId: auction.seller_id,
      winnerId: null,
      winningBid: null,
      feeCharged: 0
    };
  }

  await client.query(
    `UPDATE cards
     SET owner_id = $1,
         state = 'owned'
     WHERE id = $2`,
    [auction.seller_id, auction.card_id]
  );

  await client.query(
    `UPDATE auctions
     SET status = 'completed'
     WHERE id = $1`,
    [auction.id]
  );

  return {
    auctionId: auction.id,
    cardId: auction.card_id,
    sellerId: auction.seller_id,
    winnerId: null,
    winningBid: null,
    feeCharged: 0
  };
}

async function settleWinningAuction(
  client: {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
  },
  auction: ClaimedAuctionRow
): Promise<SettlementOutcome> {
  if (!auction.current_bid || !auction.current_bidder_id) {
    throw new AuctionCloserError(`Auction ${auction.id} has inconsistent winner state.`);
  }

  const buyerId = auction.current_bidder_id;
  const sellerId = auction.seller_id;
  const winningBid = Number(auction.current_bid);

  const sortedUserIds = [buyerId, sellerId].sort();
  const usersResult = await client.query<{ id: string; balance: string }>(
    `SELECT id, balance
     FROM users
     WHERE id = ANY($1::uuid[])
     ORDER BY id ASC
     FOR UPDATE`,
    [sortedUserIds]
  );

  if (usersResult.rowCount !== 2) {
    throw new AuctionCloserError(`Auction ${auction.id} settlement users not found.`);
  }

  const balances = new Map(usersResult.rows.map((row) => [row.id, Number(row.balance)]));
  const buyerBalance = balances.get(buyerId) ?? 0;
  const sellerBalance = balances.get(sellerId) ?? 0;

  const cardResult = await client.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id
     FROM cards
     WHERE id = $1
       AND state = 'in_auction'
     FOR UPDATE`,
    [auction.card_id]
  );

  if (cardResult.rowCount !== 1 || cardResult.rows[0].owner_id !== sellerId) {
    throw new AuctionCloserError(`Auction ${auction.id} card ownership/state invalid at settlement.`);
  }

  const holdResult = await client.query<{ id: string; user_id: string; amount: string }>(
    `SELECT id, user_id, amount
     FROM balance_holds
     WHERE auction_id = $1
       AND status = 'active'
     FOR UPDATE`,
    [auction.id]
  );

  if (holdResult.rowCount !== 1 || holdResult.rows[0].user_id !== buyerId) {
    throw new AuctionCloserError(`Auction ${auction.id} active hold missing or mismatched.`);
  }

  const holdAmount = Number(holdResult.rows[0].amount);
  if (holdAmount < winningBid) {
    throw new AuctionCloserError(`Auction ${auction.id} hold amount is below winning bid.`);
  }

  const buyerNewBalance = buyerBalance - winningBid;
  if (buyerNewBalance < 0) {
    throw new AuctionCloserError(`Auction ${auction.id} buyer balance would go negative.`);
  }

  const feeCharged = calculateAuctionFee(winningBid);
  const sellerBalanceAfterCredit = sellerBalance + winningBid;
  const sellerNewBalance = sellerBalanceAfterCredit - feeCharged;

  await client.query("UPDATE users SET balance = $1 WHERE id = $2", [buyerNewBalance, buyerId]);
  await client.query("UPDATE users SET balance = $1 WHERE id = $2", [sellerNewBalance, sellerId]);

  await client.query(
    `UPDATE balance_holds
     SET status = 'captured'
     WHERE id = $1`,
    [holdResult.rows[0].id]
  );

  await client.query(
    `UPDATE cards
     SET owner_id = $1,
         state = 'owned',
         acquisition_price = $2
     WHERE id = $3`,
    [buyerId, winningBid, auction.card_id]
  );

  await client.query(
    `UPDATE auctions
     SET status = 'completed'
     WHERE id = $1`,
    [auction.id]
  );

  await client.query(
    `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
     VALUES ($1, 'auction_win', $2, $3, $4)`,
    [buyerId, -winningBid, auction.id, buyerNewBalance]
  );

  await client.query(
    `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
     VALUES ($1, 'auction_sell', $2, $3, $4)`,
    [sellerId, winningBid, auction.id, sellerBalanceAfterCredit]
  );

  await client.query(
    `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
     VALUES ($1, 'auction_fee', $2, $3, $4)`,
    [sellerId, -feeCharged, auction.id, sellerNewBalance]
  );

  await client.query(
    `INSERT INTO platform_revenue (type, amount, reference_id)
     VALUES ('auction_fee', $1, $2)`,
    [feeCharged, auction.id]
  );

  return {
    auctionId: auction.id,
    cardId: auction.card_id,
    sellerId,
    winnerId: buyerId,
    winningBid,
    feeCharged
  };
}

async function settleClaimedAuction(
  client: {
    query: <T>(text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: T[] }>;
  },
  auction: ClaimedAuctionRow
): Promise<SettlementOutcome> {
  if (!auction.current_bid || !auction.current_bidder_id) {
    return settleNoBidAuction(client, auction);
  }

  return settleWinningAuction(client, auction);
}

async function resolveNextAuction(): Promise<SettlementOutcome | null> {
  return withTransaction(async (client) => {
    const claimed = await claimNextAuction(client);
    if (!claimed) {
      return null;
    }

    return settleClaimedAuction(client, claimed);
  });
}

async function runCloserTick(): Promise<void> {
  let processed = 0;

  while (true) {
    const outcome = await resolveNextAuction();
    if (!outcome) {
      break;
    }

    processed += 1;
    await emitAuctionEnded(outcome);

    if (outcome.winnerId) {
      await Promise.allSettled([
        emitBalanceUpdateRealtime(outcome.winnerId, {
          reason: "auction_settlement",
          referenceId: outcome.auctionId
        }),
        emitBalanceUpdateRealtime(outcome.sellerId, {
          reason: "auction_settlement",
          referenceId: outcome.auctionId
        })
      ]);
    }
  }

  if (processed > 0) {
    console.log(`[auction-closer] Settled ${processed} auction(s).`);
  }
}

export function startAuctionCloser(): JobStopper {
  let running = false;

  const executeTick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;

    try {
      await runCloserTick();
    } catch (error) {
      console.error("[auction-closer] Tick failed:", error);
    } finally {
      running = false;
    }
  };

  void executeTick();

  const timer = setInterval(() => {
    void executeTick();
  }, AUCTION_CLOSER_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
    await waitForTickDrain(() => running);
  };
}
