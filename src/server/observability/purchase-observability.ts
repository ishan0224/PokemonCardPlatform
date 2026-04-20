export type PurchaseObservabilityTag =
  | "purchase_pack"
  | "generation_context_load"
  | "deterministic_generate"
  | "hydrate_cards_batch"
  | "cards_bulk_insert";

export type PurchaseObservabilityPayload = Record<string, unknown>;

export type PurchaseObservabilityEvent = {
  tag: PurchaseObservabilityTag;
  payload: PurchaseObservabilityPayload;
};

export interface PurchaseObservabilitySink {
  emit(event: PurchaseObservabilityEvent): void;
}

class ConsolePurchaseObservabilitySink implements PurchaseObservabilitySink {
  emit(event: PurchaseObservabilityEvent): void {
    console.info(`[observability:${event.tag}] ${JSON.stringify(event.payload)}`);
  }
}

function clampSampleRate(sampleRate: number): number {
  if (!Number.isFinite(sampleRate)) {
    return 1;
  }

  if (sampleRate < 0) {
    return 0;
  }

  if (sampleRate > 1) {
    return 1;
  }

  return sampleRate;
}

export function resolveSampleRate(input: string | undefined): number {
  if (!input) {
    return process.env.NODE_ENV === "production" ? 0.1 : 1;
  }

  const parsed = Number(input);
  return clampSampleRate(parsed);
}

export function shouldEmitObservabilityEvent(input: {
  sampleRate: number;
  randomValue: number;
}): boolean {
  const sampleRate = clampSampleRate(input.sampleRate);
  if (sampleRate <= 0) {
    return false;
  }

  if (sampleRate >= 1) {
    return true;
  }

  return input.randomValue < sampleRate;
}

export function createPurchaseObservabilityEmitter(input: {
  sink: PurchaseObservabilitySink;
  sampleRate: number;
  randomFn?: () => number;
}): (tag: PurchaseObservabilityTag, payload: PurchaseObservabilityPayload) => void {
  const sampleRate = clampSampleRate(input.sampleRate);
  const randomFn = input.randomFn ?? Math.random;

  return (tag, payload) => {
    if (!shouldEmitObservabilityEvent({ sampleRate, randomValue: randomFn() })) {
      return;
    }

    try {
      input.sink.emit({ tag, payload });
    } catch (_error) {
      // Observability must never break request flow.
    }
  };
}

let activeSink: PurchaseObservabilitySink = new ConsolePurchaseObservabilitySink();
let activeSampleRate = resolveSampleRate(process.env.PURCHASE_OBSERVABILITY_SAMPLE_RATE);
let activeRandomFn: () => number = Math.random;

let activeEmitter = createPurchaseObservabilityEmitter({
  sink: activeSink,
  sampleRate: activeSampleRate,
  randomFn: activeRandomFn
});

export function configurePurchaseObservability(input: {
  sink?: PurchaseObservabilitySink;
  sampleRate?: number;
  randomFn?: () => number;
}): void {
  if (input.sink) {
    activeSink = input.sink;
  }

  if (typeof input.sampleRate === "number") {
    activeSampleRate = clampSampleRate(input.sampleRate);
  }

  if (input.randomFn) {
    activeRandomFn = input.randomFn;
  }

  activeEmitter = createPurchaseObservabilityEmitter({
    sink: activeSink,
    sampleRate: activeSampleRate,
    randomFn: activeRandomFn
  });
}

export function emitPurchaseObservability(
  tag: PurchaseObservabilityTag,
  payload: PurchaseObservabilityPayload
): void {
  activeEmitter(tag, payload);
}
