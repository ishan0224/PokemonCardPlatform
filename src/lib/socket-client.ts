"use client";

import { io, type Socket } from "socket.io-client";
import type { PackTier } from "./types";
import type { AdminMetricsDeltaEvent } from "./types";
import { PRICE_UPDATE_EVENT } from "./realtime/price-update";
import type { PriceUpdateEntry, PriceUpdateEvent } from "./realtime/price-update";
export type PriceUpdatePatch = PriceUpdateEntry;
export type { PriceUpdateEvent };

export type DropInventoryUpdateEvent = {
  dropId: string;
  tier: PackTier;
  remainingInventory: number;
};

export type DropLifecycleEvent = {
  dropId: string;
};

export type MarketplaceListingEvent = {
  listingId: string;
  cardId: string;
  sellerId: string;
  buyerId?: string | null;
  price?: number;
  createdAt?: string;
  soldAt?: string | null;
};

export type AuctionBidEvent = {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderUsername: string;
  amount: number;
  createdAt: string;
};

export type AuctionNewBidEvent = {
  auctionId: string;
  bid: AuctionBidEvent;
  currentBid: number | null;
  currentBidderId: string | null;
  currentBidderUsername: string | null;
  minNextBid: number;
  endsAt: string;
};

export type AuctionTimeExtendedEvent = {
  auctionId: string;
  endsAt: string;
};

export type AuctionEndedEvent = {
  auctionId: string;
  cardId: string;
  sellerId: string;
  winnerId: string | null;
  winningBid: number | null;
  feeCharged: number;
  endedAt: string;
};

export type AuctionWatcherCountEvent = {
  auctionId: string;
  count: number;
};

export type AuctionsRoomEvent = {
  auctionId: string;
};

export type BalanceUpdateEvent = {
  userId: string;
  total: number;
  held: number;
  available: number;
  updatedAt: string;
  reason?: string;
  referenceId?: string;
};

export type AdminMetricsDeltaRoomEvent = AdminMetricsDeltaEvent;

export type DropRoomHandlers = {
  onInventoryUpdate?: (event: DropInventoryUpdateEvent) => void;
  onSoldOut?: (event: DropInventoryUpdateEvent) => void;
  onDropStarted?: (event: DropLifecycleEvent) => void;
  onDropCompleted?: (event: DropLifecycleEvent) => void;
  onConnected?: () => void;
};

export type MarketplaceRoomHandlers = {
  onListingCreated?: (event: MarketplaceListingEvent) => void;
  onListingSold?: (event: MarketplaceListingEvent) => void;
  onListingCancelled?: (event: MarketplaceListingEvent) => void;
  onConnected?: () => void;
};

export type AuctionRoomHandlers = {
  onNewBid?: (event: AuctionNewBidEvent) => void;
  onTimeExtended?: (event: AuctionTimeExtendedEvent) => void;
  onAuctionEnded?: (event: AuctionEndedEvent) => void;
  onWatcherCount?: (event: AuctionWatcherCountEvent) => void;
  onConnected?: () => void;
};

export type AuctionsRoomHandlers = {
  onAuctionCreated?: (event: AuctionsRoomEvent) => void;
  onAuctionUpdated?: (event: AuctionsRoomEvent) => void;
  onAuctionEnded?: (event: AuctionEndedEvent) => void;
  onConnected?: () => void;
};

export type PortfolioRoomHandlers = {
  onBalanceUpdate?: (event: BalanceUpdateEvent) => void;
  onPriceUpdate?: (event: PriceUpdateEvent) => void;
  onConnected?: () => void;
};

export type AdminMetricsRoomHandlers = {
  onMetricsDelta?: (event: AdminMetricsDeltaRoomEvent) => void;
  onConnected?: () => void;
};

let socketInstance: Socket | null = null;
let activeSubscriptions = 0;

function getSocketUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  }

  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}

function dropRoomName(dropId: string): string {
  return `drop:${dropId}`;
}

function marketplaceRoomName(): string {
  return "marketplace";
}

function auctionRoomName(auctionId: string): string {
  return `auction:${auctionId}`;
}

function auctionsRoomName(): string {
  return "auctions";
}

function portfolioRoomName(userId: string): string {
  return `portfolio:${userId}`;
}

function adminMetricsRoomName(): string {
  return "admin:metrics";
}

function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(getSocketUrl(), {
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 300,
      reconnectionDelayMax: 3000,
      reconnectionAttempts: Infinity
    });
  }

  return socketInstance;
}

export function isSocketConnected(): boolean {
  return socketInstance?.connected ?? false;
}

export function onSocketConnectivityChange(callback: (connected: boolean) => void): () => void {
  const socket = getSocket();
  const onConnect = (): void => callback(true);
  const onDisconnect = (): void => callback(false);
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
  };
}

export function subscribeToDropRoom(dropId: string, handlers: DropRoomHandlers): () => void {
  const socket = getSocket();
  const room = dropRoomName(dropId);

  const onInventoryUpdate = (event: DropInventoryUpdateEvent): void => {
    if (event.dropId === dropId) {
      handlers.onInventoryUpdate?.(event);
    }
  };

  const onSoldOut = (event: DropInventoryUpdateEvent): void => {
    if (event.dropId === dropId) {
      handlers.onSoldOut?.(event);
    }
  };

  const onDropStarted = (event: DropLifecycleEvent): void => {
    if (event.dropId === dropId) {
      handlers.onDropStarted?.(event);
    }
  };

  const onDropCompleted = (event: DropLifecycleEvent): void => {
    if (event.dropId === dropId) {
      handlers.onDropCompleted?.(event);
    }
  };

  const onConnected = (): void => {
    handlers.onConnected?.();
    socket.emit("join-room", room);
  };

  if (!socket.connected) {
    socket.connect();
  }

  activeSubscriptions += 1;
  socket.emit("join-room", room);
  socket.on("connect", onConnected);
  socket.on("inventory_update", onInventoryUpdate);
  socket.on("sold_out", onSoldOut);
  socket.on("drop_started", onDropStarted);
  socket.on("drop_completed", onDropCompleted);

  return () => {
    activeSubscriptions = Math.max(activeSubscriptions - 1, 0);

    socket.off("connect", onConnected);
    socket.off("inventory_update", onInventoryUpdate);
    socket.off("sold_out", onSoldOut);
    socket.off("drop_started", onDropStarted);
    socket.off("drop_completed", onDropCompleted);
    socket.emit("leave-room", room);

    if (activeSubscriptions === 0 && socket.connected) {
      socket.disconnect();
    }
  };
}

export function subscribeToMarketplaceRoom(handlers: MarketplaceRoomHandlers): () => void {
  const socket = getSocket();
  const room = marketplaceRoomName();

  const onListingCreated = (event: MarketplaceListingEvent): void => {
    handlers.onListingCreated?.(event);
  };

  const onListingSold = (event: MarketplaceListingEvent): void => {
    handlers.onListingSold?.(event);
  };

  const onListingCancelled = (event: MarketplaceListingEvent): void => {
    handlers.onListingCancelled?.(event);
  };

  const onConnected = (): void => {
    handlers.onConnected?.();
    socket.emit("join-room", room);
  };

  if (!socket.connected) {
    socket.connect();
  }

  activeSubscriptions += 1;
  socket.emit("join-room", room);
  socket.on("connect", onConnected);
  socket.on("new_listing", onListingCreated);
  socket.on("listing_sold", onListingSold);
  socket.on("listing_cancelled", onListingCancelled);

  return () => {
    activeSubscriptions = Math.max(activeSubscriptions - 1, 0);

    socket.off("connect", onConnected);
    socket.off("new_listing", onListingCreated);
    socket.off("listing_sold", onListingSold);
    socket.off("listing_cancelled", onListingCancelled);
    socket.emit("leave-room", room);

    if (activeSubscriptions === 0 && socket.connected) {
      socket.disconnect();
    }
  };
}

export function subscribeToAuctionRoom(auctionId: string, handlers: AuctionRoomHandlers): () => void {
  const socket = getSocket();
  const room = auctionRoomName(auctionId);

  const onNewBid = (event: AuctionNewBidEvent): void => {
    if (event.auctionId === auctionId) {
      handlers.onNewBid?.(event);
    }
  };

  const onTimeExtended = (event: AuctionTimeExtendedEvent): void => {
    if (event.auctionId === auctionId) {
      handlers.onTimeExtended?.(event);
    }
  };

  const onAuctionEnded = (event: AuctionEndedEvent): void => {
    if (event.auctionId === auctionId) {
      handlers.onAuctionEnded?.(event);
    }
  };

  const onWatcherCount = (event: AuctionWatcherCountEvent): void => {
    if (event.auctionId === auctionId) {
      handlers.onWatcherCount?.(event);
    }
  };

  const onConnected = (): void => {
    handlers.onConnected?.();
    socket.emit("join-room", room);
  };

  if (!socket.connected) {
    socket.connect();
  }

  activeSubscriptions += 1;
  socket.on("connect", onConnected);
  socket.on("new_bid", onNewBid);
  socket.on("time_extended", onTimeExtended);
  socket.on("auction_ended", onAuctionEnded);
  socket.on("watcher_count", onWatcherCount);
  socket.emit("join-room", room);

  return () => {
    activeSubscriptions = Math.max(activeSubscriptions - 1, 0);

    socket.off("connect", onConnected);
    socket.off("new_bid", onNewBid);
    socket.off("time_extended", onTimeExtended);
    socket.off("auction_ended", onAuctionEnded);
    socket.off("watcher_count", onWatcherCount);
    socket.emit("leave-room", room);

    if (activeSubscriptions === 0 && socket.connected) {
      socket.disconnect();
    }
  };
}

export function subscribeToAuctionsRoom(handlers: AuctionsRoomHandlers): () => void {
  const socket = getSocket();
  const room = auctionsRoomName();

  const onAuctionCreated = (event: AuctionsRoomEvent): void => {
    handlers.onAuctionCreated?.(event);
  };

  const onAuctionUpdated = (event: AuctionsRoomEvent): void => {
    handlers.onAuctionUpdated?.(event);
  };

  const onAuctionEnded = (event: AuctionEndedEvent): void => {
    handlers.onAuctionEnded?.(event);
  };

  const onConnected = (): void => {
    handlers.onConnected?.();
    socket.emit("join-room", room);
  };

  if (!socket.connected) {
    socket.connect();
  }

  activeSubscriptions += 1;
  socket.on("connect", onConnected);
  socket.on("auction_created", onAuctionCreated);
  socket.on("auction_updated", onAuctionUpdated);
  socket.on("auction_ended", onAuctionEnded);
  socket.emit("join-room", room);

  return () => {
    activeSubscriptions = Math.max(activeSubscriptions - 1, 0);

    socket.off("connect", onConnected);
    socket.off("auction_created", onAuctionCreated);
    socket.off("auction_updated", onAuctionUpdated);
    socket.off("auction_ended", onAuctionEnded);
    socket.emit("leave-room", room);

    if (activeSubscriptions === 0 && socket.connected) {
      socket.disconnect();
    }
  };
}

export function subscribeToPortfolioRoom(userId: string, handlers: PortfolioRoomHandlers): () => void {
  const socket = getSocket();
  const room = portfolioRoomName(userId);

  const onBalanceUpdate = (event: BalanceUpdateEvent): void => {
    if (event.userId === userId) {
      handlers.onBalanceUpdate?.(event);
    }
  };

  const onConnected = (): void => {
    handlers.onConnected?.();
    socket.emit("join-room", room);
  };

  const onPriceUpdate = (event: PriceUpdateEvent): void => {
    if (event.userId === userId) {
      handlers.onPriceUpdate?.(event);
    }
  };

  if (!socket.connected) {
    socket.connect();
  }

  activeSubscriptions += 1;
  socket.on("connect", onConnected);
  socket.on("balance_update", onBalanceUpdate);
  socket.on(PRICE_UPDATE_EVENT, onPriceUpdate);
  socket.emit("join-room", room);

  return () => {
    activeSubscriptions = Math.max(activeSubscriptions - 1, 0);

    socket.off("connect", onConnected);
    socket.off("balance_update", onBalanceUpdate);
    socket.off(PRICE_UPDATE_EVENT, onPriceUpdate);
    socket.emit("leave-room", room);

    if (activeSubscriptions === 0 && socket.connected) {
      socket.disconnect();
    }
  };
}

export function subscribeToAdminMetricsRoom(handlers: AdminMetricsRoomHandlers): () => void {
  const socket = getSocket();
  const room = adminMetricsRoomName();

  const onMetricsDelta = (event: AdminMetricsDeltaRoomEvent): void => {
    handlers.onMetricsDelta?.(event);
  };

  const onConnected = (): void => {
    handlers.onConnected?.();
    socket.emit("join-room", room);
  };

  if (!socket.connected) {
    socket.connect();
  }

  activeSubscriptions += 1;
  socket.on("connect", onConnected);
  socket.on("admin_metrics_delta", onMetricsDelta);
  socket.emit("join-room", room);

  return () => {
    activeSubscriptions = Math.max(activeSubscriptions - 1, 0);

    socket.off("connect", onConnected);
    socket.off("admin_metrics_delta", onMetricsDelta);
    socket.emit("leave-room", room);

    if (activeSubscriptions === 0 && socket.connected) {
      socket.disconnect();
    }
  };
}
