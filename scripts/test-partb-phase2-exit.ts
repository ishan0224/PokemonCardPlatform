import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { closeDatabasePool } from "../src/server/db/pool";
import { closeRedisClients } from "../src/server/redis/client";
import { GET as getFairnessPackRoute } from "../src/app/api/fairness/pack/[packId]/route";
import {
  getVerificationStatusLabel,
  isVerificationGreen,
  shouldShowLegacyBanner,
  type FairnessVerificationStatus
} from "../src/lib/fairness/verifier-ui";
import {
  cleanupPhase2ScenarioState,
  createLegacyScenario,
  createPhase2CreatedState,
  createTamperedCiphertextScenario,
  requirePhase2Env
} from "./test-partb-phase2-scenarios";

type PackApiResponse = {
  pack: {
    verificationStatus: FairnessVerificationStatus;
    verificationError: string | null;
  };
};

async function fetchPackViaApi(packId: string): Promise<{ statusCode: number; payload: PackApiResponse }> {
  const request = new NextRequest(`http://localhost/api/fairness/pack/${packId}`);
  const response = await getFairnessPackRoute(request, { params: { packId } });
  const payload = (await response.json()) as PackApiResponse;
  return {
    statusCode: response.status,
    payload
  };
}

async function main(): Promise<void> {
  requirePhase2Env("test:partb:phase2:exit");
  const state = createPhase2CreatedState();

  try {
    const tamperedPackId = await createTamperedCiphertextScenario(state, {
      userPrefix: "p2_tam",
      emailPrefix: "phase2_tamper"
    });
    const tamperedResponse = await fetchPackViaApi(tamperedPackId);
    assert.equal(tamperedResponse.statusCode, 200);
    assert.equal(tamperedResponse.payload.pack.verificationStatus, "SEED_DECRYPTION_FAILED");
    assert.equal(isVerificationGreen({ status: tamperedResponse.payload.pack.verificationStatus, overallPass: false }), false);
    assert.equal(getVerificationStatusLabel(tamperedResponse.payload.pack.verificationStatus), "Seed Decryption Failed");

    const legacyPackId = await createLegacyScenario(state, {
      userPrefix: "p2_leg",
      emailPrefix: "phase2_legacy"
    });
    const legacyResponse = await fetchPackViaApi(legacyPackId);
    assert.equal(legacyResponse.statusCode, 200);
    assert.equal(legacyResponse.payload.pack.verificationStatus, "UNVERIFIABLE_LEGACY_PACK");
    assert.equal(shouldShowLegacyBanner(legacyResponse.payload.pack.verificationStatus), true);
    assert.equal(getVerificationStatusLabel(legacyResponse.payload.pack.verificationStatus), "Legacy Pack");

    console.log("[test:partb:phase2:exit] PASS");
  } finally {
    await cleanupPhase2ScenarioState(state);
  }
}

main()
  .catch((error) => {
    console.error("[test:partb:phase2:exit] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });
