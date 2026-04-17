"use client";

import { useEffect, useRef } from "react";
import {
  subscribeToDropRoom,
  subscribeToMarketplaceRoom,
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
