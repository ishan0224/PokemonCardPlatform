import { type NextRequest, NextResponse } from "next/server";
import { RATE_LIMITS } from "@/server/config/constants";
import { ApiRouteError, getClientIp, handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { placeBid } from "@/server/services/auction.service";

type PlaceBidBody = {
  amount: number;
};

function validatePlaceBidBody(payload: PlaceBidBody): { amount: number } {
  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const amount = Number(payload.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiRouteError("Bid amount must be a positive number in cents.", 400, "INVALID_BID_AMOUNT");
  }

  return {
    amount: Math.trunc(amount)
  };
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const auctionId = requireUuid(context.params.id, "Auction ID");
    const authUser = await requireAuth(request);

    await enforceRateLimit({
      key: `auction:bid:${authUser.userId}:${auctionId}:${getClientIp(request)}`,
      ...RATE_LIMITS.placeBid
    });

    const body = validatePlaceBidBody(await readJsonBody<PlaceBidBody>(request));
    const result = await placeBid({
      bidderId: authUser.userId,
      auctionId,
      amount: body.amount
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
