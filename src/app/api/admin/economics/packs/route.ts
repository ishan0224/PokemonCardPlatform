import { randomUUID } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getClientIp, handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  buildMarginIncidentEvidence,
  getPackEconomicsBundle,
  resolveEconomicsWindow
} from "@/server/services/economics.service";
import { writeSecurityEventFireAndForget } from "@/server/services/security-event.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestKey = request.headers.get("x-request-id") ?? randomUUID();
  const ip = getClientIp(request);

  try {
    const adminUser = await requireAdmin(request);
    const window = resolveEconomicsWindow(request.nextUrl.searchParams);
    const bundle = await getPackEconomicsBundle(window);
    const incidentEvidence = buildMarginIncidentEvidence(bundle);
    if (incidentEvidence) {
      writeSecurityEventFireAndForget({
        eventType: "margin_incident",
        userId: adminUser.id,
        ip,
        requestKey,
        evidence: incidentEvidence
      });
    }
    return NextResponse.json({ bundle }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
