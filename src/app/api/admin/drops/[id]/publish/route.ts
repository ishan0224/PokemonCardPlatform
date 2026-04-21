export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { publishAdminDrop } from "@/server/services/admin-drop.service";

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const dropId = requireUuid(context.params.id, "Drop ID");
    const drop = await publishAdminDrop(dropId);

    return NextResponse.json({ drop }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
