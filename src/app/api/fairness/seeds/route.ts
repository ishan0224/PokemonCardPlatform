export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { ApiRouteError, handleRouteError, requireUuid } from "@/server/http/api";
import { listFairnessSeeds, type FairnessSeedStatusFilter } from "@/server/services/fairness-query.service";

function parseOptionalNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStatus(value: string | null): FairnessSeedStatusFilter {
  if (!value) {
    return "all";
  }
  if (value === "all" || value === "revealed" || value === "unrevealed") {
    return value;
  }
  throw new ApiRouteError("status must be one of: all, revealed, unrevealed.", 400, "INVALID_STATUS_FILTER");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const rawDropId = request.nextUrl.searchParams.get("drop_id");
    const dropId = rawDropId ? requireUuid(rawDropId, "Drop ID") : null;
    const status = parseStatus(request.nextUrl.searchParams.get("status"));
    const page = parseOptionalNumber(request.nextUrl.searchParams.get("page"), 1);
    const limit = parseOptionalNumber(request.nextUrl.searchParams.get("limit"), 20);

    const result = await listFairnessSeeds({
      dropId,
      status,
      page,
      limit
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
