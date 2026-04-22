export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { ApiRouteError, handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { getWashTradeReport } from "@/server/services/auction-wash-trade.service";

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

function parseWindowDays(raw: string | null): number {
  if (raw === null || raw.trim().length === 0) {
    return DEFAULT_WINDOW_DAYS;
  }

  const trimmed = raw.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)d$/);
  if (!match) {
    throw new ApiRouteError("Window must be formatted as <N>d (e.g. 7d).", 400, "INVALID_WINDOW");
  }

  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_WINDOW_DAYS) {
    throw new ApiRouteError(
      `Window must be a positive integer number of days up to ${MAX_WINDOW_DAYS}.`,
      400,
      "INVALID_WINDOW"
    );
  }

  return Math.trunc(days);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const windowDays = parseWindowDays(request.nextUrl.searchParams.get("window"));
    const to = new Date();
    const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const report = await getWashTradeReport({ from, to });
    return NextResponse.json({ report }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
