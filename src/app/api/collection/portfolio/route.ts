import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { getCollectionPortfolio } from "@/server/services/collection.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await requireAuth(request);
    const portfolio = await getCollectionPortfolio(authUser.userId);
    return NextResponse.json({ portfolio }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
