import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  createAuctionFlag,
  parseAuctionFlagCreateBody
} from "@/server/services/auction-flag.service";

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const auctionId = requireUuid(context.params.id, "Auction ID");
    const body = parseAuctionFlagCreateBody(await readJsonBody<unknown>(request));

    const flag = await createAuctionFlag({
      auctionId,
      flagType: body.flagType,
      evidence: body.evidence
    });

    return NextResponse.json({ flag }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
