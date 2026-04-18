"use client";

import { useEffect, useRef } from "react";
import {
  subscribeToPortfolioRoom,
  subscribeToAuctionsRoom,
  subscribeToAuctionRoom,
  subscribeToDropRoom,
  subscribeToMarketplaceRoom,
  type PortfolioRoomHandlers,
  type AuctionsRoomHandlers,
  type AuctionRoomHandlers,
  type DropRoomHandlers,
  type MarketplaceRoomHandlers
} from "@/lib/socket-client";

export function useDropRoom(dropId: string | null, handlers: DropRoomHandlers): void {
  const handlersRef = useRef<DropRoomHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!dropId) {
      return;
    }

    return subscribeToDropRoom(dropId, {
      onInventoryUpdate: (event) => handlersRef.current.onInventoryUpdate?.(event),
      onSoldOut: (event) => handlersRef.current.onSoldOut?.(event),
      onDropStarted: (event) => handlersRef.current.onDropStarted?.(event),
      onDropCompleted: (event) => handlersRef.current.onDropCompleted?.(event),
      onConnected: () => handlersRef.current.onConnected?.()
    });
  }, [dropId]);
}

export function useMarketplaceRoom(enabled: boolean, handlers: MarketplaceRoomHandlers): void {
  const handlersRef = useRef<MarketplaceRoomHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeToMarketplaceRoom({
      onListingCreated: (event) => handlersRef.current.onListingCreated?.(event),
      onListingSold: (event) => handlersRef.current.onListingSold?.(event),
      onListingCancelled: (event) => handlersRef.current.onListingCancelled?.(event),
      onConnected: () => handlersRef.current.onConnected?.()
    });
  }, [enabled]);
}

export function useAuctionRoom(auctionId: string | null, handlers: AuctionRoomHandlers): void {
  const handlersRef = useRef<AuctionRoomHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!auctionId) {
      return;
    }

    return subscribeToAuctionRoom(auctionId, {
      onNewBid: (event) => handlersRef.current.onNewBid?.(event),
      onTimeExtended: (event) => handlersRef.current.onTimeExtended?.(event),
      onAuctionEnded: (event) => handlersRef.current.onAuctionEnded?.(event),
      onWatcherCount: (event) => handlersRef.current.onWatcherCount?.(event),
      onConnected: () => handlersRef.current.onConnected?.()
    });
  }, [auctionId]);
}

export function useAuctionsRoom(enabled: boolean, handlers: AuctionsRoomHandlers): void {
  const handlersRef = useRef<AuctionsRoomHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeToAuctionsRoom({
      onAuctionCreated: (event) => handlersRef.current.onAuctionCreated?.(event),
      onAuctionUpdated: (event) => handlersRef.current.onAuctionUpdated?.(event),
      onAuctionEnded: (event) => handlersRef.current.onAuctionEnded?.(event),
      onConnected: () => handlersRef.current.onConnected?.()
    });
  }, [enabled]);
}

export function usePortfolioRoom(userId: string | null, handlers: PortfolioRoomHandlers): void {
  const handlersRef = useRef<PortfolioRoomHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    return subscribeToPortfolioRoom(userId, {
      onBalanceUpdate: (event) => handlersRef.current.onBalanceUpdate?.(event),
      onPriceUpdate: (event) => handlersRef.current.onPriceUpdate?.(event),
      onConnected: () => handlersRef.current.onConnected?.()
    });
  }, [userId]);
}
