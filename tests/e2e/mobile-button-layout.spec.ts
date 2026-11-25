import { expect, test, type Locator } from "@playwright/test";

async function expectTargetSize(target: Locator) {
  await expect.poll(async () => {
    const box = await target.boundingBox();
    return Math.min(box?.width ?? 0, box?.height ?? 0);
  }).toBeGreaterThanOrEqual(44);
}

async function expectInlineBounds(target: Locator, boundary: Locator) {
  const outer = (await boundary.boundingBox())!;
  const inner = (await target.boundingBox())!;
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
}

async function expectSelectArrowHit(select: Locator) {
  await expect.poll(() => select.evaluate((element) => {
    const { right, top, height } = element.getBoundingClientRect();
    return document.elementFromPoint(right - 16, top + height / 2) === element;
  })).toBe(true);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: baseURL!,
  }]);
});

test("keeps the complete article filter inside the narrow viewport", async ({ page }) => {
  const toolbar = page.getByRole("region", { name: "文章工具" });
  const filter = toolbar.getByText("筛选", { exact: true });
  const panel = toolbar.locator(".read-filter-menu__panel");
  const difficulty = panel.getByRole("combobox", { name: "难度" });
  const apply = panel.getByRole("button", { name: "应用筛选" });

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/read");
  await filter.click();
  await expect(panel).toBeVisible();
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 667 });
    await expectInlineBounds(panel, toolbar);
    await expectSelectArrowHit(difficulty);
    await expectInlineBounds(apply, toolbar);
  }
  await expectTargetSize(filter);
  await expectTargetSize(toolbar.getByRole("button", { name: "搜索", exact: true }));
  await expectTargetSize(apply);
  await difficulty.selectOption("A2");
  await apply.click();
  await expect(page).toHaveURL(/\bcefr=A2\b/u);
});

test("keeps media filters and floating actions independently operable", async ({ page }) => {
  let browseRequests = 0;
  await page.route("**/api/v1/media/browse", (route) => {
    browseRequests += 1;
    return route.fulfill({ json: {
      apiVersion: "v1",
      data: { items: [] },
      page: { nextCursor: null, hasMore: false },
    } });
  });
  const filter = page.getByRole("button", { name: "筛选", exact: true });
  const panel = page.getByRole("dialog", { name: "筛选内容" });
  const duration = panel.getByRole("combobox", { name: "时长" });
  const browse = page.getByRole("button", { name: "换一批" });

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/learn");
  await expect(browse).toBeVisible();
  await filter.click();
  await expect(panel).toBeVisible();
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 375, height: 667 },
    { width: 430, height: 932 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await duration.scrollIntoViewIfNeeded();
    await expectSelectArrowHit(duration);
    await expect(browse).toBeHidden();
  }
  await panel.getByRole("button", { name: "关闭筛选" }).click();
  await expect(browse).toBeVisible();
  await expect(filter).toBeFocused();
  expect(browseRequests).toBe(0);

  const navigation = page.getByRole("navigation", { name: "学习频道" });
  await page.setViewportSize({ width: 320, height: 640 });
  for (const label of ["全部", "视频", "播客"]) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expectInlineBounds(link, navigation);
    await expectTargetSize(link);
  }
  await expectTargetSize(filter);
  await expectTargetSize(page.getByRole("button", { name: "提交搜索" }));
});

async function expectAllLinksFit(navigation: Locator) {
  await expect(navigation).toBeVisible();
  for (const link of await navigation.getByRole("link").all()) {
    await expectInlineBounds(link, navigation);
    await expectTargetSize(link);
  }
}

test("keeps Saved and Preferences discoverable at 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/read");
  const reading = page.getByRole("navigation", { name: "阅读内容类型" });
  await expectAllLinksFit(reading);
  await reading.getByRole("link", { name: "已保存" }).click();
  await expect(page).toHaveURL(/\/read\/saved-items/u);

  await page.goto("/me");
  const profile = page.getByRole("navigation", { name: "我的页面分区" });
  await expectAllLinksFit(profile);
  const preferences = profile.getByRole("link", { name: "偏好设置" });
  await preferences.click();
  await expect(preferences).toHaveAttribute("aria-current", "page");
});
