import { strict as assert } from "node:assert";
import { chromium } from "@playwright/test";

// Read-only browser check against a local AUTH_E2E_ENABLED development server.
// Audio is faked so this layout check never loads media or a paid provider.
const base = process.env.VOCAB_TOOLBAR_BASE ?? "http://127.0.0.1:3211";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addCookies([{ name: "spanish-e2e-user", value: "11111111-1111-4111-8111-111111111111", url: base }]);
  await context.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance: SpeechSynthesisUtterance) => utterance.onstart?.(new Event("start") as SpeechSynthesisEvent),
        cancel: () => {}, getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {},
      },
    });
  });
  const page = await context.newPage();
  await page.route("**/api/v1/read/word-audio", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ apiVersion: "v1", data: { outcome: "synthetic", clip: null, reason: "no_match" } }),
  }));
  await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const toolbar = page.locator(".vocabulary-toolbar");
  await toolbar.waitFor();
  assert((await page.locator("[data-word-key]").count()) > 100, "Use a populated local shelf");
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate((theme) => window.localStorage.setItem("spanish-theme", theme), colorScheme);
    for (const width of [320, 375, 640, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-word-key]").first().waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector(".vocabulary-toolbar")!.getBoundingClientRect();
        const search = document.querySelector(".vocabulary-search")!.getBoundingClientRect();
        const toggle = document.querySelector(".vocabulary-study__autoplay")!.getBoundingClientRect();
        const word = document.querySelector("[data-word-key]")!.getBoundingClientRect();
        const navigation = document.querySelector('[aria-label="阅读内容类型"]')!.getBoundingClientRect();
        const icon = document.querySelector(".vocabulary-search__icon")!.getBoundingClientRect();
        return { height: toolbar.height, searchHeight: search.height, toggleHeight: toggle.height,
          navigationGap: search.top - navigation.bottom,
          iconInset: icon.left - search.left,
          searchWidth: search.width,
          wordWidth: word.width, wordTop: word.top,
          sameRow: Math.abs(search.top - toggle.top) < 2,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
      });
      assert(!geometry.overflow, `${colorScheme} ${width}: horizontal overflow`);
      assert(geometry.height <= 96, `${colorScheme} ${width}: toolbar too tall`);
      assert(geometry.searchHeight >= 44 && geometry.toggleHeight >= 44, "44px controls");
      assert(geometry.navigationGap >= 24, "Search stays clear of the navigation");
      assert(geometry.iconInset >= 15 && geometry.iconInset <= 17, "Search icon has balanced inset");
      assert(geometry.wordWidth >= 44 && geometry.wordTop < 900, "Word list remains visible on the first screen");
      if (width === 1440) {
        assert(geometry.sameRow, "Desktop controls share one row");
        assert(geometry.searchWidth <= 320, "Desktop search stays compact");
      }
      console.log(`PASS ${colorScheme} ${width}px: toolbar ${geometry.height}px, no overflow`);
      if (colorScheme === "dark" && (width === 375 || width === 1440)) {
        await page.screenshot({ path: `.tmp-vocab-ui001-${width}.png` });
      }
    }
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.setViewportSize({ width: 1440, height: 900 });
  const toggle = page.getByRole("checkbox", { name: "点词自动发音" });
  await toggle.focus();
  await page.keyboard.press("Space");
  assert(!(await toggle.isChecked()), "Keyboard can disable automatic audio");
  await page.keyboard.press("Space");
  assert(await toggle.isChecked(), "Keyboard can restore automatic audio");
  await page.locator('[data-word="casa"]').first().click();
  const panel = page.getByRole("complementary", { name: "casa 词汇卡片" });
  // The owner asked for no "synthesis"/"preparing" wording beside the read control
  // (2026-10-20); the control itself carries the state. The click is enough: the old
  // label rendered synchronously in the loading phase.
  assert(await panel.getByText(/合成音|准备中/u).count() === 0, "Word pronunciation has no status line");
  assert(await page.locator(".vocabulary-toolbar .vocabulary-study__notice").count() === 0, "Audio cannot create a page-wide banner");
  await panel.getByRole("button", { name: "已熟悉", exact: true }).click();
  assert((await toolbar.innerText()).includes("已标记 1 个"), "Local marks remain visible");
  await page.screenshot({ path: ".tmp-vocab-ui001-panel.png" });
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  assert(await page.getByText(/合成音|准备中/u).count() === 0, "Audio status closes with its word");
  await page.goto(`${base}/read/vocabulary?search=casa`, { waitUntil: "domcontentloaded" });
  const clear = page.getByRole("link", { name: "清除搜索：casa" });
  await clear.waitFor();
  const clearGeometry = await page.evaluate(() => {
    const search = document.querySelector(".vocabulary-search")!.getBoundingClientRect();
    const clear = document.querySelector(".vocabulary-search__clear")!.getBoundingClientRect();
    return { rightInset: search.right - clear.right, width: clear.width, height: clear.height };
  });
  assert(Math.abs(clearGeometry.rightInset) <= 1 && clearGeometry.width >= 44 && clearGeometry.height >= 44, "Clear control stays on the right with a 44px hit area");
  await clear.click();
  await page.waitForURL(`${base}/read/vocabulary`);
  assert(await page.getByRole("textbox", { name: "搜索词表" }).inputValue() === "", "Clear restores the whole shelf");
  console.log("PASS keyboard toggle, local marks, no word-audio status line, panel close");
  await context.close();
} finally {
  await browser.close();
}
