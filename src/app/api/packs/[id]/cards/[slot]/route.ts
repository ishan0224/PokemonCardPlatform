import { type NextRequest, NextResponse } from "next/server";
import { ApiRouteError, handleRouteError, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { revealCard } from "@/server/services/pack.service";

function parseSlotNumber(raw: string): number {
  const slotNumber = Number(raw);

  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 20) {
    throw new ApiRouteError("Slot must be an integer between 1 and 20.", 400, "INVALID_SLOT");
  }

  return slotNumber;
}

export async function GET(
  request: NextRequest,
  context: { params: { id: string; slot: string } }
): Promise<NextResponse> {
  try {
    const packId = requireUuid(context.params.id, "Pack ID");

    const slotNumber = parseSlotNumber(context.params.slot);
    const authUser = await requireAuth(request);

    const card = await revealCard({
      userId: authUser.userId,
      packId,
      slotNumber
    });

    return NextResponse.json({ card }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
