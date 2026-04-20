import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, readJsonBody } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { rebalanceEconomics } from "@/server/economics/rebalance";
import { parseEconomicsKnobs } from "@/server/economics/knobs-validation";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const adminUser = await requireAdmin(request);
    const body = await readJsonBody<unknown>(request);
    const result = await rebalanceEconomics({
      actorUserId: adminUser.id,
      knobs: parseEconomicsKnobs(body)
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
