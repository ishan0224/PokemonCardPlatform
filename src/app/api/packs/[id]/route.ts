export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { getUserPackDetail } from "@/server/services/pack.service";

export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const packId = requireUuid(context.params.id, "Pack ID");
    const authUser = await requireAuth(request);
    const pack = await getUserPackDetail(authUser.userId, packId);

    return NextResponse.json({ pack }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
