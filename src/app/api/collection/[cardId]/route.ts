export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiRouteError, handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { getCollectionCardDetail } from "@/server/services/collection.service";

export async function GET(
  request: NextRequest,
  context: { params: { cardId: string } }
): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    const cardId = requireUuid(context.params.cardId, "Card ID");
    const card = await getCollectionCardDetail({
      userId: authUser.userId,
      cardId
    });

    if (!card) {
      throw new ApiRouteError("Card not found.", 404, "CARD_NOT_FOUND");
    }

    return NextResponse.json({ card }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
