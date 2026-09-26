import { expect, test, type Page } from "@playwright/test";

const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;
const e2eUserId = "00000000-0000-4000-8000-000000000001";
const viewportWidths = [320, 375, 390, 414, 768, 1024, 1280, 1440];

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

test("uses one responsive workbench for the three starter scenarios", async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");
  for (const title of ["餐厅沟通", "校园办事", "租房沟通"]) await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();

  await page.getByRole("link", { name: /校园办事/ }).click();
  await expect(page.getByRole("heading", { name: "校园办事" })).toBeVisible();
  await page.getByRole("link", { name: /开始实战/ }).click();
  await expect(page.getByText("Javier · 临时人物")).toBeVisible();
  await expect(page.getByPlaceholder("用西班牙语完成你的表达…")).toBeVisible();
  await expect(page.getByRole("button", { name: "按住说话" })).toHaveCount(0);
  await page.getByRole("button", { name: "切换到语音输入" }).click();
  await expect(page.getByRole("button", { name: "按住说话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换到文字输入" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("keeps the scenario detail hierarchy and primary action usable across viewports", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/explore/scenarios/scenario.campus-administration");
    await expect(page.getByRole("heading", { name: "校园办事：注册与材料" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "场景导航" })).toBeVisible();
    await expect(page.getByRole("link", { name: /开始实战/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "沟通目标" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "可用表达" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px overflow`).toBeLessThanOrEqual(width);
  }
});

test("keeps the practice composer usable without horizontal overflow across the release matrix", async ({ page }) => {
  await authenticate(page);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/explore/scenarios/scenario.campus-administration/practice");
    await expect(page.getByPlaceholder("用西班牙语完成你的表达…")).toBeVisible();
    await expect(page.getByRole("button", { name: "切换到语音输入" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px overflow`).toBeLessThanOrEqual(width);
  }
});

test("keeps complete learner turns, triggers one content condition, and shows the basic review", async ({ page }) => {
  await authenticate(page);
  await page.goto("/explore/scenarios/scenario.restaurant-ordering/practice");
  const input = page.getByPlaceholder("用西班牙语完成你的表达…");
  await input.fill("Quería pedir el menú del día.");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Perfecto. ¿Quiere algo más?")).toBeVisible();

  await input.fill("¿Lleva frutos secos?");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你选择的菜品刚好售完，需要换一种。")).toBeVisible();
  await expect(page.getByText("你选择的菜品刚好售完，需要换一种。")).toHaveCount(1);
  await page.getByRole("button", { name: "完成练习" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "完整对话" })).toBeVisible();
  await expect(page.getByText("Quería pedir el menú del día.")).toBeVisible();
  await expect(page.getByText("¿Lleva frutos secos?")).toBeVisible();
});
