import { expect, test } from "@playwright/test";

test("article query failure stays recoverable and retries the same filters", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.config.metadata.articleDatabaseUnavailable !== true, "Requires the isolated database-outage config");
  if (!baseURL) throw new Error("Missing E2E base URL");
  await page.context().addCookies([{
    name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL,
  }]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const path = "/read?search=casa&cefr=A2&page=3";
  await page.goto(path);

  await expect(page.getByRole("heading", { name: "文章暂时无法读取" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "阅读内容类型" })).toBeVisible();
  await expect(page.getByText(/可公开阅读的文章正在准备中|没有找到匹配的文章|Failed query/u)).toHaveCount(0);

  const retry = page.getByRole("button", { name: "重试", exact: true });
  const box = await retry.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/read?*", async (route) => {
    if (route.request().headers()["rsc"] === "1") await gate;
    await route.continue();
  });
  const request = page.waitForRequest((request) => request.url().includes("/read?") && request.headers()["rsc"] === "1");
  await retry.click();
  await request;
  try {
    await expect(page.getByRole("button", { name: "正在重试…" })).toBeDisabled();
    await expect(page.getByRole("alert", { name: "文章暂时无法读取" })).toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("heading", { name: "文章暂时无法读取" })).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}${path}`);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
