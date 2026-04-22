export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { ApiRouteError, handleRouteError } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { listUserPacks } from "@/server/services/pack.service";

function parseOptionalLimit(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ApiRouteError("limit must be an integer.", 400, "INVALID_LIMIT");
  }

  return parsed;
}

function parseOptionalOpened(value: string | null): boolean | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new ApiRouteError("opened must be true or false.", 400, "INVALID_OPENED");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    const result = await listUserPacks({
      userId: authUser.userId,
      limit: parseOptionalLimit(request.nextUrl.searchParams.get("limit")),
      cursor: request.nextUrl.searchParams.get("cursor"),
      opened: parseOptionalOpened(request.nextUrl.searchParams.get("opened"))
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
