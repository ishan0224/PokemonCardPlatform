import { type NextRequest, NextResponse } from "next/server";
import { ApiRouteError, handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { listGenerationVersions } from "@/server/economics/rebalance";

function parseOptionalNumber(value: string | null, field: string): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiRouteError(`${field} must be numeric.`, 400, "INVALID_PAGINATION", { field });
  }

  return parsed;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);
    const result = await listGenerationVersions({
      page: parseOptionalNumber(request.nextUrl.searchParams.get("page"), "page"),
      limit: parseOptionalNumber(request.nextUrl.searchParams.get("limit"), "limit")
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
