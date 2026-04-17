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
import { MARKETPLACE_EVENTS_CHANNEL } from "../config/constants";
import { canJoinPrivateRoom, isPublicRoom, roomNames } from "./rooms";

type MarketplaceRealtimeEventName = "new_listing" | "listing_sold" | "listing_cancelled";
type MarketplaceRealtimeEnvelope = {
  event: MarketplaceRealtimeEventName;
  payload: Record<string, unknown>;
};

const MARKETPLACE_EVENTS = new Set<MarketplaceRealtimeEventName>([
  "new_listing",
  "listing_sold",
  "listing_cancelled"
]);

let marketplaceRelayReady = false;

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

  io.use((socket, next) => {
    void (async () => {
      await authenticateSocketIfPresent(socket);
      next();
    })();
  });

  io.on("connection", (socket) => {
    socket.on("join-room", (room: string) => {
      if (typeof room !== "string" || room.length === 0) {
        return;
      }

      const userId =
        typeof socket.data.userId === "string" && socket.data.userId.length > 0
          ? socket.data.userId
          : null;

      if (isPublicRoom(room) || canJoinPrivateRoom(room, userId)) {
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

  setIO(io);
  return io;
}
