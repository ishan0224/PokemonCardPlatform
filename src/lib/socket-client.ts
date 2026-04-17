"use client";

import { io, type Socket } from "socket.io-client";
import type { PackTier } from "./types";

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

function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(getSocketUrl(), {
      withCredentials: true,
      transports: ["websocket"],
      autoConnect: false,
      reconnection: true
    });
  }

  return socketInstance;
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
