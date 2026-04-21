export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { RATE_LIMITS } from "@/server/config/constants";
import { ApiRouteError, getClientIp, handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { enforceRateLimit } from "@/server/middleware/rate-limit";
import { listMyFairnessPacks } from "@/server/services/fairness-query.service";

function parseOptionalLimit(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ApiRouteError("limit must be an integer.", 400, "INVALID_LIMIT");
  }

  if (parsed < 1 || parsed > 50) {
    throw new ApiRouteError("limit must be between 1 and 50.", 400, "INVALID_LIMIT");
  }

  return parsed;
}

function parseOptionalDate(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApiRouteError("date must be YYYY-MM-DD.", 400, "INVALID_DATE");
  }

  return normalized;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    await enforceRateLimit({
      key: `fairness:my-packs:${authUser.userId}:${getClientIp(request)}`,
      ...RATE_LIMITS.fairnessMyPacks
    });

    const dropIdRaw = request.nextUrl.searchParams.get("dropId");
    const dropId = dropIdRaw ? requireUuid(dropIdRaw, "dropId") : null;
    const date = parseOptionalDate(request.nextUrl.searchParams.get("date"));
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = parseOptionalLimit(request.nextUrl.searchParams.get("limit"));

    const result = await listMyFairnessPacks({
      userId: authUser.userId,
      date,
      dropId,
      cursor,
      limit
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
