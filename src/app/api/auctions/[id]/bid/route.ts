import { type NextRequest, NextResponse } from "next/server";
import { RATE_LIMITS } from "@/server/config/constants";
import { ApiRouteError, getClientIp, handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { placeBid } from "@/server/services/auction.service";

type PlaceBidBody = {
  amount: number;
  confirmHighBid?: boolean;
};

function validatePlaceBidBody(payload: PlaceBidBody): { amount: number; confirmHighBid: boolean } {
  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const amount = Number(payload.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiRouteError("Bid amount must be a positive number in cents.", 400, "INVALID_BID_AMOUNT");
  }

  const confirmHighBid = payload.confirmHighBid === true;

  return {
    amount: Math.trunc(amount),
    confirmHighBid
  };
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const auctionId = requireUuid(context.params.id, "Auction ID");
    const authUser = await requireAuth(request);

    // Existing IP-scoped bid throttle preserved.
    await enforceRateLimit({
      key: `auction:bid:${authUser.userId}:${auctionId}:${getClientIp(request)}`,
      ...RATE_LIMITS.placeBid
    });

    // Phase 5 B3 per-auction-per-bidder throttle (3 / 10s) — source plan §448.
    // Separate from the existing throttle; it does not replace it.
    await enforceRateLimit({
      key: `bid:auction:${auctionId}:user:${authUser.userId}`,
      ...RATE_LIMITS.placeBidPerAuctionPerUser
    });

    const body = validatePlaceBidBody(await readJsonBody<PlaceBidBody>(request));
    const result = await placeBid({
      bidderId: authUser.userId,
      auctionId,
      amount: body.amount,
      confirmHighBid: body.confirmHighBid
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
