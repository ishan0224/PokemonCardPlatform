import { type NextRequest, NextResponse } from "next/server";
import type { AuctionDurationType } from "@/lib/types";
import { ApiRouteError, handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { createAuction, listActiveAuctions } from "@/server/services/auction.service";
import { MIN_AUCTION_START_BID_CENTS } from "@/server/config/constants";

type CreateAuctionBody = {
  cardId: string;
  startingBid: number;
  durationType: AuctionDurationType;
};

const VALID_DURATION_TYPES: readonly AuctionDurationType[] = ["1h", "6h", "24h"];

function parseOptionalNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validateCreateBody(payload: CreateAuctionBody): {
  cardId: string;
  startingBid: number;
  durationType: AuctionDurationType;
} {
  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const cardId = requireUuid(payload.cardId, "Card ID");
  const startingBid = Number(payload.startingBid);
  const durationType = payload.durationType;

  if (!Number.isFinite(startingBid) || startingBid < MIN_AUCTION_START_BID_CENTS) {
    throw new ApiRouteError(
      `Starting bid must be at least ${MIN_AUCTION_START_BID_CENTS} cents.`,
      400,
      "INVALID_STARTING_BID"
    );
  }

  if (!VALID_DURATION_TYPES.includes(durationType)) {
    throw new ApiRouteError("Duration type must be one of: 1h, 6h, 24h.", 400, "INVALID_AUCTION_DURATION");
  }

  return {
    cardId,
    startingBid: Math.trunc(startingBid),
    durationType
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const page = parseOptionalNumber(request.nextUrl.searchParams.get("page"), 1);
    const limit = parseOptionalNumber(request.nextUrl.searchParams.get("limit"), 24);
    const result = await listActiveAuctions({ page, limit });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    const body = validateCreateBody(await readJsonBody<CreateAuctionBody>(request));
    const result = await createAuction({
      sellerId: authUser.userId,
      cardId: body.cardId,
      startingBid: body.startingBid,
      durationType: body.durationType
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
