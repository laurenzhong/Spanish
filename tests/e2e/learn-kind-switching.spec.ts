import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: e2eBaseUrl,
  }]);
}

test("switches media kinds immediately and reuses cached results", async ({ page }) => {
  await authenticate(page);
  let releasePodcastResponse!: () => void;
  const podcastResponseGate = new Promise<void>((resolve) => { releasePodcastResponse = resolve; });
  const requests: string[] = [];
  const pageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("_rsc")) pageRequests.push(request.url());
  });
  await page.route("**/api/v1/media?**", async (route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get("kind") ?? "all";
    requests.push(kind);
    if (kind === "podcast") await podcastResponseGate;
    const item = {
      id: `media.fixture.${kind}@1`, stableKey: `media.fixture.${kind}`, version: 1,
      kind: kind === "podcast" ? "podcast" : "video",
      title: kind === "podcast" ? "Podcast rápido" : "Video rápido",
      summary: "Fixture for responsive library navigation.", sourceName: "Canal de prueba",
      language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 60_000,
      publishedAt: null, curatedAt: "2026-09-23T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [item] }, page: { nextCursor: null, hasMore: false } }) });
  });

  await page.goto("/learn");
  const tabs = page.getByRole("navigation", { name: "学习频道" });
  await tabs.getByRole("link", { name: "视频" }).click();
  await expect(page.getByRole("link", { name: /Video rápido/ })).toBeVisible();
  const startedAt = Date.now();
  await tabs.getByRole("link", { name: "播客" }).click();
  await expect(tabs.getByRole("link", { name: "播客" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("media-library")).toHaveAttribute("aria-busy", "true");
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  expect(requests).toEqual(["video", "podcast"]);
  releasePodcastResponse();
  await expect(page.getByRole("link", { name: /Podcast rápido/ })).toBeVisible();
  await tabs.getByRole("link", { name: "视频" }).click();
  await expect(page.getByRole("link", { name: /Video rápido/ })).toBeVisible();
  expect(requests).toEqual(["video", "podcast"]);
  expect(pageRequests).toEqual([]);
});
