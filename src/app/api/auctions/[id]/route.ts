import { type NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromRequest } from "@/server/middleware/auth";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { validateSupabaseAccessToken } from "@/server/supabase/client";
import { getAuctionDetail } from "@/server/services/auction.service";

async function resolveViewerUserId(request: NextRequest): Promise<string | null> {
  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) {
    return null;
  }

  try {
    const user = await validateSupabaseAccessToken(accessToken);
    return user.userId;
  } catch (_error) {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const auctionId = requireUuid(context.params.id, "Auction ID");
    const viewerUserId = await resolveViewerUserId(request);
    const auction = await getAuctionDetail({
      auctionId,
      viewerUserId
    });

    return NextResponse.json({ auction }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
