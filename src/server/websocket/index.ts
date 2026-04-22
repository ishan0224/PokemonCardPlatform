import type { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { setIO } from "./io";
import { authenticateSocketIfPresent } from "../middleware/auth";
import {
  canUseRedisAdapterPubSub,
  canUseRedisPubSub,
  getRedisAdapterPubSubClients,
  subscribe
} from "../redis/client";
import {
  AUCTION_EVENTS_CHANNEL,
  BALANCE_EVENTS_CHANNEL,
  MARKETPLACE_EVENTS_CHANNEL,
  PRICE_UPDATES_CHANNEL,
  PRICE_UPDATES_LEGACY_CHANNEL
} from "../config/constants";
import { PRICE_UPDATE_EVENT, type PriceUpdateEvent } from "../../lib/realtime/price-update";
import { canJoinPrivateRoom, isPublicRoom, roomNames } from "./rooms";
import { emitAuctionListEventWithCoalescing, type AuctionListRealtimeEventName } from "./auctions-list-coalescer";
import { recordAuctionWatcherSample } from "../services/auction-watcher-metrics.service";

type MarketplaceRealtimeEventName = "new_listing" | "listing_sold" | "listing_cancelled";
type MarketplaceRealtimeEnvelope = {
  event: MarketplaceRealtimeEventName;
  payload: Record<string, unknown>;
};
type AuctionRealtimeEventName =
  | "new_bid"
  | "time_extended"
  | "auction_ended"
  | "auction_created"
  | "auction_updated";
type AuctionRealtimeEnvelope = {
  event: AuctionRealtimeEventName;
  payload: Record<string, unknown>;
};
type BalanceRealtimeEventName = "balance_update";
type BalanceRealtimeEnvelope = {
  event: BalanceRealtimeEventName;
  payload: {
    userId?: string;
  } & Record<string, unknown>;
};
type PriceRealtimeEventName = typeof PRICE_UPDATE_EVENT;
type PriceRealtimeEnvelope = {
  event: PriceRealtimeEventName;
  payload: PriceUpdateEvent;
};

const MARKETPLACE_EVENTS = new Set<MarketplaceRealtimeEventName>([
  "new_listing",
  "listing_sold",
  "listing_cancelled"
]);
const AUCTION_EVENTS = new Set<AuctionRealtimeEventName>([
  "new_bid",
  "time_extended",
  "auction_ended",
  "auction_created",
  "auction_updated"
]);
const AUCTIONS_LIST_EVENTS = new Set<AuctionListRealtimeEventName>(["auction_created", "auction_updated", "auction_ended"]);
const BALANCE_EVENTS = new Set<BalanceRealtimeEventName>(["balance_update"]);
const PRICE_EVENTS = new Set<PriceRealtimeEventName>([PRICE_UPDATE_EVENT]);

let marketplaceRelayReady = false;
let auctionRelayReady = false;
let balanceRelayReady = false;
let priceRelayReady = false;
const PRICE_MESSAGE_DEDUP_WINDOW_MS = 5_000;
const recentPriceRelayMessages = new Map<string, number>();

function getAuctionIdFromRoom(room: string): string | null {
  if (!room.startsWith("auction:")) {
    return null;
  }

  const auctionId = room.slice("auction:".length);
  return auctionId.length > 0 ? auctionId : null;
}

function emitAuctionWatcherCount(io: IOServer, room: string): void {
  const auctionId = getAuctionIdFromRoom(room);
  if (!auctionId) {
    return;
  }

  const count = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  io.to(room).emit("watcher_count", { auctionId, count });
  recordAuctionWatcherSample(auctionId, count);
}

async function setupMarketplaceRelay(io: IOServer): Promise<void> {
  if (marketplaceRelayReady) {
    return;
  }

  if (!canUseRedisPubSub()) {
    return;
  }

  marketplaceRelayReady = true;

  try {
    await subscribe(MARKETPLACE_EVENTS_CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message) as MarketplaceRealtimeEnvelope;
        if (!MARKETPLACE_EVENTS.has(parsed.event)) {
          return;
        }

        io.to(roomNames.marketplace()).emit(parsed.event, parsed.payload);
      } catch (error) {
        const typed = error as { message?: string };
        console.warn(`[marketplace-events] Invalid pub/sub message: ${typed.message ?? "unknown error"}`);
      }
    });
  } catch (error) {
    marketplaceRelayReady = false;
    const typed = error as { message?: string };
    console.warn(`[marketplace-events] Failed to subscribe: ${typed.message ?? "unknown error"}`);
  }
}

async function setupAuctionRelay(io: IOServer): Promise<void> {
  if (auctionRelayReady) {
    return;
  }

  if (!canUseRedisPubSub()) {
    return;
  }

  auctionRelayReady = true;

  try {
    await subscribe(AUCTION_EVENTS_CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message) as AuctionRealtimeEnvelope;
        if (!AUCTION_EVENTS.has(parsed.event)) {
          return;
        }

        const auctionId = typeof parsed.payload.auctionId === "string" ? parsed.payload.auctionId : null;
        if (!auctionId) {
          return;
        }

        if (parsed.event === "auction_created" || parsed.event === "auction_updated") {
          if (AUCTIONS_LIST_EVENTS.has(parsed.event)) {
            emitAuctionListEventWithCoalescing(io, parsed.event, parsed.payload);
          }
          return;
        }

        if (parsed.event === "auction_ended") {
          io.to(roomNames.auction(auctionId)).emit(parsed.event, parsed.payload);
          emitAuctionListEventWithCoalescing(io, parsed.event, parsed.payload);
          return;
        }

        io.to(roomNames.auction(auctionId)).emit(parsed.event, parsed.payload);
      } catch (error) {
        const typed = error as { message?: string };
        console.warn(`[auction-events] Invalid pub/sub message: ${typed.message ?? "unknown error"}`);
      }
    });
  } catch (error) {
    auctionRelayReady = false;
    const typed = error as { message?: string };
    console.warn(`[auction-events] Failed to subscribe: ${typed.message ?? "unknown error"}`);
  }
}

async function setupBalanceRelay(io: IOServer): Promise<void> {
  if (balanceRelayReady) {
    return;
  }

  if (!canUseRedisPubSub()) {
    return;
  }

  balanceRelayReady = true;

  try {
    await subscribe(BALANCE_EVENTS_CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message) as BalanceRealtimeEnvelope;
        if (!BALANCE_EVENTS.has(parsed.event)) {
          return;
        }

        const userId = typeof parsed.payload.userId === "string" ? parsed.payload.userId : null;
        if (!userId) {
          return;
        }

        io.to(roomNames.portfolio(userId)).emit(parsed.event, parsed.payload);
      } catch (error) {
        const typed = error as { message?: string };
        console.warn(`[balance-events] Invalid pub/sub message: ${typed.message ?? "unknown error"}`);
      }
    });
  } catch (error) {
    balanceRelayReady = false;
    const typed = error as { message?: string };
    console.warn(`[balance-events] Failed to subscribe: ${typed.message ?? "unknown error"}`);
  }
}

async function setupPriceRelay(io: IOServer): Promise<void> {
  if (priceRelayReady) {
    return;
  }

  if (!canUseRedisPubSub()) {
    return;
  }

  priceRelayReady = true;

  const attachSubscriber = async (channel: string): Promise<void> => {
    await subscribe(channel, (message) => {
      try {
        const now = Date.now();
        for (const [key, seenAt] of recentPriceRelayMessages.entries()) {
          if (now - seenAt > PRICE_MESSAGE_DEDUP_WINDOW_MS) {
            recentPriceRelayMessages.delete(key);
          }
        }

        if (recentPriceRelayMessages.has(message)) {
          return;
        }

        recentPriceRelayMessages.set(message, now);

        const parsed = JSON.parse(message) as PriceRealtimeEnvelope;
        if (!PRICE_EVENTS.has(parsed.event)) {
          return;
        }

        const userId = typeof parsed.payload.userId === "string" ? parsed.payload.userId : null;
        if (!userId) {
          return;
        }

        io.to(roomNames.portfolio(userId)).emit(parsed.event, parsed.payload);
      } catch (error) {
        const typed = error as { message?: string };
        console.warn(`[price-events] Invalid pub/sub message: ${typed.message ?? "unknown error"}`);
      }
    });
  };

  try {
    const subscriptionResults = await Promise.allSettled([
      attachSubscriber(PRICE_UPDATES_CHANNEL),
      attachSubscriber(PRICE_UPDATES_LEGACY_CHANNEL)
    ]);

    if (subscriptionResults.every((result) => result.status === "rejected")) {
      throw new Error("Failed to subscribe to both price update channels.");
    }
  } catch (error) {
    priceRelayReady = false;
    const typed = error as { message?: string };
    console.warn(`[price-events] Failed to subscribe: ${typed.message ?? "unknown error"}`);
  }
}

export function createSocketServer(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      credentials: true
    }
  });

  if (canUseRedisAdapterPubSub()) {
    const { pubClient, subClient } = getRedisAdapterPubSubClients();
    io.adapter(createAdapter(pubClient, subClient));
  } else {
    console.warn("Redis pub/sub is not configured. Socket.io will run without Redis adapter.");
  }

  void setupMarketplaceRelay(io);
  void setupAuctionRelay(io);
  void setupBalanceRelay(io);
  void setupPriceRelay(io);

  io.use((socket, next) => {
    void (async () => {
      await authenticateSocketIfPresent(socket);
      next();
    })();
  });

  io.on("connection", (socket) => {
    if (socket.data.role === "admin") {
      socket.join(roomNames.adminMetrics());
    }

    socket.on("join-room", (room: string) => {
      if (typeof room !== "string" || room.length === 0) {
        return;
      }

      const userId =
        typeof socket.data.userId === "string" && socket.data.userId.length > 0
          ? socket.data.userId
          : null;
      const userRole =
        socket.data.role === "admin" || socket.data.role === "user"
          ? (socket.data.role as "admin" | "user")
          : null;

      if (isPublicRoom(room) || canJoinPrivateRoom(room, userId, userRole)) {
        socket.join(room);
        return;
      }

      socket.emit("room_join_denied", { room });
    });

    socket.on("leave-room", (room: string) => {
      if (typeof room === "string" && room.length > 0) {
        socket.leave(room);
      }
    });

    socket.on("ping", () => {
      socket.emit("pong", { ts: Date.now() });
    });
  });

  io.of("/").adapter.on("join-room", (room: string) => {
    emitAuctionWatcherCount(io, room);
  });

  io.of("/").adapter.on("leave-room", (room: string) => {
    emitAuctionWatcherCount(io, room);
  });

  setIO(io);
  return io;
}
