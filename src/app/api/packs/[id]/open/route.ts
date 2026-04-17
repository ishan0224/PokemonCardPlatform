import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { openPack } from "@/server/services/pack.service";

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const packId = requireUuid(context.params.id, "Pack ID");

    const authUser = await requireAuth(request);
    const openedPack = await openPack(authUser.userId, packId);

    return NextResponse.json({ pack: openedPack }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
