import type {
  AuctionDurationType,
  AuctionStatus,
  CardState,
  DropStatus,
  EconomicsSummary,
  ListingStatus,
  PackEconomicsBundle,
  PackTier,
  RarityTier
} from "./types";

export type ApiUser = {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin";
};

export type ApiBalance = {
  total: number;
  held: number;
  available: number;
};

export type DropTier = {
  dropPackId: string;
  tier: PackTier;
  price: number;
  totalInventory: number;
  remainingInventory: number;
};

export type Drop = {
  id: string;
  scheduledAt: string;
  status: DropStatus;
  createdAt: string;
  tiers: DropTier[];
};

export type PackSummary = {
  id: string;
  dropId: string;
  dropPackId: string;
  tier: PackTier;
  pricePaid: number;
  opened: boolean;
  purchasedAt: string;
  openedAt: string | null;
};

export type PackCard = {
  id: string;
  slotNumber: number;
  rarityTier: RarityTier;
  state: CardState;
  acquisitionPrice: number;
  pokemonCard: {
    id: string;
    tcgId: string;
    name: string;
    setName: string;
    rarity: string;
    rarityTier: RarityTier;
    imageUrl: string | null;
    imageUrlHires: string | null;
    currentPrice: number;
  };
};

export type PackDetail = PackSummary & {
  cards: PackCard[] | null;
};

export type CollectionSort = "newest" | "value_desc" | "value_asc" | "pnl_desc" | "pnl_asc";
export type MarketplaceSort = "newest" | "price_asc" | "price_desc";

export type CollectionCard = {
  id: string;
  ownerId: string;
  slotNumber: number;
  state: CardState;
  acquisitionPrice: number;
  currentPrice: number;
  pnl: number;
  createdAt: string;
  activeListing: {
    id: string;
    price: number;
  } | null;
  pokemonCard: {
    id: string;
    tcgId: string;
    name: string;
    setName: string;
    rarity: string;
    rarityTier: RarityTier;
    imageUrl: string | null;
    imageUrlHires: string | null;
  };
};

export type CollectionPortfolio = {
  totalCards: number;
  totalAcquisitionValue: number;
  totalMarketValue: number;
  totalPnl: number;
  byRarity: Array<{
    rarityTier: RarityTier;
    count: number;
    marketValue: number;
  }>;
};

export type MarketplaceListing = {
  id: string;
  cardId: string;
  sellerId: string;
  sellerUsername: string;
  buyerId: string | null;
  price: number;
  status: ListingStatus;
  createdAt: string;
  soldAt: string | null;
  card: {
    id: string;
    slotNumber: number;
    rarityTier: RarityTier;
    acquisitionPrice: number;
    pokemonCard: {
      id: string;
      tcgId: string;
      name: string;
      setName: string;
      rarity: string;
      rarityTier: RarityTier;
      imageUrl: string | null;
      imageUrlHires: string | null;
      currentPrice: number;
    };
  };
};

export type AuctionBid = {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderUsername: string;
  amount: number;
  createdAt: string;
};

export type Auction = {
  id: string;
  cardId: string;
  sellerId: string;
  sellerUsername: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderId: string | null;
  currentBidderUsername: string | null;
  endsAt: string;
  originalEndTime: string;
  durationType: AuctionDurationType;
  status: AuctionStatus;
  createdAt: string;
  minNextBid: number;
  card: {
    id: string;
    slotNumber: number;
    rarityTier: RarityTier;
    acquisitionPrice: number;
    ownerId: string;
    pokemonCard: {
      id: string;
      tcgId: string;
      name: string;
      setName: string;
      rarity: string;
      rarityTier: RarityTier;
      imageUrl: string | null;
      imageUrlHires: string | null;
      currentPrice: number;
    };
  };
};

export type AuctionDetail = Auction & {
  bids: AuctionBid[];
  myActiveHold: number | null;
};

export type OpenPackResult = {
  packId: string;
  opened: boolean;
  openedAt: string;
  cards: Array<{
    slotNumber: number;
    revealed: boolean;
  }>;
};

export type PurchaseResult = {
  packId: string;
  dropId: string;
  dropPackId: string;
  tier: PackTier;
  pricePaid: number;
  remainingInventory: number;
  purchasedAt: string;
  cardsCount: number;
  newBalance: number;
};

type JsonRecord = Record<string, unknown>;

type ApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

function createAbortError(message: string): ApiClientError {
  return new ApiClientError({ code: "REQUEST_ABORTED", message }, 499);
}

async function parseJsonSafe(response: Response): Promise<JsonRecord> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as JsonRecord;
  } catch (_error) {
    throw new ApiClientError(
      {
        code: "INVALID_RESPONSE",
        message: "Received invalid JSON from the server."
      },
      response.status
    );
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {})
      },
      cache: "no-store"
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      const error = payload.error as ApiErrorPayload | undefined;
      throw new ApiClientError(
        {
          code: error?.code ?? "HTTP_ERROR",
          message: error?.message ?? `Request failed with ${response.status}.`,
          details: error?.details
        },
        response.status
      );
    }

    return payload as T;
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      throw createAbortError("Request was aborted.");
    }
    throw error;
  }
}

export function mapApiErrorToMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "Incorrect email or password.";
      case "SOLD_OUT":
        return "That tier is sold out.";
      case "DROP_NOT_ACTIVE":
        return "This drop is not active yet.";
      case "INSUFFICIENT_BALANCE":
        return "Insufficient available balance.";
      case "PER_USER_TIER_LIMIT_REACHED":
        return "Tier purchase limit reached for this drop.";
      case "PACK_NOT_OPENED":
        return "Open the pack before revealing cards.";
      case "PACK_NOT_FOUND":
      case "DROP_NOT_FOUND":
        return "The requested item was not found.";
      case "UNAUTHORIZED":
        return "Please log in to continue.";
      case "LISTING_NOT_ACTIVE":
        return "Listing is no longer active.";
      case "LISTING_ALREADY_ACTIVE":
        return "This card already has an active listing.";
      case "CARD_NOT_LISTABLE":
        return "This card cannot be listed right now.";
      case "NOT_CARD_OWNER":
      case "LISTING_FORBIDDEN":
        return "You are not allowed to perform this listing action.";
      case "INVALID_LISTING_PRICE":
        return "Listing price is invalid.";
      case "SELF_PURCHASE_NOT_ALLOWED":
        return "You cannot buy your own listing.";
      case "INVALID_STARTING_BID":
        return "Starting bid is invalid.";
      case "INVALID_AUCTION_DURATION":
        return "Auction duration is invalid.";
      case "CARD_NOT_AUCTIONABLE":
        return "This card cannot be auctioned right now.";
      case "AUCTION_ALREADY_ACTIVE":
        return "This card already has an active auction.";
      case "AUCTION_NOT_FOUND":
        return "Auction not found.";
      case "AUCTION_NOT_ACTIVE":
      case "AUCTION_ENDED":
        return "Auction is no longer active.";
      case "SELF_BID_NOT_ALLOWED":
        return "You cannot bid on your own auction.";
      case "ALREADY_HIGHEST_BIDDER":
        return "You already have the highest bid.";
      case "BID_TOO_LOW":
        return "Bid is below the minimum required amount.";
      case "INVALID_BID_AMOUNT":
        return "Bid amount is invalid.";
      case "FORBIDDEN":
        return "You do not have permission to access this page.";
      case "INVALID_WINDOW":
        return "Time window is invalid.";
      case "REQUEST_ABORTED":
        return "";
      default:
        return error.message || "Request failed.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

export const apiClient = {
  register(input: { username: string; email: string; password: string }, signal?: AbortSignal): Promise<{
    user: ApiUser;
    requiresEmailConfirmation: boolean;
  }> {
    return requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
      signal
    });
  },

  login(input: { email: string; password: string }, signal?: AbortSignal): Promise<{ user: ApiUser }> {
    return requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
      signal
    });
  },

  me(signal?: AbortSignal): Promise<{ user: ApiUser; balance: ApiBalance }> {
    return requestJson("/api/auth/me", { method: "GET", signal });
  },

  logout(signal?: AbortSignal): Promise<{ success: boolean }> {
    return requestJson("/api/auth/logout", { method: "POST", signal });
  },

  listDrops(limit = 20, signal?: AbortSignal): Promise<{ drops: Drop[] }> {
    return requestJson(`/api/drops?limit=${limit}`, { method: "GET", signal });
  },

  getDrop(dropId: string, signal?: AbortSignal): Promise<{ drop: Drop }> {
    return requestJson(`/api/drops/${dropId}`, { method: "GET", signal });
  },

  purchaseDropTier(dropId: string, tier: PackTier, signal?: AbortSignal): Promise<{ purchase: PurchaseResult }> {
    return requestJson(`/api/drops/${dropId}/purchase`, {
      method: "POST",
      body: JSON.stringify({ tier }),
      signal
    });
  },

  listPacks(limit = 50, signal?: AbortSignal): Promise<{ packs: PackSummary[] }> {
    return requestJson(`/api/packs?limit=${limit}`, { method: "GET", signal });
  },

  getPack(packId: string, signal?: AbortSignal): Promise<{ pack: PackDetail }> {
    return requestJson(`/api/packs/${packId}`, { method: "GET", signal });
  },

  openPack(packId: string, signal?: AbortSignal): Promise<{ pack: OpenPackResult }> {
    return requestJson(`/api/packs/${packId}/open`, { method: "POST", signal });
  },

  revealPackCard(packId: string, slotNumber: number, signal?: AbortSignal): Promise<{ card: PackCard }> {
    return requestJson(`/api/packs/${packId}/cards/${slotNumber}`, {
      method: "GET",
      signal
    });
  },

  listCollection(
    input: {
      rarity?: RarityTier | null;
      state?: CardState | null;
      sort?: CollectionSort;
      page?: number;
      limit?: number;
    } = {},
    signal?: AbortSignal
  ): Promise<{ cards: CollectionCard[]; page: number; limit: number; total: number }> {
    const params = new URLSearchParams();

    if (input.rarity) {
      params.set("rarity", input.rarity);
    }
    if (input.state) {
      params.set("state", input.state);
    }
    if (input.sort) {
      params.set("sort", input.sort);
    }
    if (input.page) {
      params.set("page", String(input.page));
    }
    if (input.limit) {
      params.set("limit", String(input.limit));
    }

    const query = params.toString();
    return requestJson(`/api/collection${query ? `?${query}` : ""}`, { method: "GET", signal });
  },

  getCollectionPortfolio(signal?: AbortSignal): Promise<{ portfolio: CollectionPortfolio }> {
    return requestJson("/api/collection/portfolio", { method: "GET", signal });
  },

  listMarketplaceListings(
    input: {
      rarity?: RarityTier | null;
      sort?: MarketplaceSort;
      page?: number;
      limit?: number;
    } = {},
    signal?: AbortSignal
  ): Promise<{ listings: MarketplaceListing[]; page: number; limit: number; total: number }> {
    const params = new URLSearchParams();

    if (input.rarity) {
      params.set("rarity", input.rarity);
    }
    if (input.sort) {
      params.set("sort", input.sort);
    }
    if (input.page) {
      params.set("page", String(input.page));
    }
    if (input.limit) {
      params.set("limit", String(input.limit));
    }

    const query = params.toString();
    return requestJson(`/api/marketplace/listings${query ? `?${query}` : ""}`, { method: "GET", signal });
  },

  createListing(input: { cardId: string; price: number }, signal?: AbortSignal): Promise<{ listing: MarketplaceListing }> {
    return requestJson("/api/marketplace/listings", {
      method: "POST",
      body: JSON.stringify(input),
      signal
    });
  },

  cancelListing(listingId: string, signal?: AbortSignal): Promise<{ listing: MarketplaceListing }> {
    return requestJson(`/api/marketplace/listings/${listingId}`, {
      method: "DELETE",
      signal
    });
  },

  buyListing(
    listingId: string,
    signal?: AbortSignal
  ): Promise<{
    listing: MarketplaceListing;
    feeCharged: number;
    buyerNewBalance: number;
    sellerNewBalance: number;
  }> {
    return requestJson(`/api/marketplace/listings/${listingId}/buy`, {
      method: "POST",
      signal
    });
  },

  listAuctions(
    input: {
      page?: number;
      limit?: number;
    } = {},
    signal?: AbortSignal
  ): Promise<{ auctions: Auction[]; page: number; limit: number; total: number }> {
    const params = new URLSearchParams();

    if (input.page) {
      params.set("page", String(input.page));
    }

    if (input.limit) {
      params.set("limit", String(input.limit));
    }

    const query = params.toString();
    return requestJson(`/api/auctions${query ? `?${query}` : ""}`, { method: "GET", signal });
  },

  getAuction(auctionId: string, signal?: AbortSignal): Promise<{ auction: AuctionDetail }> {
    return requestJson(`/api/auctions/${auctionId}`, { method: "GET", signal });
  },

  createAuction(
    input: {
      cardId: string;
      startingBid: number;
      durationType: AuctionDurationType;
    },
    signal?: AbortSignal
  ): Promise<{ auction: AuctionDetail }> {
    return requestJson("/api/auctions", {
      method: "POST",
      body: JSON.stringify(input),
      signal
    });
  },

  placeBid(
    auctionId: string,
    amount: number,
    signal?: AbortSignal
  ): Promise<{
    auction: AuctionDetail;
    bid: AuctionBid;
    timeExtended: boolean;
  }> {
    return requestJson(`/api/auctions/${auctionId}/bid`, {
      method: "POST",
      body: JSON.stringify({ amount }),
      signal
    });
  },

  getEconomicsSummary(
    input: { fromIso?: string; toIso?: string } = {},
    signal?: AbortSignal
  ): Promise<{ summary: EconomicsSummary }> {
    const params = new URLSearchParams();
    if (input.fromIso) {
      params.set("from", input.fromIso);
    }
    if (input.toIso) {
      params.set("to", input.toIso);
    }
    const query = params.toString();
    return requestJson(`/api/admin/economics${query ? `?${query}` : ""}`, {
      method: "GET",
      signal
    });
  },

  getPackEconomics(
    input: { fromIso?: string; toIso?: string } = {},
    signal?: AbortSignal
  ): Promise<{ bundle: PackEconomicsBundle }> {
    const params = new URLSearchParams();
    if (input.fromIso) {
      params.set("from", input.fromIso);
    }
    if (input.toIso) {
      params.set("to", input.toIso);
    }
    const query = params.toString();
    return requestJson(`/api/admin/economics/packs${query ? `?${query}` : ""}`, {
      method: "GET",
      signal
    });
  }
};
