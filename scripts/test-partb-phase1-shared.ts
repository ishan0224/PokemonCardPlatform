import assert from "node:assert/strict";
import fixture from "../src/lib/fairness/__fixtures__/test-vector.json";
import type {
  CanonicalPackGenerationInput,
  CanonicalPackGenerationOutput,
  CanonicalTestVectorFixture
} from "../src/lib/fairness/hmac-draws";

export function getCanonicalFixture(): CanonicalTestVectorFixture {
  return fixture as CanonicalTestVectorFixture;
}

export function toPackGenerationInput(vector: CanonicalTestVectorFixture): CanonicalPackGenerationInput {
  return {
    tier: vector.tier,
    serverSeedHex: vector.inputs.serverSeedHex,
    clientSeedHex: vector.inputs.clientSeedHex,
    nonce: BigInt(vector.inputs.nonce),
    slots: vector.inputs.slots,
    eligibleCardIdsByRarity: vector.inputs.eligibleCardIdsByRarity,
    enforceUniqueCards: vector.inputs.enforceUniqueCards
  };
}

export function assertMatchesExpected(
  vector: CanonicalTestVectorFixture,
  actual: CanonicalPackGenerationOutput,
  testName: string
): void {
  assert.deepEqual(actual.cards, vector.expected.cards, `[${testName}] card output mismatch.`);
  assert.equal(
    actual.drawCounterConsumed.toString(),
    vector.expected.drawCounterConsumed,
    `[${testName}] drawCounterConsumed mismatch.`
  );
  assert.deepEqual(actual.drawTranscript, vector.expected.drawTranscript, `[${testName}] draw transcript mismatch.`);
}
