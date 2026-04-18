import type { Server as IOServer } from "socket.io";
import {
  AUCTIONS_LIST_COALESCING_ENABLED,
  AUCTIONS_LIST_COALESCE_MAX_BUFFER,
  AUCTIONS_LIST_COALESCE_WINDOW_MS
} from "../config/constants";
import { roomNames } from "./rooms";

export type AuctionListRealtimeEventName = "auction_created" | "auction_updated" | "auction_ended";

type CoalescedAuctionEvent = {
  auctionId: string;
  event: AuctionListRealtimeEventName;
  payload: Record<string, unknown>;
  priority: number;
  sequence: number;
};

const pendingByAuctionId = new Map<string, CoalescedAuctionEvent>();
const EVENT_PRIORITY: Record<AuctionListRealtimeEventName, number> = {
  auction_created: 1,
  auction_updated: 1,
  auction_ended: 2
};

let flushTimer: NodeJS.Timeout | null = null;
let flushSequence = 0;
let flushing = false;

function resolveAuctionId(payload: Record<string, unknown>): string | null {
  const auctionId = payload.auctionId;
  return typeof auctionId === "string" && auctionId.length > 0 ? auctionId : null;
}

function emitAuctionListEventImmediate(
  io: IOServer,
  event: AuctionListRealtimeEventName,
  payload: Record<string, unknown>
): void {
  io.to(roomNames.auctions()).emit(event, payload);
}

function scheduleFlush(io: IOServer): void {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAuctionListEvents(io);
  }, AUCTIONS_LIST_COALESCE_WINDOW_MS);
}

function mergeAuctionListEvent(event: AuctionListRealtimeEventName, payload: Record<string, unknown>): boolean {
  const auctionId = resolveAuctionId(payload);
  if (!auctionId) {
    return false;
  }

  const nextPriority = EVENT_PRIORITY[event];
  const existing = pendingByAuctionId.get(auctionId);
  const next: CoalescedAuctionEvent = {
    auctionId,
    event,
    payload,
    priority: nextPriority,
    sequence: flushSequence++
  };

  if (!existing || nextPriority > existing.priority || nextPriority === existing.priority) {
    pendingByAuctionId.set(auctionId, next);
  }

  return true;
}

function flushAuctionListEvents(io: IOServer): void {
  if (flushing || pendingByAuctionId.size === 0) {
    return;
  }

  flushing = true;
  const pending = Array.from(pendingByAuctionId.values());
  pendingByAuctionId.clear();

  try {
    pending
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }
        return left.sequence - right.sequence;
      })
      .forEach((entry) => {
        emitAuctionListEventImmediate(io, entry.event, entry.payload);
      });
  } finally {
    flushing = false;
  }
}

export function emitAuctionListEventWithCoalescing(
  io: IOServer,
  event: AuctionListRealtimeEventName,
  payload: Record<string, unknown>
): void {
  if (!AUCTIONS_LIST_COALESCING_ENABLED) {
    emitAuctionListEventImmediate(io, event, payload);
    return;
  }

  try {
    const merged = mergeAuctionListEvent(event, payload);
    if (!merged) {
      emitAuctionListEventImmediate(io, event, payload);
      return;
    }

    if (pendingByAuctionId.size >= AUCTIONS_LIST_COALESCE_MAX_BUFFER) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushAuctionListEvents(io);
      return;
    }

    scheduleFlush(io);
  } catch (error) {
    const typed = error as { message?: string };
    console.warn(`[auction-events] List coalescer fallback to immediate emit: ${typed.message ?? "unknown error"}`);
    emitAuctionListEventImmediate(io, event, payload);
  }
}

export async function flushAuctionsListCoalescer(io?: IOServer): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (!io || pendingByAuctionId.size === 0) {
    pendingByAuctionId.clear();
    return;
  }

  flushAuctionListEvents(io);
}
