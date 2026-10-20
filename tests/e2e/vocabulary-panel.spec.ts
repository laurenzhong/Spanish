import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const glossary = JSON.parse(readFileSync(resolve("content/glossary/es-zh-common-v1.json"), "utf8")) as {
  entries: { headword: string; forms?: string[] }[];
};

const scope = "00000000-0000-4000-8000-000000000001";
const base = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;

for (const width of [375, 1024, 1440]) {
  test(`shows all estar forms outside the collapsed usage at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.context().addCookies([{ name: "spanish-e2e-user", value: scope, url: base }]);
    await page.addInitScript({ content: `localStorage.setItem("sueno:vocabulary-autoplay:v1:${scope}", "off");` });
    // Keep the page's real reviewed forms; only the unrelated lazy examples are faked.
    await page.route("**/api/v1/read/word-lookup?fields=tatoeba", (route) => route.fulfill({
      json: { apiVersion: "v1", data: { found: true, tatoeba: [] } },
    }));
    await page.goto("/read/vocabulary");
    await page.locator('[data-word="estar"]').first().click();
    const panel = page.locator(".vocabulary-study__card");
    await expect(panel.getByRole("heading", { name: "estar", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "常见变位 / 形式" })).toBeVisible();
    const forms = panel.getByRole("region", { name: "常见变位 / 形式" });
    await expect(forms.locator(".vocabulary-study__chips span"))
      .toHaveText(glossary.entries.find((entry) => entry.headword === "estar")!.forms!);
    await expect(panel.locator("details")).not.toHaveAttribute("open");
    await forms.getByText("estando", { exact: true }).scrollIntoViewIfNeeded();
    await expect(forms.getByText("estando", { exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`estar-forms-${width}.png`) });
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
  });

  test(`keeps vocabulary in place and prioritizes word details at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.context().addCookies([{ name: "spanish-e2e-user", value: scope, url: base }]);
    await page.addInitScript({ content: `localStorage.setItem("sueno:vocabulary-autoplay:v1:${scope}", "off");` });
    const evidenceWrites: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/v1\/(evidence|profile|lexicon\/intents)/u.test(request.url()) && request.method() !== "GET") evidenceWrites.push(request.url());
    });
    await page.route("**/api/v1/read/word-lookup**", async (route) => {
      const { word } = route.request().postDataJSON() as { word: string };
      await route.fulfill({ json: { apiVersion: "v1", data: {
        found: true, word, markKey: word, meanings: [{ meaning: "房子", usage: "" }],
        usageNotes: ["en casa 表示在家。"], collocations: ["en casa"], forms: ["casas"], examples: [],
        tatoeba: [{ text: "Hoy me quedo en casa.", translation: "今天我待在家里。", sentenceId: 1234567,
          sentenceOwner: "Shishir", sentenceLicense: "CC BY 2.0 FR", translationId: 7654321,
          translationOwner: "sadhen", translationLicense: "CC BY 2.0 FR", isDirect: true,
          tags: [], matchedForm: null, audio: null }],
      } } });
    });
    await page.goto("/read/vocabulary");
    await expect(page.locator(".vocabulary-study__word")).toHaveCount(7922);
    await page.evaluate(() => document.fonts.ready);
    const tile = page.locator(".vocabulary-study__word").nth(250);
    await tile.scrollIntoViewIfNeeded();
    const before = await tile.boundingBox();
    const gridBefore = await page.locator(".vocabulary-shelf__bands").boundingBox();
    await tile.click();
    const panel = page.locator(".vocabulary-study__card");
    await expect(panel).toBeVisible();
    await expect.poll(async () => Math.abs((await tile.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(3);
    if (width < 1200) {
      await expect(panel).toHaveAttribute("role", "dialog");
      await expect(panel).toHaveAttribute("aria-modal", "true");
      expect((await page.locator(".vocabulary-shelf__bands").boundingBox())!.width).toBeCloseTo(gridBefore!.width, 0);
      await expect(page.getByTestId("word-panel-backdrop")).toBeVisible();
      if (width === 1024) expect((await panel.boundingBox())!.x).toBeGreaterThan(width / 2);
    } else {
      await expect(page.getByTestId("word-panel-backdrop")).toHaveCount(0);
      const other = page.locator(".vocabulary-study__word").nth(251);
      const gridOpen = await page.locator(".vocabulary-shelf__bands").boundingBox();
      await other.click();
      expect((await page.locator(".vocabulary-shelf__bands").boundingBox())!.width).toBeCloseTo(gridOpen!.width, 0);
      await tile.click();
    }
    const closeBefore = await tile.boundingBox();
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.locator(".product-shell").evaluate((element) => (element as HTMLElement).inert)).toBe(false);
    await expect.poll(async () => Math.abs((await tile.boundingBox())!.y - closeBefore!.y)).toBeLessThanOrEqual(3);
    await page.waitForFunction(() => !window.history.state?.vocabularyPanel);

    const casa = page.locator('[data-word="casa"]').first();
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    await casa.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await casa.click();
    await expect(panel.getByRole("heading", { name: "casa", exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Shishir", exact: true })).toBeVisible();
    const positions = await panel.evaluate((element) => {
      const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect().top;
      return { meanings: rect(".vocabulary-study__meanings"), marks: rect(".vocabulary-study__marking"),
        examples: rect(".vocabulary-study__example-section"), details: rect("details"), lookup: rect("form") };
    });
    expect(positions.meanings).toBeLessThan(positions.marks);
    expect(positions.marks).toBeLessThan(positions.examples);
    expect(positions.examples).toBeLessThan(positions.details);
    expect(positions.details).toBeLessThan(positions.lookup);
    await expect(panel.locator("details")).not.toHaveAttribute("open");
    await panel.locator("summary").click();
    await expect(panel.getByRole("heading", { name: "常用搭配", exact: true })).toBeVisible();
    await panel.locator("summary").click();
    await panel.getByRole("button", { name: "已熟悉", exact: true }).click();
    await expect(panel.getByRole("button", { name: "已熟悉", exact: true })).toHaveAttribute("aria-pressed", "true");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(async (value) => {
        localStorage.setItem("spanish-theme", value);
        document.documentElement.dataset.theme = value;
        window.dispatchEvent(new Event("spanish-theme-change"));
        // Theme colors transition independently; inspect the finished theme.
        document.body.getBoundingClientRect();
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)));
      }, theme);
      if (width >= 1200) await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: testInfo.outputPath(`panel-${width}-${theme}.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await panel.getByRole("searchbox", { name: "查另一个词" }).fill("parque");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/v1/read/word-lookup") && response.ok()),
      panel.getByRole("searchbox", { name: "查另一个词" }).press("Enter"),
    ]);
    await expect(panel.getByRole("heading", { name: "parque", exact: true })).toBeVisible();
    await expect(panel.locator("details")).not.toHaveAttribute("open");
    await panel.getByRole("button", { name: "关闭", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await page.waitForFunction(() => !window.history.state?.vocabularyPanel);
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    await casa.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await casa.click();
    await expect(panel).toBeVisible();
    await page.goBack();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/read\/vocabulary$/u);
    expect(evidenceWrites).toEqual([]);
  });
}
