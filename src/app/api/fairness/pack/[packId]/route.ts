export const dynamic = "force-dynamic";

import { randomUUID } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getClientIp, handleRouteError, requireUuid } from "@/server/http/api";
import { getAccessTokenFromRequest } from "@/server/middleware/auth";
import { getFairnessPackView } from "@/server/services/fairness-query.service";
import { writeSecurityEventFireAndForget } from "@/server/services/security-event.service";
import { validateSupabaseAccessToken } from "@/server/supabase/client";

async function resolveViewerUserId(request: NextRequest): Promise<string | null> {
  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) {
    return null;
  }

  try {
    const user = await validateSupabaseAccessToken(accessToken);
    return user.userId;
  } catch (_error) {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: { packId: string } }
): Promise<NextResponse> {
  const requestKey = request.headers.get("x-request-id") ?? randomUUID();
  const ip = getClientIp(request);

  try {
    const userId = await resolveViewerUserId(request);
    const packId = requireUuid(context.params.packId, "Pack ID");
    const pack = await getFairnessPackView(packId);
    writeSecurityEventFireAndForget({
      eventType: "fairness_verification_run",
      userId,
      ip,
      requestKey,
      evidence: {
        packId: pack.packId,
        dropId: pack.dropId,
        verificationStatus: pack.verificationStatus
      }
    });
    return NextResponse.json({ pack }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
