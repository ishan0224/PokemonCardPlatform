import { type NextRequest, NextResponse } from "next/server";
import type { PackTier } from "@/lib/types";
import { RATE_LIMITS } from "@/server/config/constants";
import { ApiRouteError, getClientIp, handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { purchasePack } from "@/server/services/drop.service";

type PurchaseBody = {
  tier: PackTier;
};

function parseTier(value: unknown): PackTier {
  if (value === "standard" || value === "premium" || value === "elite") {
    return value;
  }

  throw new ApiRouteError("Tier must be one of: standard, premium, elite.", 400, "INVALID_TIER");
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const dropId = requireUuid(context.params.id, "Drop ID");

    const authUser = await requireAuth(request);

    await enforceRateLimit({
      key: `pack:purchase:${authUser.userId}:${dropId}:${getClientIp(request)}`,
      ...RATE_LIMITS.packPurchase
    });

    const body = await readJsonBody<PurchaseBody>(request);
    const tier = parseTier(body?.tier);

    const result = await purchasePack({
      userId: authUser.userId,
      dropId,
      tier
    });

    return NextResponse.json({ purchase: result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
