import assert from "node:assert/strict";
import {
  createPurchaseObservabilityEmitter,
  shouldEmitObservabilityEvent,
  type PurchaseObservabilityEvent,
  type PurchaseObservabilitySink
} from "../src/server/observability/purchase-observability";
import { buildInventoryConsumeTelemetry, resolvePurchaseRejectCode } from "../src/server/services/purchase-hardening.service";

class MemorySink implements PurchaseObservabilitySink {
  public readonly events: PurchaseObservabilityEvent[] = [];

  emit(event: PurchaseObservabilityEvent): void {
    this.events.push(event);
  }
}

function runMetricSemanticsTest(): void {
  const metric = buildInventoryConsumeTelemetry({ statementElapsedMs: 12.34567 });

  assert.equal(metric.inventory_consume_roundtrip_ms, 12.346);
  assert.equal(metric.inventory_consume_roundtrip_metric_source, "statement_elapsed_clock_timestamp");
  assert.equal(metric.inventory_consume_lock_wait_ms, null);
  assert.equal(metric.inventory_consume_lock_wait_metric_source, "not_collected");

  const missingMetric = buildInventoryConsumeTelemetry({ statementElapsedMs: null });
  assert.equal(missingMetric.inventory_consume_roundtrip_ms, null);
  assert.equal(missingMetric.inventory_consume_roundtrip_metric_source, "not_collected");
}

function runObservabilitySamplingTest(): void {
  assert.equal(shouldEmitObservabilityEvent({ sampleRate: 1, randomValue: 0.99 }), true);
  assert.equal(shouldEmitObservabilityEvent({ sampleRate: 0, randomValue: 0.01 }), false);
  assert.equal(shouldEmitObservabilityEvent({ sampleRate: 0.5, randomValue: 0.4 }), true);
  assert.equal(shouldEmitObservabilityEvent({ sampleRate: 0.5, randomValue: 0.8 }), false);

  const sink = new MemorySink();
  const emitNever = createPurchaseObservabilityEmitter({
    sink,
    sampleRate: 0,
    randomFn: () => 0
  });
  emitNever("purchase_pack", { marker: "skip" });
  assert.equal(sink.events.length, 0);

  const emitAlways = createPurchaseObservabilityEmitter({
    sink,
    sampleRate: 1,
    randomFn: () => 0.99
  });
  emitAlways("purchase_pack", { marker: "keep" });

  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0].tag, "purchase_pack");
  assert.equal(sink.events[0].payload.marker, "keep");
}

function runRejectionPrecedenceTest(): void {
  assert.equal(resolvePurchaseRejectCode({ dropStatus: "active", remainingInventory: 0 }), "SOLD_OUT");
  assert.equal(resolvePurchaseRejectCode({ dropStatus: "completed", remainingInventory: 0 }), "SOLD_OUT");
  assert.equal(resolvePurchaseRejectCode({ dropStatus: "completed", remainingInventory: 2 }), "DROP_NOT_ACTIVE");
}

function main(): void {
  runMetricSemanticsTest();
  runObservabilitySamplingTest();
  runRejectionPrecedenceTest();
  console.log("[test:n1:hardening] PASS");
}

main();
