import { expect, test } from "@playwright/test";

const fixtureStableKey = "youtube.e2e-cafe";
const detailViewportWidths = [320, 375, 390, 414, 768, 1024, 1280, 1440];

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: baseURL!,
  }]);
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === "https://www.youtube.com/iframe_api") {
      await route.fulfill({
        contentType: "application/javascript",
        body: `
          window.__videoE2E = { currentTime: 0, pauseCalls: 0, destroyed: false, emit: function () {} };
          window.YT = { Player: function (target, options) {
            var runtime = window.__videoE2E;
            runtime.emit = function (data) { options.events.onStateChange({ data: data }); };
            target.dataset.videoId = options.videoId;
            queueMicrotask(function () { options.events.onReady(); });
            return {
              playVideo: function () { runtime.emit(1); },
              pauseVideo: function () { runtime.pauseCalls += 1; runtime.emit(2); },
              seekTo: function (seconds) { runtime.currentTime = seconds; target.dataset.currentTime = String(seconds); },
              getCurrentTime: function () { return runtime.currentTime; },
              destroy: function () { runtime.destroyed = true; }
            };
          } };
        `,
      });
      return;
    }
    if (baseURL && url.startsWith(baseURL)) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
});

test("learns from a reviewed YouTube video with sentence controls, captions, words and progress", async ({ page }, testInfo) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
  await expect(page.getByLabel("Cómo pedir un café 播放器")).toHaveAttribute("data-video-id", "e2eCafe1234");
  await expect(page.getByRole("group", { name: "当前片段" })).toContainText("Buenos días.");
  await expect(page.getByRole("group", { name: "逐句播放控制" })).toBeVisible();
  await expect(page.getByText("播放器已就绪")).toBeVisible();

  await page.getByRole("button", { name: "下一句" }).click();
  await expect(page.getByLabel("Cómo pedir un café 播放器")).toHaveAttribute("data-current-time", "1.8");
  await page.keyboard.press("a");
  await expect(page.getByLabel("Cómo pedir un café 播放器")).toHaveAttribute("data-current-time", "0");

  await page.keyboard.press("q");
  await expect(page.getByRole("checkbox", { name: "自动暂停" })).toBeChecked();
  await page.evaluate(() => {
    const runtime = window as unknown as Window & { __videoE2E: { currentTime: number; emit: (state: number) => void } };
    runtime.__videoE2E.currentTime = 1.8;
    runtime.__videoE2E.emit(1);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __videoE2E: { pauseCalls: number } }).__videoE2E.pauseCalls)).toBe(1);
  await expect(page.getByText("进度已同步")).toBeVisible();

  await page.getByRole("button", { name: "双语" }).click();
  await expect(page.getByText("早上好。")).toBeVisible();
  const word = page.getByRole("button", { name: "查看词语 Buenos" });
  await word.click();
  const drawer = page.getByRole("dialog", { name: "词句上下文" });
  await expect(drawer).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    const drawerBox = await drawer.boundingBox();
    const navigationBox = await page.getByRole("navigation", { name: "主要导航" }).boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect(drawerBox!.y + drawerBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1);
  }

  await page.getByRole("button", { name: "关闭词句上下文" }).click();
  await expect(word).toBeFocused();
});

test("keeps the video detail usable when the YouTube API cannot load", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", async (route) => {
    await route.abort("failed");
  });
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
  await expect(page.getByText("播放器准备中…")).toBeVisible();
  await expect(page.locator(".video-player-adapter iframe")).toBeVisible({ timeout: 7_000 });
  await expect(page.getByText("播放器已就绪")).toBeVisible();
});

test("uses the bottom-sheet word context at the mobile shell breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  const word = page.getByRole("button", { name: "查看词语 Buenos" });
  await word.click();
  const drawer = page.getByRole("dialog", { name: "词句上下文" });
  const navigation = page.getByRole("navigation", { name: "主要导航" });
  const drawerBox = await drawer.boundingBox();
  const navigationBox = await navigation.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(drawerBox!.x).toBe(0);
  expect(drawerBox!.width).toBe(768);
  expect(drawerBox!.y + drawerBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1);
  await page.getByRole("button", { name: "关闭词句上下文" }).click();
  await expect(word).toBeFocused();
});

test("keeps the media detail workbench usable across planned viewports", async ({ page }) => {
  for (const width of detailViewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

    await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
    await expect(page.getByLabel("Cómo pedir un café 播放器")).toBeVisible();
    await expect(page.getByRole("group", { name: "逐句播放控制" })).toBeVisible();
    await expect(page.getByRole("group", { name: "当前片段" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("keeps detail styling aligned with the dark learning workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.locator(".product-shell")).toHaveCSS("background-color", "rgb(17, 19, 21)");
  const player = await page.locator(".media-detail__player").boundingBox();
  const transcript = await page.locator(".media-learning-workbench__transcript").boundingBox();
  expect(player).not.toBeNull();
  expect(transcript).not.toBeNull();
  expect(player!.x).toBeGreaterThanOrEqual(88);
  expect(player!.width).toBeGreaterThan(transcript!.width);
  expect(transcript!.height).toBeGreaterThanOrEqual(390);

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.reload();
  const tabletPlayer = await page.locator(".media-detail__player").boundingBox();
  const tabletTranscript = await page.locator(".media-learning-workbench__transcript").boundingBox();
  expect(tabletPlayer).not.toBeNull();
  expect(tabletTranscript).not.toBeNull();
  expect(tabletTranscript!.y).toBeGreaterThan(tabletPlayer!.y + tabletPlayer!.height - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".mobile-product-header")).toBeHidden();
  const mobilePlayer = await page.locator(".media-detail__player").boundingBox();
  expect(mobilePlayer).not.toBeNull();
  expect(mobilePlayer!.x).toBe(0);
  expect(mobilePlayer!.width).toBe(390);
});
