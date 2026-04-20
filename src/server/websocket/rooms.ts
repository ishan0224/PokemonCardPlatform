export const roomNames = {
  drop: (dropId: string) => `drop:${dropId}`,
  auction: (auctionId: string) => `auction:${auctionId}`,
  auctions: () => "auctions",
  portfolio: (userId: string) => `portfolio:${userId}`,
  marketplace: () => "marketplace",
  adminMetrics: () => "admin:metrics"
};

export function isPublicRoom(room: string): boolean {
  if (room === roomNames.auctions()) {
    return true;
  }

  if (room === roomNames.marketplace()) {
    return true;
  }

  if (room.startsWith("drop:")) {
    return room.slice("drop:".length).length > 0;
  }

  if (room.startsWith("auction:")) {
    return room.slice("auction:".length).length > 0;
  }

  return false;
}

export function canJoinPrivateRoom(
  room: string,
  userId: string | null,
  userRole?: "user" | "admin" | null
): boolean {
  if (!userId) {
    return false;
  }

  if (room === roomNames.portfolio(userId)) {
    return true;
  }

  if (room === roomNames.adminMetrics()) {
    return userRole === "admin";
  }

  return false;
}
