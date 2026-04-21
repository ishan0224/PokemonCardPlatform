import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type RouteBudget = {
  route: string;
  maxGzipKb: number;
};

const ROUTE_BUDGETS: RouteBudget[] = [
  { route: "/", maxGzipKb: 170 },
  { route: "/drops", maxGzipKb: 200 },
  { route: "/marketplace", maxGzipKb: 200 },
  { route: "/collection", maxGzipKb: 200 },
  { route: "/packs", maxGzipKb: 200 },
  { route: "/packs/[id]/reveal", maxGzipKb: 220 },
  { route: "/admin/drops", maxGzipKb: 220 },
  { route: "/terms", maxGzipKb: 100 },
  { route: "/privacy", maxGzipKb: 100 },
  { route: "/about", maxGzipKb: 100 },
  { route: "/fairness", maxGzipKb: 100 }
];

function parseJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeRouteKey(key: string): string {
  let normalized = key.trim();

  if (normalized.startsWith("app/")) {
    normalized = `/${normalized.slice(4)}`;
  }

  normalized = normalized.replace(/\/\([^/]+\)/g, "");
  normalized = normalized.replace(/\/(page|route)$/, "");
  normalized = normalized.replace(/\/index$/, "");
  normalized = normalized.replace(/\/+/g, "/");

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || "/";
}

function collectRouteChunks(nextDir: string): Map<string, Set<string>> {
  const routeToChunks = new Map<string, Set<string>>();
  const appManifestPath = path.join(nextDir, "app-build-manifest.json");

  if (!fs.existsSync(appManifestPath)) {
    throw new Error(`Missing build manifest: ${appManifestPath}. Run "npm run build" first.`);
  }

  const appManifest = parseJsonFile(appManifestPath) as { pages?: Record<string, string[]> };
  const pages = appManifest.pages ?? {};

  for (const [rawRoute, chunks] of Object.entries(pages)) {
    const normalizedRoute = normalizeRouteKey(rawRoute);
    const jsChunks = chunks.filter((chunk) => chunk.endsWith(".js"));

    if (!routeToChunks.has(normalizedRoute)) {
      routeToChunks.set(normalizedRoute, new Set());
    }

    const bucket = routeToChunks.get(normalizedRoute);
    if (!bucket) {
      continue;
    }

    for (const chunk of jsChunks) {
      bucket.add(chunk);
    }
  }

  return routeToChunks;
}

function gzipBytes(filePath: string): number {
  const raw = fs.readFileSync(filePath);
  return zlib.gzipSync(raw, { level: 9 }).byteLength;
}

function routeGzipKb(nextDir: string, chunks: Set<string>): number {
  let totalBytes = 0;

  for (const chunk of chunks) {
    const chunkPath = path.join(nextDir, chunk);
    if (!fs.existsSync(chunkPath)) {
      continue;
    }
    totalBytes += gzipBytes(chunkPath);
  }

  return totalBytes / 1024;
}

function main(): void {
  const nextDir = path.join(process.cwd(), ".next");
  const routeToChunks = collectRouteChunks(nextDir);
  const failures: Array<{ route: string; actual: number; budget: number }> = [];

  console.log("Frontend route bundle budgets (gzip KB):");

  for (const budget of ROUTE_BUDGETS) {
    const chunks = routeToChunks.get(budget.route);
    if (!chunks) {
      console.log(`- ${budget.route}: missing in manifest (skipped)`);
      continue;
    }

    const actual = routeGzipKb(nextDir, chunks);
    const ok = actual <= budget.maxGzipKb;
    console.log(`- ${budget.route}: ${actual.toFixed(1)} KB / ${budget.maxGzipKb} KB ${ok ? "OK" : "FAIL"}`);

    if (!ok) {
      failures.push({
        route: budget.route,
        actual,
        budget: budget.maxGzipKb
      });
    }
  }

  if (failures.length > 0) {
    const details = failures
      .map((failure) => `${failure.route} (${failure.actual.toFixed(1)} KB > ${failure.budget} KB)`)
      .join(", ");

    throw new Error(`Bundle budget check failed: ${details}`);
  }
}

main();
