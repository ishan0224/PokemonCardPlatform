import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { cancelListing } from "@/server/services/trade.service";

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const listingId = requireUuid(context.params.id, "Listing ID");
    const authUser = await requireAuth(request);

    const result = await cancelListing({
      userId: authUser.userId,
      listingId
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
