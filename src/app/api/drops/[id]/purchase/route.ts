import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { PackTier } from "@/lib/types";
import { RATE_LIMITS } from "@/server/config/constants";
import { ApiRouteError, getClientIp, handleRouteError, readJsonBody, requireUuid } from "@/server/http/api";
import { requireAuth } from "@/server/middleware/auth";
import { enforceRateLimit, RateLimitError } from "@/server/middleware/rate-limit";
import {
  evaluateDropLotteryAdmission,
  type DropLotteryDecision,
  isLotteryStateUnavailableError
} from "@/server/services/drop-lottery.service";
import { purchasePack } from "@/server/services/drop.service";
import { writeSecurityEventFireAndForget } from "@/server/services/security-event.service";

type PurchaseBody = {
  tier: PackTier;
};

const LOTTERY_PENDING_WAIT_BUDGET_MS = 12_000;
const LOTTERY_PENDING_WAIT_MIN_MS = 25;
const LOTTERY_PENDING_WAIT_MAX_MS = 500;

function parseTier(value: unknown): PackTier {
  if (value === "standard" || value === "premium" || value === "elite") {
    return value;
  }

  throw new ApiRouteError("Tier must be one of: standard, premium, elite.", 400, "INVALID_TIER");
}

function computeLotteryPendingWaitMs(inputRetryAfterMs: number, remainingBudgetMs: number): number {
  const boundedRetryAfterMs = Math.min(
    Math.max(Math.trunc(inputRetryAfterMs), LOTTERY_PENDING_WAIT_MIN_MS),
    LOTTERY_PENDING_WAIT_MAX_MS
  );
  return Math.max(Math.min(boundedRetryAfterMs, remainingBudgetMs), 0);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluateLotteryUntilResolved(input: { dropId: string; userId: string }): Promise<Exclude<DropLotteryDecision, { kind: "pending" }>> {
  const deadlineMs = Date.now() + LOTTERY_PENDING_WAIT_BUDGET_MS;

  while (Date.now() <= deadlineMs) {
    const decision = await evaluateDropLotteryAdmission(input);
    if (decision.kind !== "pending") {
      return decision;
    }

    const remainingBudgetMs = Math.max(deadlineMs - Date.now(), 0);
    const waitMs = computeLotteryPendingWaitMs(decision.retryAfterMs, remainingBudgetMs);
    await sleep(waitMs);
  }

  throw new ApiRouteError(
    "Lottery decision could not be finalized in time.",
    503,
    "LOTTERY_DECISION_TIMEOUT"
  );
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
): Promise<NextResponse> {
  const requestKey = request.headers.get("x-request-id") ?? randomUUID();
  const ip = getClientIp(request);

  try {
    const dropId = requireUuid(context.params.id, "Drop ID");

    const authUser = await requireAuth(request);
    let tierForEvidence: PackTier | "unknown" = "unknown";

    try {
      const userLimit = enforceRateLimit({
        key: `pack:purchase:user:${authUser.userId}:${dropId}`,
        ...RATE_LIMITS.packPurchasePerUser
      }).catch((error) => {
        (error as { scope?: "user" | "ip" }).scope = "user";
        throw error;
      });

      const ipLimit = enforceRateLimit({
        key: `pack:purchase:ip:${ip}:${dropId}`,
        ...RATE_LIMITS.packPurchasePerIp
      }).catch((error) => {
        (error as { scope?: "user" | "ip" }).scope = "ip";
        throw error;
      });

      await Promise.all([userLimit, ipLimit]);
    } catch (error) {
      if (error instanceof RateLimitError) {
        const scopedError = error as RateLimitError & { scope?: "user" | "ip" };
        writeSecurityEventFireAndForget({
          eventType: "rate_limit_hit",
          userId: authUser.userId,
          ip,
          requestKey,
          evidence: {
            dropId,
            tier: tierForEvidence,
            scope: scopedError.scope ?? "unknown",
            retryAfterMs: error.details.retryAfterMs,
            remaining: error.details.remaining
          }
        });
      }

      throw error;
    }

    const body = await readJsonBody<PurchaseBody>(request);
    const purchaseTier = parseTier(body?.tier);
    tierForEvidence = purchaseTier;

    try {
      const lotteryDecision = await evaluateLotteryUntilResolved({
        dropId,
        userId: authUser.userId
      });

      if (lotteryDecision.kind === "loser") {
        writeSecurityEventFireAndForget({
          eventType: "lottery_loss",
          userId: authUser.userId,
          ip,
          requestKey,
          evidence: {
            dropId,
            tier: purchaseTier,
            retryAfterMs: lotteryDecision.retryAfterMs
          }
        });

        throw new ApiRouteError("Waiting room lottery was not won.", 429, "WAITING_ROOM_LOST_LOTTERY", {
          retryAfterMs: lotteryDecision.retryAfterMs
        });
      }

      if (lotteryDecision.kind === "winner") {
        writeSecurityEventFireAndForget({
          eventType: "lottery_win",
          userId: authUser.userId,
          ip,
          requestKey,
          evidence: {
            dropId,
            tier: purchaseTier
          }
        });
      }
    } catch (error) {
      if (error instanceof ApiRouteError) {
        throw error;
      }

      if (!isLotteryStateUnavailableError(error)) {
        throw error;
      }

      const typed = error as { message?: string };
      writeSecurityEventFireAndForget({
        eventType: "lottery_unavailable",
        userId: authUser.userId,
        ip,
        requestKey,
        evidence: {
          dropId,
          tier: purchaseTier,
          reason: typed.message ?? "Lottery subsystem unavailable."
        }
      });
    }

    let result;
    try {
      result = await purchasePack({
        userId: authUser.userId,
        dropId,
        tier: purchaseTier
      });
    } catch (error) {
      const typed = error as { code?: string; message?: string; details?: Record<string, unknown> };
      writeSecurityEventFireAndForget({
        eventType: "purchase_failed",
        userId: authUser.userId,
        ip,
        requestKey,
        evidence: {
          dropId,
          tier: purchaseTier,
          code: typed.code ?? "UNKNOWN",
          message: typed.message ?? "Purchase failed.",
          details: typed.details ?? null
        }
      });
      throw error;
    }

    return NextResponse.json({ purchase: result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
