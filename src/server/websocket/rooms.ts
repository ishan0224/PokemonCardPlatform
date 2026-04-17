export const roomNames = {
  drop: (dropId: string) => `drop:${dropId}`,
  auction: (auctionId: string) => `auction:${auctionId}`,
  portfolio: (userId: string) => `portfolio:${userId}`,
  marketplace: () => "marketplace"
};

export function isPublicRoom(room: string): boolean {
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

export function canJoinPrivateRoom(room: string, userId: string | null): boolean {
  if (!userId) {
    return false;
  }

  return room === roomNames.portfolio(userId);
}
