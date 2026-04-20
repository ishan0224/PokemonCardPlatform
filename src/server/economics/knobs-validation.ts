import { PACK_TIERS, type PackTier } from "../../lib/types";
import { ApiRouteError } from "../http/api";
import type { EconomicsSimulateKnobs } from "./rebalance";

const TOP_LEVEL_FIELDS = new Set([
  "anchorScale",
  "ultraRareMaxWeight",
  "chaseMaxWeight",
  "targetEdgeByTier",
  "winRateFloorByTier"
]);

function ensureRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRouteError(`${field} must be an object.`, 400, "INVALID_ECONOMICS_INPUT", { field });
  }

  return value as Record<string, unknown>;
}

function parseOptionalNumber(
  body: Record<string, unknown>,
  field: string,
  range: { min: number; max: number; inclusiveMax?: boolean }
): number | undefined {
  if (!(field in body)) {
    return undefined;
  }

  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiRouteError(`${field} must be a finite number.`, 400, "INVALID_ECONOMICS_INPUT", { field });
  }

  const maxCheck = range.inclusiveMax === false ? value < range.max : value <= range.max;
  if (value < range.min || !maxCheck) {
    const intervalLabel = range.inclusiveMax === false ? `[${range.min}, ${range.max})` : `[${range.min}, ${range.max}]`;
    throw new ApiRouteError(`${field} must be in ${intervalLabel}.`, 400, "INVALID_ECONOMICS_INPUT", {
      field,
      min: range.min,
      max: range.max,
      inclusiveMax: range.inclusiveMax ?? true
    });
  }

  return value;
}

function parseTierOverrideObject(
  body: Record<string, unknown>,
  field: "targetEdgeByTier" | "winRateFloorByTier",
  range: { min: number; max: number; inclusiveMax?: boolean }
): Partial<Record<PackTier, number>> | undefined {
  if (!(field in body)) {
    return undefined;
  }

  const raw = ensureRecord(body[field], field);
  const parsed: Partial<Record<PackTier, number>> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!PACK_TIERS.includes(key as PackTier)) {
      throw new ApiRouteError(`${field} contains unsupported tier key '${key}'.`, 400, "INVALID_ECONOMICS_INPUT", {
        field,
        tier: key,
        allowedTiers: PACK_TIERS
      });
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ApiRouteError(`${field}.${key} must be a finite number.`, 400, "INVALID_ECONOMICS_INPUT", {
        field,
        tier: key
      });
    }

    const maxCheck = range.inclusiveMax === false ? value < range.max : value <= range.max;
    if (value < range.min || !maxCheck) {
      const intervalLabel = range.inclusiveMax === false ? `[${range.min}, ${range.max})` : `[${range.min}, ${range.max}]`;
      throw new ApiRouteError(`${field}.${key} must be in ${intervalLabel}.`, 400, "INVALID_ECONOMICS_INPUT", {
        field,
        tier: key,
        min: range.min,
        max: range.max,
        inclusiveMax: range.inclusiveMax ?? true
      });
    }

    parsed[key as PackTier] = value;
  }

  return parsed;
}

export function parseEconomicsKnobs(bodyUnknown: unknown): EconomicsSimulateKnobs {
  const body = ensureRecord(bodyUnknown, "request_body");

  for (const key of Object.keys(body)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      throw new ApiRouteError(`Unsupported field '${key}' in request body.`, 400, "INVALID_ECONOMICS_INPUT", {
        field: key,
        allowedFields: [...TOP_LEVEL_FIELDS]
      });
    }
  }

  const targetEdgeByTier = parseTierOverrideObject(body, "targetEdgeByTier", {
    min: 0,
    max: 1,
    inclusiveMax: false
  });

  const winRateFloorByTier = parseTierOverrideObject(body, "winRateFloorByTier", {
    min: 0,
    max: 1
  });

  return {
    anchorScale: parseOptionalNumber(body, "anchorScale", { min: 0.01, max: 10 }),
    ultraRareMaxWeight: parseOptionalNumber(body, "ultraRareMaxWeight", { min: 0, max: 1 }),
    chaseMaxWeight: parseOptionalNumber(body, "chaseMaxWeight", { min: 0, max: 1 }),
    targetEdgeByTier,
    winRateFloorByTier
  };
}
