import { expect, test } from "@playwright/test";

const fixtureStableKey = "podcast.e2e-cafe";

test("prioritizes the podcast transcript and shows contextual explanation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/v1/read/word-explanation", (route) => route.fulfill({
    contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "done", explanation: { partOfSpeech: "感叹词", meaning: "早上好", contextualMeaning: "在市场见面时的问候", example: "Buenos días, Ana." } }) + "\n",
  }));
  await page.goto(`/learn/media/${fixtureStableKey}`);
  const playerLocator = page.locator(".media-detail__player");
  const transcriptLocator = page.locator(".media-learning-workbench__transcript");
  await expect(playerLocator).toBeVisible();
  await expect(transcriptLocator).toBeVisible();
  const player = await playerLocator.boundingBox();
  const transcript = await transcriptLocator.boundingBox();
  expect(transcript!.width).toBeGreaterThan(player!.width * 1.8);
  await page.screenshot({ path: testInfo.outputPath("podcast-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "查看词语 Buenos" }).click();
  await expect(page.getByText("在市场见面时的问候")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("podcast-explanation.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("podcast-mobile.png"), fullPage: true });
});

test("keeps the podcast progress bar full width in a dedicated audio layout", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/learn/media/${fixtureStableKey}`);
  const player = page.locator(".podcast-audio-player");
  const progress = player.locator(".rhap_progress-section");
  const controls = player.locator(".rhap_controls-section");
  await expect(player).toBeVisible();
  await expect(progress).toBeVisible();
  await expect(controls).toBeVisible();
  await expect(page.locator(".media-detail__player--podcast .plyr")).toHaveCount(0);

  const playerBox = await player.boundingBox();
  const progressBox = await progress.boundingBox();
  const controlsBox = await controls.boundingBox();
  expect(playerBox).not.toBeNull();
  expect(progressBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(progressBox!.width).toBeGreaterThan(playerBox!.width * 0.9);
  expect(controlsBox!.y).toBeGreaterThanOrEqual(progressBox!.y + progressBox!.height);

  const speed = page.getByLabel("播放速度");
  await expect(speed).toBeVisible();
  await speed.selectOption("1.5");
  await expect(speed).toHaveValue("1.5");
  expect(await page.locator("audio").evaluate((element) => (element as HTMLAudioElement).playbackRate)).toBe(1.5);
  await expect(page.locator("[data-media-auto-pause-control]")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("podcast-audio-layout-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  const mobilePlayerBox = await player.boundingBox();
  const mobileProgressBox = await progress.boundingBox();
  expect(mobilePlayerBox).not.toBeNull();
  expect(mobileProgressBox).not.toBeNull();
  expect(mobileProgressBox!.width).toBeGreaterThan(mobilePlayerBox!.width * 0.9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("podcast-audio-layout-mobile.png"), fullPage: true });
});

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: baseURL!,
  }]);
  await page.addInitScript(() => {
    const positions = new WeakMap<HTMLMediaElement, number>();
    const sources = new WeakMap<HTMLMediaElement, string>();
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() { return positions.get(this) ?? 0; },
      set(value: number) {
        positions.set(this, value);
        (this as HTMLMediaElement).dataset.currentTime = String(value);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      get() { return sources.get(this) ?? ""; },
      set(value: string) {
        sources.set(this, value);
        (this as HTMLMediaElement).dataset.source = value;
      },
    });
    HTMLMediaElement.prototype.load = function () {
      setTimeout(() => {
        this.dispatchEvent(new Event("loadedmetadata"));
        this.dispatchEvent(new Event("canplay"));
      }, 0);
    };
    HTMLMediaElement.prototype.play = function () {
      this.dataset.playing = "true";
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.playing = "false";
      this.dataset.pausedByApp = "true";
      this.dispatchEvent(new Event("pause"));
    };
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === "https://media.example.test/audio/podcast-sample.mp3") {
      await route.fulfill({ contentType: "audio/mpeg", path: "tests/fixtures/media/audio/podcast-sample.mp3" });
      return;
    }
    if (baseURL && url.startsWith(baseURL)) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
});

test("learns from a reviewed podcast with audio, transcript, words, and progress", async ({ page }, testInfo) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Una mañana en el mercado" })).toBeVisible();
  const audio = page.locator("audio");
  await expect(page.getByRole("group", { name: "Una mañana en el mercado 播放器 控制", exact: true })).toBeVisible();
  await expect(audio).toHaveCount(1);
  await expect(page.locator(".media-player-status")).toBeVisible();
  const autoPause = page.locator("[data-media-auto-pause-control]");
  await expect(autoPause).toBeVisible();
  await expect(autoPause).toHaveText("");
  await expect(autoPause.locator("svg")).toBeVisible();
  await expect(page.getByRole("button", { name: /上一句|重播当前句|下一句/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "逐句播放控制" })).toHaveCount(0);

  await page.evaluate(() => {
    const element = document.querySelector("audio")!;
    element.currentTime = 3;
    element.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.getByRole("listitem").nth(1)).toHaveClass(/is-active/);
  await expect(page.locator(".segment-transcript > li").nth(1).locator(".segment-transcript__word.is-speaking")).toHaveCount(1);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const element = document.querySelector("audio")!;
    element.currentTime = 0;
    element.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.getByRole("listitem").nth(0)).toHaveClass(/is-active/);

  await page.keyboard.press("ArrowRight");
  await expect(audio).toHaveAttribute("data-current-time", "2.2");
  await page.keyboard.press("a");
  await expect(audio).toHaveAttribute("data-current-time", "0");

  await page.keyboard.press("q");
  await expect(autoPause).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const element = document.querySelector("audio")!;
    element.currentTime = 2.2;
    element.dispatchEvent(new Event("play"));
  });
  await expect(audio).toHaveAttribute("data-paused-by-app", "true");
  await expect(page.getByText("进度已同步")).toBeVisible();

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
