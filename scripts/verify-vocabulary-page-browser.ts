/**
 * Real-browser verification of the vocabulary page against the real database.
 *
 * The repo's own e2e config deliberately blanks `DATABASE_URL`, so it can only
 * check the page shell. Every verification of this page so far has been either
 * a jsdom render or a repository-level script; nothing has loaded it in a real
 * browser with real data. This does that, read-only.
 */
// `@playwright/test` rather than the bare `.pnpm` `playwright` path: it is a real
// dependency with type declarations, so this file stays type-checked instead of
// importing an implicitly-`any` module.
import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:3100";
const results: string[] = [];
const check = (label: string, passed: boolean, detail = ""): void => {
  results.push(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", domain: "127.0.0.1", path: "/" },
  ]);
  const page = await context.newPage();

  const started = Date.now();
  const response = await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  check("page loads", response?.status() === 200, `HTTP ${response?.status()}`);
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  const coldMs = Date.now() - started;

  // --- the consolidation -----------------------------------------------------
  const switcher = await page.locator('nav[aria-label*="视图"]').count();
  check("no view switcher", switcher === 0, `nav count ${switcher}`);
  const oldLabels = await page.getByRole("link", { name: /学习词表|语料高频词|正式词元/u }).count();
  check("no old view labels", oldLabels === 0, `link count ${oldLabels}`);

  // --- the list --------------------------------------------------------------
  const heading = await page.getByRole("heading", { level: 1 }).count();
  check("exactly one h1", heading === 1, `${heading} headings`);

  const tiles = page.locator(".vocabulary-study__word");
  await tiles.first().waitFor({ timeout: 60_000 });
  const count = await tiles.count();
  check("tiles rendered", count > 0, `${count} tiles`);

  const words: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const text = await tiles.nth(i).locator(".vocabulary-study__word-text").innerText();
    words.push(text.trim());
  }
  check("first word is the top reference word", words[0] === "ser", `got "${words[0]}"`);

  // The ordering is the reference rank, so the first page must contain none of
  // the function words that used to head the shelf.
  const functionWords = ["el", "la", "los", "las", "que", "de", "por", "con", "una", "para", "del", "y", "en"];
  const leaked = words.filter((word) => functionWords.includes(word));
  check("no function words on the first page", leaked.length === 0, leaked.join(", ") || "none");

  // --- no occurrence count ---------------------------------------------------
  const smalls = await page.locator(".vocabulary-study__word small").count();
  check("no count badge on any tile", smalls === 0, `${smalls} found`);

  // --- the card, with a real example ----------------------------------------
  await tiles.first().click();
  const card = page.locator(".vocabulary-study__card");
  await card.waitFor({ timeout: 30_000 });
  const cardText = await card.innerText();
  check("card opens for the clicked word", cardText.includes("ser"), cardText.slice(0, 40));
  check("card shows no occurrence figure", !/已发布内容出现/u.test(cardText), "no count text");
  const hasExample = /[¿¡]|\.\.\.|—/u.test(cardText) || cardText.length > 120;
  check("card carries a real example", hasExample, `${cardText.length} chars`);

  // --- search ----------------------------------------------------------------
  const search = page.getByLabel(/搜索/u).first();
  await search.fill("aqui");
  await search.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  const searched = await page.locator(".vocabulary-study__word-text").allInnerTexts();
  check(
    "search folds accents and finds aquí",
    searched.some((word) => word.trim() === "aquí"),
    searched.slice(0, 5).join(", "),
  );

  // --- mobilisation ----------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("no horizontal overflow at 390px", overflow <= 1, `${overflow}px`);

  await page.screenshot({ path: ".tmp-vocab-verify/mobile-390.png", fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await page.screenshot({ path: ".tmp-vocab-verify/desktop-1440.png", fullPage: false });

  console.log(`cold load (domcontentloaded + networkidle): ${coldMs} ms`);
} catch (error) {
  check("verification ran to completion", false, String(error).slice(0, 300));
} finally {
  for (const line of results) console.log(line);
  const failures = results.filter((line) => line.startsWith("FAIL")).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  await browser.close();
  process.exitCode = failures === 0 ? 0 : 1;
}
