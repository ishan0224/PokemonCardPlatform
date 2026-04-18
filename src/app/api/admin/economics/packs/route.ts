import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  getPackEconomicsBundle,
  resolveEconomicsWindow
} from "@/server/services/economics.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);
    const window = resolveEconomicsWindow(request.nextUrl.searchParams);
    const bundle = await getPackEconomicsBundle(window);
    return NextResponse.json({ bundle }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
