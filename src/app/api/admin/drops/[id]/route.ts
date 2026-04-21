export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { getAdminDropById, updateAdminDrop, type AdminDropMutationInput } from "@/server/services/admin-drop.service";

export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const dropId = requireUuid(context.params.id, "Drop ID");
    const drop = await getAdminDropById(dropId);

    if (!drop) {
      return NextResponse.json(
        {
          error: {
            code: "DROP_NOT_FOUND",
            message: "Drop not found."
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ drop }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const dropId = requireUuid(context.params.id, "Drop ID");
    const payload = await readJsonBody<AdminDropMutationInput>(request);
    const drop = await updateAdminDrop(dropId, payload);

    return NextResponse.json({ drop }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
