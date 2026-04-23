// Public drop detail — no auth, safe to cache
export const revalidate = 30;

import { NextResponse } from "next/server";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { getDrop } from "@/server/services/drop.service";

export async function GET(
  _request: Request,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const dropId = requireUuid(context.params.id, "Drop ID");

    const drop = await getDrop(dropId);
    return NextResponse.json({ drop }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
