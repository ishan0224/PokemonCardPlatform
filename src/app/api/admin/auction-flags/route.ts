import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  listAuctionFlags,
  mapAuctionFlagRow,
  parseAuctionFlagListLimit,
  parseAuctionFlagListStatus
} from "@/server/services/auction-flag.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const status = parseAuctionFlagListStatus(request.nextUrl.searchParams.get("status"));
    const limit = parseAuctionFlagListLimit(request.nextUrl.searchParams.get("limit"));
    const flags = await listAuctionFlags({ status, limit });

    return NextResponse.json({ flags: flags.map(mapAuctionFlagRow) }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
