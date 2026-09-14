import { expect, test } from "@playwright/test";

const fixtureStableKey = "podcast.e2e-cafe";

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
});

test("learns from a reviewed podcast with audio, transcript, words, and progress", async ({ page }, testInfo) => {
  await page.goto(`/learn/media/${encodeURIComponent(fixtureStableKey)}`);

  await expect(page.getByRole("heading", { name: "Una mañana en el mercado" })).toBeVisible();
  const audio = page.getByLabel("Una mañana en el mercado 播放器");
  await expect(audio).toBeVisible();
  await expect(page.getByText("播放器已就绪")).toBeVisible();

  await page.getByRole("button", { name: "下一句" }).click();
  await expect(audio).toHaveAttribute("data-current-time", "2.2");
  await page.keyboard.press("a");
  await expect(audio).toHaveAttribute("data-current-time", "0");

  await page.keyboard.press("q");
  await expect(page.getByRole("checkbox", { name: "自动暂停" })).toBeChecked();
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
