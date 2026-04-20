export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/server/http/api";
import { requireAdmin } from "@/server/middleware/admin";
import { runFairnessAudit } from "@/server/services/fairness-audit.service";

const ON_DEMAND_WARNING =
  "Nightly run uses 100k MC calibration; on-demand is approximate.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin(request);

    const audit = await runFairnessAudit({
      runSource: "on_demand",
      windowDays: 7,
      monteCarloSamples: 10_000
    });

    return NextResponse.json(
      {
        audit,
        warning: ON_DEMAND_WARNING
      },
      { status: 200 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
