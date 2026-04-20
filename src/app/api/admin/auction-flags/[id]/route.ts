import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  mapAuctionFlagRowWithLegacyAliases,
  parseAuctionFlagResolutionBody,
  resolveAuctionFlag
} from "@/server/services/auction-flag.service";

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const adminUser = await requireAdmin(request);

    const flagId = requireUuid(context.params.id, "Flag ID");
    const resolution = parseAuctionFlagResolutionBody(await readJsonBody<unknown>(request));

    const flag = await resolveAuctionFlag({
      flagId,
      adminUserId: adminUser.id,
      resolution
    });

    return NextResponse.json({ flag: mapAuctionFlagRowWithLegacyAliases(flag) }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
