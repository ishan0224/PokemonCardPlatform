import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import type { CanonicalPackGenerationOutput } from "../src/lib/fairness/hmac-draws";
import { assertMatchesExpected, getCanonicalFixture } from "./test-partb-phase1-shared";

function resolveBrowserExecutablePath(): string {
  let playwrightManagedPath: string | null = null;
  try {
    const resolved = chromium.executablePath();
    if (resolved) {
      playwrightManagedPath = resolved;
    }
  } catch {
    playwrightManagedPath = null;
  }

  const candidates = [
    playwrightManagedPath,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      accessSync(resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error(
    "No Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or install Playwright Chromium (`npx playwright install chromium`)."
  );
}

function startLocalSecureContextOrigin(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((_, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>phase1-browser-test</body></html>");
    });

    server.once("error", (error) => reject(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind local browser-test server."));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: async () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}

async function bundleFairnessModuleForBrowser(): Promise<string> {
  const entry = path.resolve(process.cwd(), "src/lib/fairness/hmac-draws.ts");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "Phase1FairnessModule",
    write: false,
    target: ["es2022"]
  });

  const [output] = result.outputFiles ?? [];
  if (!output) {
    throw new Error("Failed to bundle fairness module for browser parity test.");
  }

  return output.text;
}

async function main(): Promise<void> {
  const vector = getCanonicalFixture();
  const bundledModule = await bundleFairnessModuleForBrowser();
  const executablePath = resolveBrowserExecutablePath();
  const localOrigin = await startLocalSecureContextOrigin();

  const browser = await chromium.launch({
    executablePath,
    headless: true
  });

  try {
    const page = await browser.newPage();
    // 127.0.0.1 is treated as a trustworthy origin for Web Crypto in browsers.
    await page.goto(localOrigin.url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: bundledModule });

    const actual = await page.evaluate(async (fixtureVector) => {
      const module = (globalThis as { Phase1FairnessModule?: { generateCanonicalPack?: Function } }).Phase1FairnessModule;
      if (!module?.generateCanonicalPack) {
        throw new Error("Bundled module did not expose generateCanonicalPack.");
      }

      const generated = await module.generateCanonicalPack({
        tier: fixtureVector.tier,
        serverSeedHex: fixtureVector.inputs.serverSeedHex,
        clientSeedHex: fixtureVector.inputs.clientSeedHex,
        nonce: BigInt(fixtureVector.inputs.nonce),
        slots: fixtureVector.inputs.slots,
        eligibleCardIdsByRarity: fixtureVector.inputs.eligibleCardIdsByRarity,
        enforceUniqueCards: fixtureVector.inputs.enforceUniqueCards
      });

      return {
        cards: generated.cards,
        drawCounterConsumed: generated.drawCounterConsumed.toString(),
        drawTranscript: generated.drawTranscript
      };
    }, vector);

    const adapted: CanonicalPackGenerationOutput = {
      cards: actual.cards,
      drawCounterConsumed: BigInt(actual.drawCounterConsumed),
      drawTranscript: actual.drawTranscript
    };

    assert.ok(Array.isArray(actual.drawTranscript), "Browser result must include drawTranscript array.");
    assertMatchesExpected(vector, adapted, "test:partb:phase1:browser");
    console.log("[test:partb:phase1:browser] PASS");
  } finally {
    await localOrigin.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[test:partb:phase1:browser] FAIL", error);
  process.exitCode = 1;
});
