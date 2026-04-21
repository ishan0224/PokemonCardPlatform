import process from "node:process";
import { chromium, type Page } from "playwright-core";

type AxeViolation = {
  id: string;
  impact: string | null;
  description: string;
  nodes: Array<{ target: string[] }>;
};

async function injectAxe(page: Page): Promise<void> {
  await page.addScriptTag({
    url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
  });
}

async function runAxe(page: Page): Promise<AxeViolation[]> {
  return page.evaluate(async () => {
    const axeGlobal = (window as unknown as { axe?: { run: () => Promise<{ violations: AxeViolation[] }> } }).axe;
    if (!axeGlobal) {
      throw new Error("axe-core failed to load.");
    }

    const results = await axeGlobal.run();
    return results.violations;
  });
}

async function maybeLogin(page: Page, baseUrl: string): Promise<void> {
  const email = process.env.CANARY_EMAIL;
  const password = process.env.CANARY_PASSWORD;
  if (!email || !password) {
    return;
  }

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/drops", { timeout: 30_000 });
}

async function main(): Promise<void> {
  const baseUrl = process.env.CANARY_BASE_URL ?? "http://localhost:3000";
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: true,
    executablePath
  });

  const routes = [
    "/",
    "/drops",
    "/marketplace",
    "/collection",
    "/auctions",
    "/verify",
    "/terms",
    "/privacy",
    "/about",
    "/fairness"
  ];

  try {
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    await maybeLogin(page, baseUrl);

    let totalViolations = 0;

    for (const route of routes) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      await injectAxe(page);
      const violations = await runAxe(page);
      totalViolations += violations.length;

      if (violations.length === 0) {
        console.log(`${route}: 0 violations`);
        continue;
      }

      console.log(`${route}: ${violations.length} violations`);
      for (const violation of violations) {
        const firstTarget = violation.nodes[0]?.target?.join(" > ") ?? "unknown";
        console.log(`  - ${violation.id} (${violation.impact ?? "none"}): ${violation.description} @ ${firstTarget}`);
      }
    }

    if (totalViolations > 0) {
      throw new Error(`Axe sweep failed with ${totalViolations} total violations.`);
    }
  } finally {
    await browser.close();
  }
}

void main();
