import { expect, test } from "@playwright/test";
import { installMediaWordTools } from "./fixtures/media-word-tools";

const fixtureStableKey = "podcast.e2e-cafe";
const longFixtureStableKey = "podcast.e2e-long-transcript";

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
      setTimeout(() => this.dispatchEvent(new Event("canplay")), 0);
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
  await installMediaWordTools(page);
});

test("shows the compact podcast loading skeleton before the content arrives", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: testInfo.project.name === "mobile-chromium" ? 375 : 1440, height: 900 });
  await page.goto("/learn/media/podcast.e2e-loading", { waitUntil: "commit" });
  const loading = page.locator(".media-detail--loading");
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading.locator(".media-learning-workbench")).toHaveClass(/media-learning-workbench--podcast/);
  await expect(loading.locator(".media-current-segment")).toHaveCount(0);
  const player = await loading.locator(".media-detail__player--audio-loading").boundingBox();
  const transcript = await loading.locator(".media-learning-workbench__transcript").boundingBox();
  expect(player).not.toBeNull();
  expect(transcript).not.toBeNull();
  expect(player!.height).toBeLessThan(150);
  expect(player!.width).toBeLessThanOrEqual(960);
  expect(transcript!.y).toBeGreaterThanOrEqual(player!.y + player!.height);
  expect(Math.abs(transcript!.width - player!.width)).toBeLessThan(2);
  const seek = await loading.locator(".media-loading-audio-controls__seek").boundingBox();
  expect(seek!.width).toBeGreaterThan(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("podcast-loading.png"), fullPage: true });
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Una mañana en el mercado" })).toBeVisible();
  await expect(page.locator(".media-detail__player .plyr")).toBeVisible();
});

test("learns from a reviewed podcast with audio, transcript, words, and progress", async ({ page }, testInfo) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Una mañana en el mercado" })).toBeVisible();
  const audio = page.locator(".media-detail__player audio");
  const player = page.locator(".media-detail__player .plyr");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("data-media-player", "plyr");
  await expect(player).toHaveAttribute("data-media-player-version", "3.8.4");
  await expect(audio).not.toHaveAttribute("controls");
  await expect(page.getByText("播放器已就绪")).toBeVisible();

  // Segment 0 carries the S1 index of the imported transcript; the subtitle
  // list must show the sentence only, never the diarization label.
  const transcript = page.locator(".segment-transcript");
  await expect(transcript).not.toContainText("S1");
  await expect(transcript.locator("strong")).toHaveCount(0);
  await expect(page.locator("#segment-0")).toContainText("Buenos días");

  // Sentence navigation is keyboard-only by product decision: the arrow keys
  // move between reviewed lines, so the button row no longer exists.
  await page.keyboard.press("ArrowRight");
  await expect(audio).toHaveAttribute("data-current-time", "2.2");
  await expect(page.getByRole("button", { name: "查看词语 Quería" })).toHaveAttribute("data-active-word", "true");
  await page.keyboard.press("a");
  await expect(audio).toHaveAttribute("data-current-time", "0");

  await page.keyboard.press("q");
  await expect(page.getByRole("button", { name: "关闭自动暂停" })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const element = document.querySelector("audio")!;
    element.currentTime = 2.2;
    element.dispatchEvent(new Event("timeupdate"));
    element.dispatchEvent(new Event("play"));
  });
  await page.waitForTimeout(800);
  await expect(audio).toHaveAttribute("data-paused-by-app", "true");
  await expect(page.getByText("进度已同步")).toBeVisible();

  await page.getByRole("button", { name: "双语" }).click();
  await expect(page.getByText("早上好，你要买点什么？")).toBeVisible();
  await page.evaluate(() => {
    const audio = document.querySelector("audio")!;
    audio.currentTime = 0.9;
    audio.dispatchEvent(new Event("play"));
  });
  await expect(page.getByRole("button", { name: "查看词语 qué" })).toHaveAttribute("data-active-word", "true");

  const word = page.getByRole("button", { name: "查看词语 Buenos" });
  await word.click();
  const drawer = page.getByRole("dialog", { name: "词句上下文" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("好的", { exact: true })).toBeVisible();
  await expect(drawer.getByText("这里指一杯咖啡。", { exact: true })).toBeVisible();
  await expect(drawer.getByText("单词朗读 · 合成音", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText(/按需生成|词典暂未收录/)).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "解释这句中的用法" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "朗读单词" }).click();
  await expect(drawer.getByText("正在朗读 · 合成音", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "停止朗读" }).click();
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

test("keeps a compact player above the text while long transcripts follow and scroll", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  const widths = mobile ? [320, 375, 768] : [1024, 1440, 1920];
  await page.goto(`/learn/media/${longFixtureStableKey}`);
  await expect(page.getByText("播放器已就绪", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "当前片段" })).toHaveCount(0);
  const player = page.getByRole("region", { name: "播客学习器" });
  const transcriptPanel = page.getByRole("region", { name: "字幕与文本" });
  const transcript = page.locator(".segment-transcript");

  for (const width of widths) {
    await page.setViewportSize({ width, height: mobile ? 812 : 900 });
    const playerBox = (await player.boundingBox())!;
    const transcriptBox = (await transcriptPanel.boundingBox())!;
    expect(transcriptBox.y).toBeGreaterThanOrEqual(playerBox.y + playerBox.height);
    expect(Math.abs(transcriptBox.x - playerBox.x)).toBeLessThan(2);
    expect(transcriptBox.width).toBeLessThanOrEqual(960);
    expect(playerBox.height).toBeLessThan(150);
    if (width <= 959) {
      const navigationBox = (await page.getByRole("navigation", { name: "主要导航" }).boundingBox())!;
      expect(transcriptBox.y + transcriptBox.height).toBeLessThanOrEqual(navigationBox.y + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // Let the previous settings tooltip finish its exit transition after a
    // resize before checking the control row's actual overflow.
    await expect.poll(() => page.locator(".plyr__controls").evaluate((element) => element.scrollWidth > element.clientWidth), {
      message: JSON.stringify(await page.locator(".plyr__controls").evaluate((element) => ({
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      children: Array.from(element.children).map((child) => ({ className: child.className, width: child.getBoundingClientRect().width, margin: getComputedStyle(child).margin })),
      }))),
    }).toBe(false);
    expect((await page.locator(".plyr__progress").boundingBox())!.width).toBeGreaterThan(120);
    if (width <= 560) {
      const controlSizes = await page.locator(".plyr__controls > button, .plyr__volume > button, .plyr__menu > button, .caption-mode > button").evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }));
      for (const size of controlSizes) {
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
      }
    }
    const settings = page.locator(".plyr__menu > button");
    await settings.click();
    const menu = page.locator(".plyr__menu__container");
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + 5, box.y + 5));
    })).toBe(true);
    await settings.click();
    await expect(menu).toBeHidden();
    // Clear the settings tooltip before resizing: it deliberately extends
    // outside the control row and is not a control-layout overflow.
    await page.mouse.move(0, 0);

    await page.evaluate(() => {
      const audio = document.querySelector("audio")!;
      audio.currentTime = 0;
      audio.dispatchEvent(new Event("timeupdate"));
    });
    await expect(page.locator("#segment-0")).toHaveClass("is-active");
    await page.evaluate(() => {
      const audio = document.querySelector("audio")!;
      audio.currentTime = 60;
      audio.dispatchEvent(new Event("timeupdate"));
    });
    await expect(page.locator("#segment-20")).toHaveClass("is-active");
    const centering = await transcript.evaluate((element) => {
      const pane = element.getBoundingClientRect();
      const active = element.querySelector(".is-active")!.getBoundingClientRect();
      return Math.abs(active.y + active.height / 2 - pane.y - pane.height / 2);
    });
    expect(centering).toBeLessThan(3);
    const afterFollow = (await player.boundingBox())!;
    expect(Math.abs(afterFollow.y - playerBox.y)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath(`podcast-${width}.png`), fullPage: true });
  }

  const follow = page.getByRole("button", { name: "自动滚动到当前句" });
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await transcript.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const manualScroll = await transcript.evaluate((element) => element.scrollTop);
  const fixedPlayerBox = (await player.boundingBox())!;
  await page.evaluate(() => {
    const audio = document.querySelector("audio")!;
    audio.currentTime = 30;
    audio.dispatchEvent(new Event("timeupdate"));
  });
  await expect(page.locator("#segment-10")).toHaveClass("is-active");
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(manualScroll);
  expect(Math.abs((await player.boundingBox())!.y - fixedPlayerBox.y)).toBeLessThan(2);
  await follow.click();
  await page.getByRole("button", { name: "双语", exact: true }).click();
  await expect(page.locator("#segment-10 .segment-transcript__translation")).toBeVisible();
  await page.getByRole("button", { name: "隐藏", exact: true }).click();
  await expect(transcript).toHaveCount(0);
  await expect(page.locator(".plyr__controls")).toBeVisible();
  await page.getByRole("button", { name: "西语", exact: true }).click();
  await expect(page.locator("#segment-10")).toHaveClass("is-active");
});
