import process from "node:process";
import { chromium } from "playwright-core";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = process.env.CANARY_BASE_URL ?? "http://localhost:3000";
  const email = env("CANARY_EMAIL");
  const password = env("CANARY_PASSWORD");
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  const browser = await chromium.launch({
    headless: true,
    executablePath
  });

  try {
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1365, height: 900 }
    });
    const page = await context.newPage();

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("**/drops", { timeout: 30_000 });

    const firstDropLink = page.locator('a[aria-label^="Open drop"]').first();
    await firstDropLink.waitFor({ timeout: 30_000 });
    await firstDropLink.click();

    await page.waitForURL("**/drops/*", { timeout: 30_000 });

    await page.getByRole("button", { name: /buy pack/i }).first().click();
    await page.getByRole("link", { name: /reveal pack/i }).waitFor({ timeout: 30_000 });
    await page.getByRole("link", { name: /reveal pack/i }).click();

    await page.waitForURL("**/packs/*/reveal", { timeout: 30_000 });

    const openPackButton = page.getByRole("button", { name: /^open pack$/i });
    if (await openPackButton.isVisible().catch(() => false)) {
      await openPackButton.click();
    }

    const revealButton = page.getByRole("button", { name: /reveal next slot/i });
    await revealButton.waitFor({ timeout: 30_000 });
    await revealButton.click();

    await page.getByRole("link", { name: /verify this pack/i }).first().click();
    await page.waitForURL("**/fairness/verify/*", { timeout: 30_000 });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByText(/^@/).first().click();
    await page.getByRole("button", { name: /logout/i }).click();
    await page.waitForURL("**/login", { timeout: 30_000 });
  } finally {
    await browser.close();
  }
}

void main();
