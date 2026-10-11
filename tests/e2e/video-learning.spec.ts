import { expect, test } from "@playwright/test";

const fixtureStableKey = "youtube.e2e-cafe";
const nativeFixtureStableKey = "video.e2e-native";

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: "spanish-e2e-user",
    value: "00000000-0000-4000-8000-000000000001",
    url: baseURL!,
  }]);
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("https://www.youtube.com/iframe_api")) {
      await route.fulfill({
        contentType: "application/javascript",
        body: `
          window.__videoE2E = { currentTime: 0, pauseCalls: 0, destroyed: false, emit: function () {} };
          window.YT = { Player: function (target, options) {
            var runtime = window.__videoE2E;
            runtime.emit = function (data) { options.events.onStateChange({ data: data, target: api }); };
            target.dataset.videoId = options.videoId;
            var api = {
              playVideo: function () { runtime.emit(1); },
              pauseVideo: function () { runtime.pauseCalls += 1; runtime.emit(2); },
              seekTo: function (seconds) { runtime.currentTime = seconds; target.dataset.currentTime = String(seconds); },
              getCurrentTime: function () { return runtime.currentTime; },
              getDuration: function () { return 6; },
              getPlaybackRate: function () { return 1; },
              setPlaybackRate: function () {},
              getAvailablePlaybackRates: function () { return [0.5, 1, 1.5, 2]; },
              getVideoLoadedFraction: function () { return 1; },
              getVideoUrl: function () { return "https://www.youtube.com/watch?v=" + options.videoId; },
              mute: function () {},
              unMute: function () {},
              setVolume: function () {},
              stopVideo: function () { runtime.emit(0); },
              destroy: function () { runtime.destroyed = true; }
            };
            queueMicrotask(function () { options.events.onReady({ target: api }); });
            return api;
          } };
          if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
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

test.beforeEach(async ({ page }) => {
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
      setTimeout(() => this.dispatchEvent(new Event("canplay")), 0);
    };
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
});

test("keeps a licensed native video in the shared learning workbench", async ({ page }) => {
  await page.goto(`/learn/media/${encodeURIComponent(nativeFixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Una historia breve" })).toBeVisible();
  const video = page.locator(".media-detail__player video");
  const player = page.locator(".media-detail__player .plyr");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("data-media-player", "plyr");
  await expect(player).toHaveAttribute("data-media-player-version", "3.8.4");
  await expect(video).not.toHaveAttribute("controls");
  await expect(video).toHaveAttribute("data-source", "https://media.example.test/video/sample.mp4");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  // Sentence navigation is keyboard-only by product decision.
  await page.keyboard.press("ArrowRight");
  await expect(video).toHaveAttribute("data-current-time", "1.8");
  await page.getByRole("button", { name: "双语" }).click();
  await expect(page.getByText("早上好。")).toBeVisible();
});

test("learns from a reviewed YouTube video with sentence controls, captions, words and progress", async ({ page }, testInfo) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
  const youtube = page.locator('.video-player-adapter .plyr[aria-label="Cómo pedir un café 播放器"]');
  await expect(youtube).toHaveAttribute("data-media-player", "plyr");
  await expect(youtube).toHaveAttribute("data-media-player-version", "3.8.4");
  await expect(youtube).toHaveAttribute("data-plyr-embed-id", "e2eCafe1234");
  await expect(page.getByText("播放器已就绪")).toBeVisible();

  // Sentence navigation is keyboard-only by product decision.
  await page.keyboard.press("ArrowRight");
  await expect(youtube).toHaveAttribute("data-current-time", "1.8");
  await expect(page.getByRole("button", { name: "查看词语 Quería" })).toHaveAttribute("data-active-word", "true");
  await page.keyboard.press("a");
  await expect(youtube).toHaveAttribute("data-current-time", "0");

  await page.keyboard.press("q");
  await expect(page.getByRole("button", { name: "关闭自动暂停" })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const runtime = window as unknown as Window & { __videoE2E: { currentTime: number; emit: (state: number) => void } };
    runtime.__videoE2E.currentTime = 1.8;
    runtime.__videoE2E.emit(1);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { __videoE2E: { pauseCalls: number } }).__videoE2E.pauseCalls)).toBe(1);
  await expect(page.getByText("进度已同步")).toBeVisible();

  await page.getByRole("button", { name: "双语" }).click();
  await expect(page.getByText("早上好。")).toBeVisible();
  await page.evaluate(() => {
    const runtime = window as unknown as Window & { __videoE2E: { currentTime: number; emit: (state: number) => void } };
    runtime.__videoE2E.currentTime = 900 / 1000;
    runtime.__videoE2E.emit(1);
  });
  await expect(page.getByRole("button", { name: "查看词语 días" })).toHaveAttribute("data-active-word", "true");
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
