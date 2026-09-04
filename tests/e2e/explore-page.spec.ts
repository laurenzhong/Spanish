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
  await expect(page.getByRole("heading", { name: "沟通目标" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "内容包" })).toBeVisible();
  await expect(page.getByText("表达资料库")).toHaveCount(0);
  await expect(page.getByText("新的内容包正在审核，先从今天的沟通目标开始。")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /查看.*内容整理中/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /询问近况/ })).toHaveAttribute("href", "/learn?goal=communication.start.check-in");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
});

test("routes every communication goal to its own learn entry", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");

  const goals = [
    ["询问近况", "communication.start.check-in"],
    ["询问姓名", "communication.relationship.ask-name"],
    ["分享兴趣", "communication.relationship.share-interest"],
    ["请求帮助", "communication.need.ask-help"],
    ["回应建议", "communication.response.accept-suggestion"],
    ["询问兴趣", "communication.maintain.ask-interest"],
    ["请求重复", "communication.repair.ask-repeat"],
    ["请求放慢", "communication.repair.ask-slower"],
    ["询问价格", "communication.need.ask-price"],
    ["说明迷路", "communication.navigate.signal-lost"],
    ["保持联系", "communication.end.keep-contact"],
  ] as const;

  for (const [title, goal] of goals) {
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveAttribute(
      "href",
      `/learn?goal=${goal}`,
    );
  }
});

test("opens and closes a clearly labelled local draft preview", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/explore");

  const packButton = page.getByRole("button", { name: /查看.*内容整理中/ });
  await packButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("explore-detail-rail")).toContainText("内容整理中");
  await expect(page.getByRole("link", { name: "打开草稿预览" })).toHaveAttribute("href", "/explore/packs/immersive.first-cafe-conversation");
  await page.getByRole("button", { name: "关闭内容详情" }).click();
  await expect(page.getByTestId("explore-detail-rail")).toHaveCount(0);
  await expect(packButton).toBeFocused();
});

test("follows the draft preview action to the content workspace", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore");
  await page.getByRole("button", { name: /查看.*内容整理中/ }).click();
  await page.getByRole("link", { name: "打开草稿预览" }).click();
  await expect(page).toHaveURL(/\/explore\/packs\/immersive\.first-cafe-conversation$/);
  await expect(page.getByRole("heading", { name: "咖啡馆里的新朋友" })).toBeVisible();
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
    const savedFilter = page.getByRole("button", { name: "已保存" });
    await savedFilter.click();
    await expect(savedFilter).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "全部" }).click();
    await page.getByRole("searchbox").fill("不存在的表达");
    await expect(page.getByText("没有匹配的目标")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll, `explore page overflows at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
  }
});
