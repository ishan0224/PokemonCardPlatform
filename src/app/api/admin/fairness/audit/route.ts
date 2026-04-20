export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import {
  getLatestFairnessAuditResult,
  getLatestNightlyFairnessAuditResult,
  parseFairnessAuditWindowDays
} from "@/server/services/fairness-audit.service";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const windowDays = parseFairnessAuditWindowDays(request.nextUrl.searchParams.get("window"));
    const source = request.nextUrl.searchParams.get("source");
    const audit =
      source === "nightly"
        ? await getLatestNightlyFairnessAuditResult(windowDays)
        : await getLatestFairnessAuditResult(windowDays);
    if (!audit) {
      return NextResponse.json(
        {
          error: {
            code: "FAIRNESS_AUDIT_NOT_FOUND",
            message: "No fairness audit result found for the requested window."
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ audit }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
