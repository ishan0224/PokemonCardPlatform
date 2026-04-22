export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { RATE_LIMITS } from "@/server/config/constants";
import { getClientIp, handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { buyListing } from "@/server/services/trade.service";

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const listingId = requireUuid(context.params.id, "Listing ID");
    const authUser = await requireAuth(request);

    await enforceRateLimit({
      key: `marketplace:buy:${authUser.userId}:${listingId}:${getClientIp(request)}`,
      ...RATE_LIMITS.buyListing
    });

    const result = await buyListing({
      buyerId: authUser.userId,
      listingId
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
