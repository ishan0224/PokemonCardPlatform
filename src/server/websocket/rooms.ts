export const roomNames = {
  drop: (dropId: string) => `drop:${dropId}`,
  auction: (auctionId: string) => `auction:${auctionId}`,
  portfolio: (userId: string) => `portfolio:${userId}`,
  marketplace: () => "marketplace"
};
