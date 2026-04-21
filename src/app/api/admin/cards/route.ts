export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { searchAdminCards } from "@/server/services/admin-card-catalog.service";

function parseOptionalLimit(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const query = request.nextUrl.searchParams.get("q") ?? "";
    const result = await searchAdminCards({
      query,
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: parseOptionalLimit(request.nextUrl.searchParams.get("limit"))
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
