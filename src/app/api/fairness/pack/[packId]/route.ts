import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, requireUuid } from "@/server/http/api";
import { getFairnessPackView } from "@/server/services/fairness-query.service";

export async function GET(
  _request: NextRequest,
  context: { params: { packId: string } }
): Promise<NextResponse> {
  try {
    const packId = requireUuid(context.params.packId, "Pack ID");
    const pack = await getFairnessPackView(packId);
    return NextResponse.json({ pack }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
