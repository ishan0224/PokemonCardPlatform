// Uses request.headers (getClientIp) — must be dynamic
export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import {
  PUBLIC_FAIRNESS_AUDIT_CACHE_TTL_SECONDS,
  PUBLIC_FAIRNESS_AUDIT_RATE_LIMIT_PER_IP
} from "@/server/config/constants";
import { getClientIp, handleRouteError } from "@/server/http/api";
import { enforceRateLimit, RateLimitError } from "@/server/middleware/rate-limit";
import { getLatestPublicFairnessAuditResult } from "@/server/services/fairness-audit.service";

async function enforcePublicAuditRateLimit(ip: string): Promise<void> {
  try {
    await enforceRateLimit({
      key: `fairness:audit:public:ip:${ip}`,
      limit: PUBLIC_FAIRNESS_AUDIT_RATE_LIMIT_PER_IP.limit,
      windowSeconds: PUBLIC_FAIRNESS_AUDIT_RATE_LIMIT_PER_IP.windowSeconds
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    console.warn("[fairness-audit-public] rate-limit unavailable, allowing request:", error);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(request);
    await enforcePublicAuditRateLimit(ip);

    const audit = await getLatestPublicFairnessAuditResult();
    if (!audit) {
      return NextResponse.json(
        { error: "AUDIT_NOT_YET_AVAILABLE" },
        {
          status: 503,
          headers: {
            "Retry-After": "3600"
          }
        }
      );
    }

    return NextResponse.json(audit, {
      status: 200,
      headers: {
        "Cache-Control": `public, max-age=${PUBLIC_FAIRNESS_AUDIT_CACHE_TTL_SECONDS}`
      }
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
