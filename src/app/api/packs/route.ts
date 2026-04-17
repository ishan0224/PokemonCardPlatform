import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { listUserPacks } from "@/server/services/pack.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 50;

    const packs = await listUserPacks(authUser.userId, Number.isFinite(limit) ? limit : 50);

    return NextResponse.json({ packs }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
