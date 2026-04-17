import type { CardState, DropStatus, PackTier, RarityTier } from "./types";

export type ApiUser = {
  id: string;
  username: string;
  email: string;
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
  }
};
