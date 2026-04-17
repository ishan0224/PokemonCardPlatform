"use client";

import { useEffect, useRef } from "react";
import { subscribeToDropRoom, type DropRoomHandlers } from "@/lib/socket-client";

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
      onDropCompleted: (event) => handlersRef.current.onDropCompleted?.(event)
    });
  }, [dropId]);
}
