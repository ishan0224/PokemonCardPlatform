import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  getEconomicsSummary,
  resolveEconomicsWindow
} from "@/server/services/economics.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);
    const window = resolveEconomicsWindow(request.nextUrl.searchParams);
    const summary = await getEconomicsSummary(window);
    return NextResponse.json({ summary }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
