import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

test("renders the desktop discovery workspace with honest draft state", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/explore");

  await expect(page.getByRole("heading", { name: "探索真实表达" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "把交流拆成可以练习的动作" })).toBeVisible();
  await expect(page.getByRole("button", { name: /查看.*内容整理中/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "询问近况" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
});

test("opens and closes the content detail rail without inventing a route", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/explore");

  const packButton = page.getByRole("button", { name: /查看.*内容整理中/ });
  await packButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("explore-detail-rail")).toContainText("内容整理中");
  await expect(page.getByText("这组内容完成审核后会出现在这里。")).toBeVisible();
  await expect(page.getByRole("link", { name: "开始这组内容" })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭内容详情" }).click();
  await expect(page.getByTestId("explore-detail-rail")).toHaveCount(0);
  await expect(packButton).toBeFocused();
});

test("restores the detail rail from a deep link and keeps the query visible", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/explore?pack=immersive.first-cafe-conversation&q=咖啡馆");

  await expect(page.getByRole("searchbox")).toHaveValue("咖啡馆");
  await expect(page.getByTestId("explore-detail-rail")).toContainText("咖啡馆里的新朋友");
  await page.getByRole("button", { name: "关闭内容详情" }).click();
  await expect(page).toHaveURL(/\/explore\?q=%E5%92%96%E5%95%A1%E9%A6%86/);
});

test("keeps search and layout usable across desktop and mobile widths", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/explore");
    await expect(page.getByRole("searchbox")).toBeVisible();
    await page.getByRole("searchbox").fill("不存在的表达");
    await expect(page.getByText("没有匹配的目标")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `explore page overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
