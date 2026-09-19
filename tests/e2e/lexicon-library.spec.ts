import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: e2eBaseUrl }]);
}

test("keeps vocabulary and phrase shelves directly reachable from reading", async ({ page }) => {
  await authenticate(page);
  for (const [path, heading, emptyHeading] of [["/read/vocabulary", "词汇", "还没有词汇"], ["/read/phrases", "短语", "还没有短语"]] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(heading));
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: emptyHeading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "阅读内容类型" })).toBeVisible();
    await expect(page.getByLabel("学习状态")).toBeVisible();
  }
  await page.goto("/read/vocabulary");
  await expect(page.getByLabel("词元状态")).toBeVisible();
  await page.goto("/read/phrases");
  await expect(page.getByLabel("语用目的")).toBeVisible();
  await expect(page.getByLabel("语域")).toBeVisible();
  await expect(page.getByLabel("地区")).toBeVisible();
  await expect(page.getByLabel("CEFR")).toBeVisible();
});

test("keeps the corpus placeholder explicit and layout usable on phone widths", async ({ page }) => {
  await authenticate(page);
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 760 });
    for (const path of ["/read/vocabulary", "/read/phrases", "/read/corpus"]) {
      await page.goto(path);
      const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll, `${path} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    }
  }
});
