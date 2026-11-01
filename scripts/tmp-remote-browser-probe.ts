import { chromium, devices } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

const preview = process.env.PREVIEW_URL?.replace(/\/$/u, "");
const sessionRaw = process.env.PREVIEW_AUTH_SESSION_JSON;
const supabaseUrl = process.env.PREVIEW_SUPABASE_URL;
const publishableKey = process.env.PREVIEW_SUPABASE_PUBLISHABLE_KEY;
if (!preview || !sessionRaw || !supabaseUrl || !publishableKey) throw new Error("missing probe configuration");
const parsed = JSON.parse(sessionRaw) as Record<string, unknown>;
const session = (parsed.session ?? parsed) as Record<string, unknown>;
const cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
const client = createServerClient(supabaseUrl, publishableKey, { cookies: {
  getAll: () => [],
  setAll(values) { cookies.push(...values); },
} });
const setResult = await client.auth.setSession(session as Parameters<typeof client.auth.setSession>[0]);
if (setResult.error || !setResult.data.session) throw new Error(`cookie-session:${setResult.error?.message ?? "missing"}`);
const browser = await chromium.launch({ headless: true });
const result: Record<string, unknown> = { preview, cookieCount: cookies.length, desktop: {}, mobile: {}, errors: [] };
const requestWithRetry = async (page: import("@playwright/test").Page, url: string, attempts = 5) => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await page.request.get(url);
    statuses.push(response.status());
    if (response.status() === 200 || attempt === attempts - 1) return { response, statuses, body: await response.text() };
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error("unreachable");
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: preview, secure: true })));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let historyAborted = false;
  await page.route("**/api/v1/conversations/lucia", async (route) => {
    if (!historyAborted && route.request().method() === "GET") {
      historyAborted = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const response = await page.goto(`${preview}/chat/lucia`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (!response || response.status() !== 200) throw new Error(`page-status:${response?.status() ?? "none"}`);
  await page.getByTestId("conversation-persistence-status").waitFor({ state: "visible", timeout: 30_000 });
  const retry = page.getByTestId("conversation-persistence-status").getByRole("button", { name: "重试" });
  await retry.click();
  await page.getByTestId("conversation-thread").waitFor({ state: "visible", timeout: 60_000 });
  const messages = page.locator(".conversation-message__text");
  await messages.first().waitFor({ state: "visible", timeout: 30_000 });
  const count = await messages.count();
  const text = await messages.allTextContents();
  const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  const apiMe = await requestWithRetry(page, `${preview}/api/v1/me`);
  const apiHistory = await requestWithRetry(page, `${preview}/api/v1/conversations/lucia`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-thread").waitFor({ state: "visible", timeout: 60_000 });
  let afterReload = await page.locator(".conversation-message__text").count();
  let reloadRetry = false;
  if (afterReload === 0) {
    reloadRetry = true;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByTestId("conversation-thread").waitFor({ state: "visible", timeout: 60_000 });
    afterReload = await page.locator(".conversation-message__text").count();
  }
  result.desktop = { pageStatus: response.status(), retryObserved: historyAborted, messageCount: count, firstMessage: text[0], lastMessage: text.at(-1), afterReload, reloadRetry, viewport, apiMe: apiMe.response.status(), apiMeStatuses: apiMe.statuses, apiMeBody: apiMe.body, apiHistory: apiHistory.response.status(), apiHistoryStatuses: apiHistory.statuses, pageErrors: errors };
  await page.close();
  await context.close();

  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  await mobile.addCookies(cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: preview, secure: true })));
  const mobilePage = await mobile.newPage();
  const mobileResponse = await mobilePage.goto(`${preview}/chat/lucia`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await mobilePage.getByTestId("conversation-thread").waitFor({ state: "visible", timeout: 60_000 });
  const mobileMessages = await mobilePage.locator(".conversation-message__text").count();
  const mobileViewport = await mobilePage.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  result.mobile = { pageStatus: mobileResponse?.status() ?? null, messageCount: mobileMessages, viewport: mobileViewport, pageErrors: [] };
  await mobile.close();
  const manifest = await fetch(`${preview}/manifest.webmanifest`);
  result.manifest = { status: manifest.status, body: await manifest.json() };
  const desktopResult = result.desktop as { apiMe?: number; apiHistory?: number; afterReload?: number; messageCount?: number };
  const mobileResult = result.mobile as { pageStatus?: number; messageCount?: number; viewport?: { scrollWidth: number; width: number } };
  if (desktopResult.apiMe !== 200 || desktopResult.apiHistory !== 200 || desktopResult.afterReload !== desktopResult.messageCount) throw new Error(`desktop-assertions:${JSON.stringify(result.desktop)}`);
  if (mobileResult.pageStatus !== 200 || mobileResult.messageCount === 0 || (mobileResult.viewport?.scrollWidth ?? 0) > (mobileResult.viewport?.width ?? 0)) throw new Error(`mobile-assertions:${JSON.stringify(result.mobile)}`);
  if (manifest.status !== 200) throw new Error(`manifest-status:${manifest.status}`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}





