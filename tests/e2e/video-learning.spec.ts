import { expect, test } from "@playwright/test";
import { installMediaWordTools } from "./fixtures/media-word-tools";

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
  await installMediaWordTools(page);
  await page.addInitScript(() => {
    const playAudio = HTMLMediaElement.prototype.play;
    const pauseAudio = HTMLMediaElement.prototype.pause;
    const loadAudio = HTMLMediaElement.prototype.load;
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
      if (this instanceof HTMLAudioElement) return loadAudio.call(this);
      setTimeout(() => this.dispatchEvent(new Event("canplay")), 0);
    };
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement) return playAudio.call(this);
      this.dataset.playing = "true";
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      if (this instanceof HTMLAudioElement) return pauseAudio.call(this);
      this.dataset.playing = "false";
      this.dispatchEvent(new Event("pause"));
    };
  });
});

test("follows and navigates the reviewed transcript past 500 cues to its tail", async ({ page }) => {
  await page.goto("/learn/media/video.e2e-complete-transcript");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const video = page.locator(".media-detail__player video");
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 846 * 3_850 / 1_000 + 0.1;
    element.dispatchEvent(new Event("timeupdate"));
  });
  // A distant active cue is available before all background rows finish mounting.
  await expect(page.locator("#segment-846 [data-active-word='true']")).toHaveText("Hola");
  await expect(page.locator(".segment-transcript > li")).toHaveCount(848);
  await expect(video).toHaveAttribute("data-current-time", String(846 * 3_850 / 1_000 + 0.1));
  // Let the committed index reach the keyboard effect before sending a key.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.press("ArrowRight");
  await expect(video).toHaveAttribute("data-current-time", String(847 * 3_850 / 1_000));
  await expect(page.locator("#segment-847 [data-active-word='true']")).toHaveText("Hola");
  await page.getByRole("button", { name: "双语" }).click();
  await expect(page.locator("#segment-847").getByText("字幕 848")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(video).toHaveAttribute("data-current-time", String(846 * 3_850 / 1_000));
});

test("keeps a licensed native video in the shared learning workbench", async ({ page }) => {
  await page.goto(`/learn/media/${encodeURIComponent(nativeFixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Una historia breve" })).toBeVisible();
  const video = page.locator(".media-detail__player video");
  const player = page.locator(".media-detail__player .plyr");
  await expect(player).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "自动暂停" })).toHaveCount(0);
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
  // Repeated position/ready updates must keep the original visible player and
  // its controls attached; a status label alone does not prove playback survives.
  const originalVideo = await video.elementHandle();
  await page.evaluate(async () => {
    const element = document.querySelector<HTMLVideoElement>(".media-detail__player video")!;
    for (let step = 1; step <= 30; step += 1) {
      element.currentTime = step / 10;
      element.dispatchEvent(new Event("timeupdate"));
      if (step % 5 === 0) element.dispatchEvent(new Event("canplay"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    element.dispatchEvent(new Event("pause"));
  });
  await expect(page.getByText("进度已同步")).toBeVisible();
  expect(await originalVideo!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(player.locator(".plyr__controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "开启自动暂停" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "自动暂停" })).toHaveCount(0);
});

test("follows long subtitles in the center and respects the follow switch", async ({ page }, testInfo) => {
  await page.goto("/learn/media/video.e2e-long-transcript");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const transcript = page.locator(".segment-transcript");
  await expect(transcript.locator("li")).toHaveCount(30);
  const position = async (seconds: number) => page.evaluate((value) => {
    const video = document.querySelector<HTMLVideoElement>(".media-detail__player video")!;
    video.currentTime = value;
    video.dispatchEvent(new Event("timeupdate"));
  }, seconds);
  const geometry = () => transcript.evaluate((list) => {
    const row = list.querySelector(".is-active")!.getBoundingClientRect();
    const pane = list.getBoundingClientRect();
    const scrollable = list.scrollHeight > list.clientHeight;
    return {
      activeId: list.querySelector(".is-active")!.id,
      centerError: Math.abs(row.top + row.height / 2 - (scrollable ? pane.top + list.clientHeight / 2 : innerHeight / 2)),
      scrollTop: list.scrollTop, pageTop: scrollY,
    };
  });
  const initialPageTop = await page.evaluate(() => scrollY);
  await position(24);
  await expect(transcript.locator(".is-active")).toHaveAttribute("id", "segment-12");
  await expect.poll(async () => (await geometry()).centerError).toBeLessThan(2);
  if (testInfo.project.name === "desktop-chromium") expect((await geometry()).pageTop).toBe(initialPageTop);

  const follow = page.getByRole("button", { name: "自动滚动到当前句" });
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  const paused = await geometry();
  await position(36);
  await expect(transcript.locator(".is-active")).toHaveAttribute("id", "segment-18");
  expect((await geometry()).scrollTop).toBe(paused.scrollTop);
  expect((await geometry()).pageTop).toBe(paused.pageTop);
  await follow.click();
  await expect.poll(async () => (await geometry()).centerError).toBeLessThan(2);

  await page.getByRole("button", { name: "双语", exact: true }).click();
  await expect.poll(async () => (await geometry()).centerError).toBeLessThan(2);
  await page.getByRole("button", { name: "隐藏", exact: true }).click();
  await expect(transcript).toHaveCount(0);
  await page.getByRole("button", { name: "西语", exact: true }).click();
  await expect.poll(async () => (await geometry()).centerError).toBeLessThan(2);
});

test("opens exact corpus time and segment before restoring media progress", async ({ page }) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}?t=4250&segment=2#segment-2`);
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  const youtube = page.locator('.video-player-adapter .plyr[aria-label="Cómo pedir un café 播放器"]');
  await expect(youtube).toHaveAttribute("data-current-time", "4.25");
  await expect(page.locator("#segment-2")).toHaveClass(/is-active/u);
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}?t=0&segment=2#segment-2`);
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await expect(page.locator("#segment-0")).toHaveClass(/is-active/u);
});

test("learns from a reviewed YouTube video with sentence controls, captions, words and progress", async ({ page }, testInfo) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Cómo pedir un café" })).toBeVisible();
  const youtube = page.locator('.video-player-adapter .plyr[aria-label="Cómo pedir un café 播放器"]');
  await expect(youtube).toHaveAttribute("data-media-player", "plyr");
  await expect(youtube).toHaveAttribute("data-media-player-version", "3.8.4");
  await expect(youtube).toHaveAttribute("data-plyr-embed-id", "e2eCafe1234");
  await expect(page.getByText("播放器已就绪")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "自动暂停" })).toHaveCount(0);

  // Imported subtitles carry S1/S2 diarization indexes. They stay in the stored
  // timeline but must never be printed as if they were speaker names.
  const transcript = page.locator(".segment-transcript");
  await expect(transcript).not.toContainText("S1");
  await expect(transcript).not.toContainText("S2");
  await expect(transcript.locator("strong")).toHaveCount(0);
  await expect(page.locator("#segment-0")).toContainText("Buenos días");
  await expect(page.locator("#segment-1")).toContainText("Quería un café con leche");
  await transcript.screenshot({ path: testInfo.outputPath("subtitle-speaker-labels.png") });

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
  await expect(drawer.getByText("好的", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "查看语料用法" })).toHaveAttribute("href", "/read/corpus?q=Buenos&match=surface");

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

test("looks up subtitles, speaks only the word and automatically explains its actual context", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 740 });
  const explanations: unknown[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/word-explanation")) explanations.push(request.postDataJSON()); });
  await page.goto(`/learn/media/${nativeFixtureStableKey}`);
  await expect(page.getByText("播放器已就绪", { exact: true })).toBeVisible();
  const word = page.getByRole("button", { name: "查看词语 café" });
  await word.click();
  const panel = page.getByRole("dialog", { name: "词句上下文" });
  await expect(panel.locator(".lexical-drawer__meanings").getByText("咖啡", { exact: true })).toBeVisible();
  await expect(panel.getByText("Quería un café con leche.", { exact: true })).toBeVisible();
  await expect(panel.getByText("这里指一杯咖啡。", { exact: true })).toBeVisible();
  await expect(panel.getByText("单词朗读 · 合成音", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/按需生成|词典暂未收录/)).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "解释这句中的用法" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "关闭词句上下文" })).toBeFocused();
  await panel.getByRole("button", { name: "朗读单词" }).click();
  await expect(panel.getByText("正在朗读 · 合成音", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __wordSpeech: unknown }).__wordSpeech)).toEqual({ text: "café", lang: "es-ES" });
  await panel.getByRole("button", { name: "停止朗读" }).click();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("media-word-panel.png") });
  expect(explanations).toEqual([{ word: "café", context: "Quería un café con leche.", locale: "es-ES", selectionType: "word" }]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(word).toBeFocused();
});
