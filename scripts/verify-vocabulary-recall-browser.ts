import { strict as assert } from "node:assert";
import { chromium, expect, type Locator } from "@playwright/test";

function cssRgb(color: string): readonly number[] {
  const values = color.match(/[\d.]+/gu)!.map(Number);
  return color.startsWith("color(srgb") ? values.slice(0, 3).map((value) => value * 255) : values.slice(0, 3);
}

function luminance(color: string): number {
  return cssRgb(color).map((value) => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}

async function checkFeedback(row: Locator, result: string, label: string) {
  // Centre the row so a mobile bottom navigation cannot cover its feedback.
  await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const item = row.locator(".vocabulary-recall__item");
  const badge = item.locator(".vocabulary-recall__result");
  await expect(item).toHaveAttribute("data-result", result);
  await expect(badge.locator(".vocabulary-recall__result-label")).toHaveText(label);
  await expect(badge.locator(".vocabulary-recall__result-icon")).toBeVisible();
  await expect(badge.locator(".vocabulary-recall__result-icon")).toHaveAttribute("aria-hidden", "true");
  const colors = await badge.evaluate((element) => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  const ink = luminance(colors.color);
  const fill = luminance(colors.background);
  assert((Math.max(ink, fill) + .05) / (Math.min(ink, fill) + .05) >= 4.5, `${result} badge needs AA text contrast: ${JSON.stringify(colors)}`);
}

// Run against a populated local AUTH_E2E_ENABLED server. All marks/answers live
// in disposable browser contexts; this script never writes to application APIs.
const base = process.env.VOCAB_RECALL_BASE ?? "http://127.0.0.1:3215";
const scope = "11111111-1111-4111-8111-111111111111";
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", colorScheme: theme });
      await context.addCookies([{ name: "spanish-e2e-user", value: scope, url: base }]);
      // Raw JS keeps tsx's inferred-name helper out of serialized browser code.
      await context.addInitScript({ content: `
        localStorage.setItem(${JSON.stringify(`sueno:vocabulary-status:v1:${scope}`)}, JSON.stringify({ casa: "familiar", tambien: "familiar", tener: "learning" }));
        localStorage.setItem(${JSON.stringify(`sueno:vocabulary-autoplay:v1:${scope}`)}, "off");
        localStorage.setItem("spanish-theme", ${JSON.stringify(theme)});
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
          speak: () => { throw new Error("Recall must not trigger speech"); }, cancel: () => {}, getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {},
        } });
      ` });
      const page = await context.newPage();
      const toolbar = page.locator(".vocabulary-recall");
      const writes: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/") && request.method() !== "GET") writes.push(new URL(request.url()).pathname);
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await expect(page.locator(".vocabulary-study__summary")).toHaveText("已标记 3 个", { timeout: 60_000 });
      const casa = page.locator('[data-word="casa"]').first();
      const accent = page.locator('[data-word="también"]').first();
      await expect(casa).toBeAttached();
      await expect(accent).toBeAttached();
      await toolbar.getByRole("button", { name: "看释义写单词", exact: true }).click();
      await expect(casa).toBeHidden();
      await expect(accent).toBeHidden();
      await expect(page.locator(".vocabulary-recall__item")).toHaveCount(2);
      await expect(page.getByRole("checkbox", { name: "点词自动发音" })).toBeDisabled();
      const casaRow = casa.locator("..");
      const accentRow = accent.locator("..");
      await casaRow.locator("input").fill("  ");
      await casaRow.locator("input").press("Enter");
      await expect(casaRow.locator("input")).toBeFocused();
      // A blank check exposes the reference, so start a fresh round for independent matching.
      await toolbar.getByRole("button", { name: "退出默写", exact: true }).click();
      await toolbar.getByRole("button", { name: "看释义写单词", exact: true }).click();
      const neutralFill = await casaRow.locator("input").evaluate((element) => getComputedStyle(element).backgroundColor);
      await casaRow.locator("input").fill("CASA");
      await casaRow.locator("input").press("Enter");
      await expect(accentRow.locator("input")).toBeFocused();
      await expect(accentRow.locator(".vocabulary-recall__feedback")).toHaveText("");
      await checkFeedback(casaRow, "correct", "答对了！");
      await expect(casaRow.locator(".vocabulary-recall__result")).toHaveClass(/is-celebrating/);
      await expect(casaRow.locator(".vocabulary-recall__sparkles")).toBeVisible();
      await expect(casaRow.locator(".vocabulary-recall__result")).toHaveCSS("animation-name", "none");
      assert.notEqual(await casaRow.locator("input").evaluate((element) => getComputedStyle(element).backgroundColor), neutralFill);
      if (width === 375 || width === 1440) await casaRow.screenshot({ path: `.tmp-vocab-feedback-${theme}-${width}.png` });
      await accentRow.locator("input").fill("tambien");
      await accentRow.locator("input").press("Enter");
      await expect(accentRow.locator("input")).toBeFocused();
      await expect(casaRow.getByText("答对了！", { exact: true })).toBeVisible();
      await expect(accentRow.getByText("重音有误", { exact: true })).toBeVisible();
      await checkFeedback(accentRow, "accent", "重音有误");
      await expect(accentRow.locator("mark")).toHaveText("é");
      await expect(accentRow.locator("input")).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(".vocabulary-recall__summary")).toContainText("独立匹配 1");
      await toolbar.getByRole("button", { name: "重练错词", exact: true }).click();
      await expect(page.locator(".vocabulary-recall__item")).toHaveCount(1);
      await expect(accentRow.locator("input")).toHaveValue("");
      await accentRow.locator("input").fill("también");
      await accentRow.locator("input").press("Enter");
      await expect(accentRow.locator("input")).toBeFocused();
      await checkFeedback(accentRow, "correct", "答对了！");
      await accentRow.locator("input").fill("wrong");
      await accentRow.locator("input").press("Enter");
      await checkFeedback(accentRow, "incorrect", "需要复习");
      await expect(accentRow.locator(".vocabulary-recall__reference")).toContainText("también");
      await toolbar.getByRole("button", { name: "看单词写释义", exact: true }).click();
      await expect(page.locator(".vocabulary-recall__item")).toHaveCount(2);
      await expect(casaRow.locator("input")).toHaveValue("");
      // content-visibility defers offscreen band layout; inspect the rendered row.
      await casaRow.scrollIntoViewIfNeeded();
      await expect(casaRow.locator(".vocabulary-study__word-meaning")).toBeHidden();
      await expect(casaRow.locator(".vocabulary-recall__roller-front")).toBeHidden();
      await casaRow.locator("input").fill("这条同义解释需要自行确认");
      await casaRow.locator("input").press("Enter");
      await expect(casaRow.locator("input")).toBeFocused();
      await expect(casaRow.getByText("待确认", { exact: true })).toBeVisible();
      await checkFeedback(casaRow, "pending", "待确认");
      await expect(casaRow.locator("input")).not.toHaveAttribute("aria-invalid", "true");
      await casaRow.getByRole("button", { name: "我的意思正确", exact: true }).click();
      await expect(casaRow.getByText("自行确认正确", { exact: true })).toBeVisible();
      await checkFeedback(casaRow, "correct", "自行确认正确");
      await expect(casaRow.locator(".vocabulary-recall__result")).not.toHaveClass(/is-celebrating/);
      await casaRow.locator("input").press("Enter");
      await expect(accentRow.locator("input")).toBeFocused();
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        shortControls: [...document.querySelectorAll<HTMLElement>(".vocabulary-recall button, .vocabulary-recall__item button, .vocabulary-recall__item input")]
          .filter((element) => element.getBoundingClientRect().height < 44).length,
      }));
      assert(!geometry.overflow, `${theme} ${width}: horizontal overflow`);
      assert.equal(geometry.shortControls, 0, "44px practice controls");
      await casaRow.scrollIntoViewIfNeeded();
      if (theme === "dark" && (width === 375 || width === 1440)) await page.screenshot({ path: `.tmp-vocab-recall-${width}.png` });
      await toolbar.getByRole("button", { name: "退出默写", exact: true }).click();
      await expect(casa).toBeVisible();
      await expect(page.locator(".vocabulary-recall__item")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "搜索词表" })).toBeVisible();
      const marks = await page.evaluate((scope) => JSON.parse(localStorage.getItem(`sueno:vocabulary-status:v1:${scope}`)!), scope);
      assert.equal(marks.casa, "familiar");
      assert.equal(marks.tambien, "familiar");
      assert.deepEqual(writes, [], "Practice must not submit writes or evidence");
      assert.deepEqual(errors, [], "No client errors");
      console.log(`PASS ${theme} ${width}px: joyful correct/incorrect/accent/pending, AA badges, Enter focus, both modes, retry, restore, 44px, no writes`);
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
  await context.addCookies([{ name: "spanish-e2e-user", value: scope, url: base }]);
  await context.addInitScript({ content: `localStorage.setItem(${JSON.stringify(`sueno:vocabulary-status:v1:${scope}`)}, JSON.stringify({ casa: "familiar" })); localStorage.setItem(${JSON.stringify(`sueno:vocabulary-autoplay:v1:${scope}`)}, "off");` });
  const page = await context.newPage();
  await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.locator(".vocabulary-study__summary")).toHaveText("已标记 1 个", { timeout: 60_000 });
  await page.getByRole("button", { name: "看释义写单词", exact: true }).click();
  const roller = page.locator(".vocabulary-recall__roller");
  await roller.scrollIntoViewIfNeeded();
  const motion = await roller.evaluate((element) => ({
    perspective: getComputedStyle(element).perspective,
    front: getComputedStyle(element.querySelector(".vocabulary-recall__roller-front")!).animationName,
    back: getComputedStyle(element.querySelector("input")!).animationName,
    duration: getComputedStyle(element.querySelector("input")!).animationDuration,
  }));
  assert.equal(motion.front, "vocabulary-wheel-front-out");
  assert.equal(motion.back, "vocabulary-wheel-back-in");
  assert.equal(motion.duration, "0.42s");
  assert.notEqual(motion.perspective, "none");
  await roller.locator("input").fill("casa");
  await roller.locator("input").press("Enter");
  const celebration = page.locator(".vocabulary-recall__result.is-celebrating");
  await expect(celebration).toHaveCSS("animation-name", "vocabulary-answer-celebrate");
  await expect(celebration).toHaveCSS("animation-duration", "0.26s");
  await page.getByRole("button", { name: "退出默写", exact: true }).click();
  await expect(roller).toHaveClass(/is-exiting/);
  await expect(roller).toHaveCount(0);
  await expect(page.locator('[data-word="casa"]').first()).toBeVisible();
  console.log("PASS mechanical wheel enter/exit and reduced-motion matrix");
  await context.close();
} finally { await browser.close(); }
