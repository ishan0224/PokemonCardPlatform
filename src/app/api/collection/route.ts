import { type NextRequest, NextResponse } from "next/server";
import type { CardState, RarityTier } from "@/lib/types";
import { ApiRouteError, handleRouteError } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { listCollectionCards, type CollectionSort } from "@/server/services/collection.service";

const VALID_RARITIES: readonly RarityTier[] = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"];
const VALID_STATES: readonly CardState[] = ["in_pack", "owned", "listed", "in_auction"];
const VALID_SORTS: readonly CollectionSort[] = ["newest", "value_desc", "value_asc", "pnl_desc", "pnl_asc"];

function parseOptionalNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalRarity(value: string | null): RarityTier | null {
  if (!value) {
    return null;
  }

  if (!VALID_RARITIES.includes(value as RarityTier)) {
    throw new ApiRouteError("Invalid rarity filter.", 400, "INVALID_RARITY_FILTER");
  }

  return value as RarityTier;
}

function parseOptionalState(value: string | null): CardState | null {
  if (!value) {
    return null;
  }

  if (!VALID_STATES.includes(value as CardState)) {
    throw new ApiRouteError("Invalid state filter.", 400, "INVALID_STATE_FILTER");
  }

  if (value === "in_pack") {
    throw new ApiRouteError("in_pack is not a browsable collection state.", 400, "INVALID_STATE_FILTER");
  }

  return value as CardState;
}

function parseOptionalSort(value: string | null): CollectionSort {
  if (!value) {
    return "newest";
  }

  if (!VALID_SORTS.includes(value as CollectionSort)) {
    throw new ApiRouteError("Invalid collection sort option.", 400, "INVALID_COLLECTION_SORT");
  }

  return value as CollectionSort;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);

    const rarity = parseOptionalRarity(request.nextUrl.searchParams.get("rarity"));
    const state = parseOptionalState(request.nextUrl.searchParams.get("state"));
    const sort = parseOptionalSort(request.nextUrl.searchParams.get("sort"));
    const page = parseOptionalNumber(request.nextUrl.searchParams.get("page"), 1);
    const limit = parseOptionalNumber(request.nextUrl.searchParams.get("limit"), 24);

    const result = await listCollectionCards({
      userId: authUser.userId,
      rarity,
      state,
      sort,
      page,
      limit
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
