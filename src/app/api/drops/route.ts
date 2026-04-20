export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { listDrops } from "@/server/services/drop.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 20;

    const drops = await listDrops(Number.isFinite(limit) ? limit : 20);

    return NextResponse.json({ drops }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
