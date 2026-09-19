import { expect, test } from "@playwright/test";

const fixtureStableKey = "video.e2e-hosted";
const detailViewportWidths = [320, 375, 390, 414, 768, 1024, 1280, 1440];

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: baseURL!,
  }]);
  await page.addInitScript(() => {
    const positions = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() { return positions.get(this) ?? 0; },
      set(value: number) {
        positions.set(this, value);
        this.dataset.currentTime = String(value);
        this.dispatchEvent(new Event("timeupdate"));
      },
    });
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
      this.dispatchEvent(new Event("pause"));
    };
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (baseURL && url.startsWith(baseURL)) return route.continue();
    await route.abort("blockedbyclient");
  });
});

test("learns from a Bunny-hosted video with sentence controls, captions, words and progress", async ({ page }) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
  const video = page.getByLabel("Cómo pedir un café 播放器");
  await expect(video).toHaveAttribute("src", "https://media.example.b-cdn.net/media/video.e2e-hosted/1/video.mp4");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "当前片段" })).toContainText("Buenos días.");
  const autoPause = page.locator("[data-media-auto-pause-control]");
  await expect(autoPause).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "自动暂停" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "逐句播放控制" })).toHaveCount(0);
  await expect(page.getByText("播放器已就绪")).toBeVisible();

  await autoPause.click();
  await expect(autoPause).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("q");
  await expect(autoPause).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "双语" }).click();
  await expect(page.getByText("早上好。", { exact: true })).toBeVisible();
  const word = page.getByRole("button", { name: "查看词语 Buenos" });
  await word.click();
  await expect(page.getByRole("dialog", { name: "词句上下文" })).toBeVisible();
  await page.getByRole("button", { name: "关闭词句上下文" }).click();
  await expect(word).toBeFocused();
});

test("moves the word outline and sentence highlight with the native playback clock", async ({ page }) => {
  await page.goto(`/learn/media/${fixtureStableKey}`);
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const video = page.getByLabel("Cómo pedir un café 播放器");
  const setTime = async (seconds: number) => video.evaluate((element, value) => {
    const media = element as HTMLVideoElement;
    media.currentTime = value;
    media.dispatchEvent(new Event("timeupdate"));
  }, seconds);
  const buenos = page.getByRole("button", { name: "查看词语 Buenos", exact: true });
  const dias = page.getByRole("button", { name: "查看词语 días", exact: true });
  await setTime(0.2);
  await expect(buenos).toHaveClass(/is-speaking/);
  await setTime(0.8);
  await expect(buenos).not.toHaveClass(/is-speaking/);
  await expect(dias).toHaveClass(/is-speaking/);
  await setTime(2);
  await expect(page.locator(".segment-transcript > li").nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "查看词语 Quería", exact: true })).toHaveClass(/is-speaking/);
});

test("keeps the media detail usable across planned viewports without horizontal overflow", async ({ page }) => {
  for (const width of detailViewportWidths) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);
    await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
    await expect(page.getByLabel("Cómo pedir un café 播放器")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator("[data-media-auto-pause-control]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("keeps the media detail layout aligned with the learning workspace", async ({ page }, testInfo) => {
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
  await expect.poll(async () => {
    const playerBox = await page.locator(".media-detail__player").boundingBox();
    const transcriptBox = await page.locator(".media-learning-workbench__transcript").boundingBox();
    return Math.abs(transcriptBox!.height - playerBox!.height);
  }).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("video-hosted-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".mobile-product-header")).toBeHidden();
  const mobilePlayer = await page.locator(".media-detail__player").boundingBox();
  expect(mobilePlayer).not.toBeNull();
  expect(mobilePlayer!.x).toBe(0);
  expect(mobilePlayer!.width).toBe(390);
});
