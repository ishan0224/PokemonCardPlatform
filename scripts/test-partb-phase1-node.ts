import { createHmac } from "crypto";
import { generateCanonicalPack, type HmacSha256Fn } from "../src/lib/fairness/hmac-draws";
import { assertMatchesExpected, getCanonicalFixture, toPackGenerationInput } from "./test-partb-phase1-shared";

const nodeHmacSha256: HmacSha256Fn = async (key, message) => {
  return createHmac("sha256", Buffer.from(key)).update(Buffer.from(message)).digest();
};

async function main(): Promise<void> {
  const vector = getCanonicalFixture();
  const input = toPackGenerationInput(vector);
  const actual = await generateCanonicalPack(input, { hmacSha256: nodeHmacSha256 });
  assertMatchesExpected(vector, actual, "test:partb:phase1:node");
  console.log("[test:partb:phase1:node] PASS");
}

main().catch((error) => {
  console.error("[test:partb:phase1:node] FAIL", error);
  process.exitCode = 1;
});

