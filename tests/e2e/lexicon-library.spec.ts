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
  }
});

test("keeps the corpus placeholder explicit and layout usable on phone widths", async ({ page }) => {
  await authenticate(page);
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/read/corpus");
    await expect(page.getByRole("heading", { name: "语料", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "语料查询即将接入" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `reading lexicon overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
