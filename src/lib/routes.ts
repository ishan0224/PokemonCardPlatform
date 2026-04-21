function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export const routes = {
  home: "/",
  auth: {
    login: "/login",
    register: "/register"
  },
  drops: {
    index: "/drops",
    detail: (dropId: string) => `/drops/${encodeSegment(dropId)}`
  },
  collection: {
    index: "/collection"
  },
  marketplace: {
    index: "/marketplace"
  },
  auctions: {
    index: "/auctions",
    detail: (auctionId: string) => `/auctions/${encodeSegment(auctionId)}`
  },
  packs: {
    index: "/packs",
    detail: (packId: string) => `/packs/${encodeSegment(packId)}`,
    reveal: (packId: string) => `/packs/${encodeSegment(packId)}/reveal`
  },
  fairness: {
    verifyIndex: "/verify",
    verify: (packId: string) => `/fairness/verify/${encodeSegment(packId)}`
  },
  legal: {
    terms: "/terms",
    privacy: "/privacy",
    about: "/about",
    fairnessExplainer: "/fairness"
  },
  admin: {
    index: "/admin",
    economics: "/admin/economics",
    auctionFlags: "/admin/auction-flags",
    fairness: "/admin/fairness",
    drops: "/admin/drops",
    dropsNew: "/admin/drops/new",
    dropsEdit: (dropId: string) => `/admin/drops/${encodeSegment(dropId)}/edit`
  }
} as const;
