import { type NextRequest, NextResponse } from "next/server";
import type { RarityTier } from "@/lib/types";
import { ApiRouteError, handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import {
  browseListings,
  createListing,
  type ListingSort
} from "@/server/services/trade.service";

type CreateListingBody = {
  cardId: string;
  price: number;
};

const VALID_RARITIES: readonly RarityTier[] = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"];
const VALID_SORTS: readonly ListingSort[] = ["newest", "price_asc", "price_desc"];

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

function parseOptionalSort(value: string | null): ListingSort {
  if (!value) {
    return "newest";
  }

  if (!VALID_SORTS.includes(value as ListingSort)) {
    throw new ApiRouteError("Invalid marketplace sort option.", 400, "INVALID_MARKETPLACE_SORT");
  }

  return value as ListingSort;
}

function validateCreateBody(payload: CreateListingBody): { cardId: string; price: number } {
  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const cardId = requireUuid(payload.cardId, "Card ID");
  const price = Number(payload.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new ApiRouteError("Price must be a positive number in cents.", 400, "INVALID_LISTING_PRICE");
  }

  return {
    cardId,
    price: Math.trunc(price)
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const rarity = parseOptionalRarity(request.nextUrl.searchParams.get("rarity"));
    const sort = parseOptionalSort(request.nextUrl.searchParams.get("sort"));
    const page = parseOptionalNumber(request.nextUrl.searchParams.get("page"), 1);
    const limit = parseOptionalNumber(request.nextUrl.searchParams.get("limit"), 24);

    const result = await browseListings({
      rarity,
      sort,
      page,
      limit
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    const body = validateCreateBody(await readJsonBody<CreateListingBody>(request));
    const result = await createListing({
      userId: authUser.userId,
      cardId: body.cardId,
      price: body.price
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
