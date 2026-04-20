import type { DropStatus } from "../../lib/types";

export type PurchaseRejectCode = "SOLD_OUT" | "DROP_NOT_ACTIVE";

export type InventoryConsumeRoundtripMetricSource =
  | "statement_elapsed_clock_timestamp"
  | "not_collected";

export type InventoryConsumeLockWaitMetricSource = "not_collected";

export type InventoryConsumeTelemetry = {
  inventory_consume_roundtrip_ms: number | null;
  inventory_consume_roundtrip_metric_source: InventoryConsumeRoundtripMetricSource;
  inventory_consume_lock_wait_ms: number | null;
  inventory_consume_lock_wait_metric_source: InventoryConsumeLockWaitMetricSource;
};

function normalizeMs(value: number): number {
  return Number(value.toFixed(3));
}

export function buildInventoryConsumeTelemetry(input: {
  statementElapsedMs?: number | null;
}): InventoryConsumeTelemetry {
  if (typeof input.statementElapsedMs !== "number" || !Number.isFinite(input.statementElapsedMs)) {
    return {
      inventory_consume_roundtrip_ms: null,
      inventory_consume_roundtrip_metric_source: "not_collected",
      inventory_consume_lock_wait_ms: null,
      inventory_consume_lock_wait_metric_source: "not_collected"
    };
  }

  return {
    inventory_consume_roundtrip_ms: normalizeMs(input.statementElapsedMs),
    inventory_consume_roundtrip_metric_source: "statement_elapsed_clock_timestamp",
    inventory_consume_lock_wait_ms: null,
    inventory_consume_lock_wait_metric_source: "not_collected"
  };
}

export function resolvePurchaseRejectCode(input: {
  dropStatus: DropStatus;
  remainingInventory: number;
}): PurchaseRejectCode {
  // Precedence rule: inventory exhaustion is reported before lifecycle status for race consistency.
  if (input.remainingInventory <= 0) {
    return "SOLD_OUT";
  }

  if (input.dropStatus !== "active") {
    return "DROP_NOT_ACTIVE";
  }

  return "SOLD_OUT";
}
