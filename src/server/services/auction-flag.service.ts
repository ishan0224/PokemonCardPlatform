import { ApiRouteError } from "../http/api";
import { query } from "../db/pool";

export type AuctionFlagResolution = "dismissed" | "actioned";

export type AuctionFlagRow = {
  id: string;
  auction_id: string;
  flag_type: string;
  evidence_json: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: AuctionFlagResolution | null;
};

export type CreateAuctionFlagInput = {
  auctionId: string;
  flagType: string;
  evidence: Record<string, unknown>;
};

export type ResolveAuctionFlagInput = {
  flagId: string;
  adminUserId: string;
  resolution: AuctionFlagResolution;
};

// Phase 5 B3 auction flag workflow — source plan §475, §11 of detailed plan.
// Auction_flags table already provisioned in Phase 0.

function parseResolution(raw: unknown): AuctionFlagResolution {
  if (raw === "dismissed" || raw === "actioned") {
    return raw;
  }
  throw new ApiRouteError(
    "Resolution must be either 'dismissed' or 'actioned'.",
    400,
    "INVALID_RESOLUTION"
  );
}

export function parseAuctionFlagResolutionBody(body: unknown): AuctionFlagResolution {
  if (!body || typeof body !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }
  return parseResolution((body as { resolution?: unknown }).resolution);
}

export function parseAuctionFlagCreateBody(body: unknown): { flagType: string; evidence: Record<string, unknown> } {
  if (!body || typeof body !== "object") {
    throw new ApiRouteError("Body is required.", 400, "INVALID_BODY");
  }

  const typed = body as { flag_type?: unknown; evidence?: unknown };

  if (typeof typed.flag_type !== "string" || typed.flag_type.trim().length === 0) {
    throw new ApiRouteError("flag_type must be a non-empty string.", 400, "INVALID_FLAG_TYPE");
  }
  if (typed.flag_type.length > 32) {
    throw new ApiRouteError("flag_type must be at most 32 characters.", 400, "INVALID_FLAG_TYPE");
  }
  if (typed.evidence === null || typeof typed.evidence !== "object" || Array.isArray(typed.evidence)) {
    throw new ApiRouteError("evidence must be a JSON object.", 400, "INVALID_EVIDENCE");
  }

  return {
    flagType: typed.flag_type,
    evidence: typed.evidence as Record<string, unknown>
  };
}

export async function createAuctionFlag(input: CreateAuctionFlagInput): Promise<AuctionFlagRow> {
  const result = await query<AuctionFlagRow>(
    `INSERT INTO auction_flags (auction_id, flag_type, evidence_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, auction_id, flag_type, evidence_json, created_at, resolved_at, resolved_by, resolution`,
    [input.auctionId, input.flagType, JSON.stringify(input.evidence)]
  );

  return result.rows[0];
}

export async function resolveAuctionFlag(input: ResolveAuctionFlagInput): Promise<AuctionFlagRow> {
  const result = await query<AuctionFlagRow>(
    `UPDATE auction_flags
     SET resolved_at = now(),
         resolved_by = $2,
         resolution = $3
     WHERE id = $1
       AND resolved_at IS NULL
     RETURNING id, auction_id, flag_type, evidence_json, created_at, resolved_at, resolved_by, resolution`,
    [input.flagId, input.adminUserId, input.resolution]
  );

  if (result.rowCount !== 1) {
    throw new ApiRouteError("Flag not found or already resolved.", 404, "FLAG_NOT_PENDING");
  }

  return result.rows[0];
}
