import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { closeDatabasePool } from "../src/server/db/pool";
import { closeRedisClients } from "../src/server/redis/client";
import {
  cleanupPhase2ScenarioState,
  createLegacyScenario,
  createPhase2CreatedState,
  createTamperedCiphertextScenario,
  requirePhase2Env
} from "./test-partb-phase2-scenarios";

type HealthResponse = {
  status: string;
};

type FairnessPackApiResponse = {
  pack: {
    verificationStatus: string;
  };
};

async function pickOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve ephemeral test port.")));
        return;
      }
      const selectedPort = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "GET" });
      if (response.ok) {
        const payload = (await response.json()) as HealthResponse;
        if (payload.status === "ok") {
          return;
        }
      }
    } catch {
      // Keep polling while server boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for server health on port ${port}.`);
}

async function stopServer(serverProcess: ChildProcess): Promise<void> {
  if (serverProcess.killed || serverProcess.exitCode !== null) {
    return;
  }

  serverProcess.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      serverProcess.kill("SIGKILL");
      resolve();
    }, 15_000);
    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn("node", ["--import", "tsx", "server.ts"], {
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const startupLogs: string[] = [];
  const captureLog = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    startupLogs.push(text);
    if (startupLogs.length > 50) {
      startupLogs.shift();
    }
  };
  child.stdout?.on("data", captureLog);
  child.stderr?.on("data", captureLog);

  await Promise.race([
    waitForHealth(port),
    new Promise<never>((_, reject) => {
      child.once("exit", (code, signal) => {
        reject(
          new Error(
            `Server exited before healthcheck (code=${String(code)}, signal=${String(signal)}).\n` +
              `Recent logs:\n${startupLogs.join("")}`
          )
        );
      });
    })
  ]);

  return child;
}

async function fetchPackOverHttp(port: number, packId: string): Promise<{ statusCode: number; payload: FairnessPackApiResponse }> {
  const response = await fetch(`http://127.0.0.1:${port}/api/fairness/pack/${packId}`, {
    method: "GET"
  });
  const payload = (await response.json()) as FairnessPackApiResponse;
  return {
    statusCode: response.status,
    payload
  };
}

async function main(): Promise<void> {
  requirePhase2Env("test:partb:phase2:http");
  const state = createPhase2CreatedState();

  const port = await pickOpenPort();
  const serverProcess = await startServer(port);

  try {
    const tamperedPackId = await createTamperedCiphertextScenario(state, {
      userPrefix: "p2h_tam",
      emailPrefix: "phase2_http_tamper"
    });
    const tamperedResponse = await fetchPackOverHttp(port, tamperedPackId);
    assert.equal(tamperedResponse.statusCode, 200);
    assert.equal(tamperedResponse.payload.pack.verificationStatus, "SEED_DECRYPTION_FAILED");

    const legacyPackId = await createLegacyScenario(state, {
      userPrefix: "p2h_leg",
      emailPrefix: "phase2_http_legacy"
    });
    const legacyResponse = await fetchPackOverHttp(port, legacyPackId);
    assert.equal(legacyResponse.statusCode, 200);
    assert.equal(legacyResponse.payload.pack.verificationStatus, "UNVERIFIABLE_LEGACY_PACK");

    console.log("[test:partb:phase2:http] PASS");
  } finally {
    await Promise.allSettled([cleanupPhase2ScenarioState(state), stopServer(serverProcess)]);
  }
}

main()
  .catch((error) => {
    console.error("[test:partb:phase2:http] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });
