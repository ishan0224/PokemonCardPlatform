export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { listAdminCardSets } from "@/server/services/admin-card-catalog.service";

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

const listAdminCardSetsCached = unstable_cache(
  async (cursor: string | null, limit: number | undefined) => {
    return listAdminCardSets({ cursor, limit });
  },
  ["admin-card-sets"],
  { revalidate: 3600 }
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = parseOptionalLimit(request.nextUrl.searchParams.get("limit"));

    const result = await listAdminCardSetsCached(cursor, limit);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
