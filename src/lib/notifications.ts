import { formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import type {
  AdminMetricsDeltaRoomEvent,
  AuctionEndedEvent,
  AuctionNewBidEvent,
  BalanceUpdateEvent,
  DropInventoryUpdateEvent,
  DropLifecycleEvent,
  MarketplaceListingEvent
} from "@/lib/socket-client";

export type NotificationEvent = {
  id: string;
  message: string;
  createdAt: string;
  href?: string;
};

type NotificationInput =
  | { kind: "drop_started"; payload: DropLifecycleEvent }
  | { kind: "drop_completed"; payload: DropLifecycleEvent }
  | { kind: "sold_out"; payload: DropInventoryUpdateEvent }
  | { kind: "inventory_update"; payload: DropInventoryUpdateEvent }
  | { kind: "listing_created"; payload: MarketplaceListingEvent }
  | { kind: "listing_sold"; payload: MarketplaceListingEvent; currentUserId: string }
  | { kind: "listing_cancelled"; payload: MarketplaceListingEvent; currentUserId: string }
  | { kind: "auction_new_bid"; payload: AuctionNewBidEvent; currentUserId: string; wasLeading: boolean }
  | { kind: "auction_ended"; payload: AuctionEndedEvent; currentUserId: string }
  | { kind: "balance_update"; payload: BalanceUpdateEvent; currentUserId: string }
  | { kind: "admin_metrics_delta"; payload: AdminMetricsDeltaRoomEvent };

function nowIso(): string {
  return new Date().toISOString();
}

function notification(message: string, href?: string): NotificationEvent {
  return {
    id: `notif_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    message,
    createdAt: nowIso(),
    href
  };
}

export function toNotificationEvent(input: NotificationInput): NotificationEvent | null {
  switch (input.kind) {
    case "drop_started":
      return notification(`Drop ${input.payload.dropId.slice(0, 8)} is now live.`, routes.drops.detail(input.payload.dropId));
    case "drop_completed":
      return notification(`Drop ${input.payload.dropId.slice(0, 8)} has completed.`, routes.drops.detail(input.payload.dropId));
    case "sold_out":
      return notification(
        `${formatTierLabel(input.payload.tier)} packs sold out in drop ${input.payload.dropId.slice(0, 8)}.`,
        routes.drops.detail(input.payload.dropId)
      );
    case "inventory_update":
      return notification(
        `${formatTierLabel(input.payload.tier)} inventory updated: ${input.payload.remainingInventory} left.`,
        routes.drops.detail(input.payload.dropId)
      );
    case "listing_created":
      return notification("New marketplace listing posted.", routes.marketplace.index);
    case "listing_sold":
      if (input.payload.sellerId !== input.currentUserId) {
        return null;
      }
      return notification("Your marketplace listing sold.", routes.marketplace.index);
    case "listing_cancelled":
      if (input.payload.sellerId !== input.currentUserId) {
        return null;
      }
      return notification("Your marketplace listing was cancelled.", routes.marketplace.index);
    case "auction_new_bid":
      if (input.payload.currentBidderId === input.currentUserId) {
        return notification("You are currently leading an auction.", routes.auctions.detail(input.payload.auctionId));
      }
      if (input.wasLeading) {
        return notification("You were outbid in an auction.", routes.auctions.detail(input.payload.auctionId));
      }
      return null;
    case "auction_ended":
      if (input.payload.winnerId === input.currentUserId) {
        return notification("You won an auction.", routes.collection.index);
      }
      if (input.payload.sellerId === input.currentUserId) {
        return notification("One of your auctions ended.", routes.auctions.detail(input.payload.auctionId));
      }
      return null;
    case "balance_update":
      if (input.payload.userId !== input.currentUserId) {
        return null;
      }
      return notification("Your balance has been updated.", routes.home);
    case "admin_metrics_delta":
      return notification("Admin metrics changed. Review the dashboard.", routes.admin.index);
    default:
      return null;
  }
}
