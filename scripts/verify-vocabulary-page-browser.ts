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
  const consoleErrors: string[] = [];
  const resourceErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text().slice(0, 160);
    // A missing static asset is logged as a console error but is not a page
    // failure; keep the two apart so a real error cannot hide behind them.
    if (text.startsWith("Failed to load resource")) resourceErrors.push(`${text} @ ${message.location()?.url ?? "?"}`);
    else consoleErrors.push(text);
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 160)));

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

  // One evaluate rather than one round trip per tile: the shelf is rendered
  // whole now, so the old per-tile loop would cost thousands of hops.
  const words = (await tiles.evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector(".vocabulary-study__word-text")?.textContent?.trim() ?? ""),
  ));
  check("first word is the top reference word", words[0] === "ser", `got "${words[0]}"`);

  // The ordering is the reference rank, so the shelf must contain none of the
  // function words that used to head it.
  const functionWords = ["el", "la", "los", "las", "que", "de", "por", "con", "una", "para", "del", "y", "en"];
  const leaked = words.filter((word) => functionWords.includes(word));
  check("no function words anywhere on the shelf", leaked.length === 0, leaked.join(", ") || "none");

  // --- one page, not 331 -----------------------------------------------------
  const bands = await page.locator(".vocabulary-rank-band").count();
  const pagination = await page.locator('nav[aria-label="词句分页"]').count();
  check("the whole shelf is rendered at once", count === 7_922, `${count} tiles`);
  check("every rank band is on the page", bands === 80, `${bands} band headings`);
  check("no pagination control is left", pagination === 0, `${pagination} found`);
  check("last word is the shelf's last rank", words.at(-1) === "neurociencia", `got "${words.at(-1)}"`);
  check("last band heading is clipped to the shelf", (await page.locator(".vocabulary-rank-band").last().innerText()) === "排名 7901 - 7922:", await page.locator(".vocabulary-rank-band").last().innerText());

  // --- what the full render actually costs -----------------------------------
  const readPerf = () => page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint");
    return {
      ttfb: Math.round(navigation?.responseStart ?? -1),
      domContentLoaded: Math.round(navigation?.domContentLoadedEventEnd ?? -1),
      load: Math.round(navigation?.loadEventEnd ?? -1),
      fcp: Math.round(paint?.startTime ?? -1),
      nodes: document.getElementsByTagName("*").length,
      transfer: Math.round((navigation?.transferSize ?? 0) / 1024),
      decoded: Math.round((navigation?.decodedBodySize ?? 0) / 1024),
    };
  });
  const coldPerf = await readPerf();
  // The dev server compiles the route on the first request, which would swamp
  // the page's own cost: reload once and report both numbers separately.
  await page.goto(`${base}/read/vocabulary`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  // `networkidle` does not wait for hydration; the frame's listeners are what
  // make a tile clickable, so give them a moment before interacting.
  await page.waitForTimeout(800);
  const perf = await readPerf();
  console.log(`performance cold (dev compile included): FCP ${coldPerf.fcp} ms | DCL ${coldPerf.domContentLoaded} ms | load ${coldPerf.load} ms | TTFB ${coldPerf.ttfb} ms`);
  console.log(`performance warm: FCP ${perf.fcp} ms | DCL ${perf.domContentLoaded} ms | load ${perf.load} ms | TTFB ${perf.ttfb} ms`);
  console.log(`performance: ${perf.nodes} DOM nodes | ${perf.decoded} KB decoded | ${perf.transfer} KB over the wire`);
  // TTFB is the server's own cost (one corpus snapshot per request, the same
  // single read the page made before it stopped paging). What the full render
  // adds to the *browser* is the wait from that response to the first paint.
  const clientPaint = perf.fcp - perf.ttfb;
  check("first paint within 1.5 s of the response", clientPaint > 0 && clientPaint < 1_500, `${clientPaint} ms after TTFB`);
  check("DOM stays under 40k nodes", perf.nodes < 40_000, `${perf.nodes} nodes`);

  // Scrolling the whole shelf must stay responsive: jump to the last band and
  // watch for long tasks while it renders. Smooth scrolling is disabled for the
  // measurement so the number is the layout cost, not an animation.
  const scroll = await page.evaluate(async () => {
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
    });
    try { observer.observe({ entryTypes: ["longtask"] }); } catch { /* not offered here */ }
    const previousBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    const target = document.getElementById("vocabulary-band-7901");
    const started = performance.now();
    target?.scrollIntoView({ block: "start" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
    const elapsed = Math.round(performance.now() - started);
    observer.disconnect();
    document.documentElement.style.scrollBehavior = previousBehavior;
    const rect = target?.getBoundingClientRect();
    return { elapsed, longTasks, top: Math.round(rect?.top ?? 9_999), height: Math.round(rect?.height ?? 0), viewport: window.innerHeight };
  });
  console.log(`scrolling to the last band: ${scroll.elapsed} ms to paint, long tasks ${scroll.longTasks.length ? scroll.longTasks.join(", ") : "none"} ms`);
  check("jumping across 7,922 words paints quickly", scroll.elapsed < 1_500, `${scroll.elapsed} ms`);
  // The last band is at the end of the document, so it cannot sit at the top:
  // what matters is that the jump reached it and put it in view.
  check("that jump reaches the last band", scroll.top >= -40 && scroll.top < scroll.viewport, `top ${scroll.top}px of ${scroll.viewport}px viewport`);
  check("no long task over 200 ms while scrolling", scroll.longTasks.every((duration) => duration < 200), scroll.longTasks.join(", ") || "none");
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: 0 });
  });

  // --- no occurrence count ---------------------------------------------------
  const smalls = await page.locator(".vocabulary-study__word small").count();
  check("no count badge on any tile", smalls === 0, `${smalls} found`);

  // --- the card, with a real example ----------------------------------------
  // Wait for hydration the honest way: the translation only exists once the
  // frame's listeners are live, so hovering a reviewed word proves it.
  const cafeTile = page.locator('[data-word-key="cafe"]');
  await cafeTile.scrollIntoViewIfNeeded();
  await cafeTile.hover();
  const hydration = await page.locator("#vocabulary-translation").waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  check("the interactive frame hydrates", hydration, hydration ? "translation answered" : "no translation on hover");
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  await tiles.first().click();
  const card = page.locator(".vocabulary-study__card");
  await card.waitFor({ timeout: 30_000 });
  const cardText = await card.innerText();
  check("card opens for the clicked word", cardText.includes("ser"), cardText.slice(0, 40));
  check("card shows no occurrence figure", !/已发布内容出现/u.test(cardText), "no count text");
  const hasExample = /[¿¡]|\.\.\.|—/u.test(cardText) || cardText.length > 120;
  check("card carries a real example", hasExample, `${cardText.length} chars`);

  // --- the rail is a fragment scroll now, not a page jump ---------------------
  const rail = page.locator('nav[aria-label="按名次跳转"]');
  check("rail offers every reachable milestone", (await rail.locator("a").count()) === 17, `${await rail.locator("a").count()} links`);
  check("rail links are fragments, not pages", (await rail.locator('a[href^="#vocabulary-band-"]').count()) === 17, "all fragment links");
  const oneK = rail.getByRole("link", { name: "跳到第 1k 名" });
  check("1k points at the band holding rank 1000", (await oneK.getAttribute("href")) === "#vocabulary-band-901", (await oneK.getAttribute("href")) ?? "none");
  const urlBeforeJump = page.url();
  await oneK.click();
  await page.waitForFunction(() => window.location.hash === "#vocabulary-band-901", undefined, { timeout: 30_000 });
  // The jump is a smooth scroll now, and it may start from the end of a
  // 165,000-pixel document: wait for it to arrive instead of guessing a delay.
  const landed = await page
    .waitForFunction(() => Math.abs(document.getElementById("vocabulary-band-901")?.getBoundingClientRect().top ?? 9_999) <= 60, undefined, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  const jump = await page.evaluate(() => {
    const band = document.getElementById("vocabulary-band-901");
    return { hash: window.location.hash, offset: Math.round(band?.getBoundingClientRect().top ?? 9_999) };
  });
  check("the jump stays on the same page", page.url().split("#")[0] === urlBeforeJump.split("#")[0], page.url());
  check("the jump lands on band 901", landed && jump.hash === "#vocabulary-band-901", `offset ${jump.offset}px`);
  await page.waitForFunction(() => document.querySelector('nav[aria-label="按名次跳转"] a[aria-current="true"]')?.textContent === "900", undefined, { timeout: 10_000 }).catch(() => {});
  check("the rail marker follows the scroll", (await rail.locator('a[aria-current="true"]').innerText()) === "900", await rail.locator('a[aria-current="true"]').innerText());

  // --- hover shows the translation, and focus reaches the same thing ---------
  // The translation dismisses itself on scroll (it is pinned to the word's
  // position), so the interaction checks scroll instantly instead of racing a
  // smooth scroll with the hover.
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });
  const cafe = page.locator('[data-word-key="cafe"]');
  await cafe.scrollIntoViewIfNeeded();
  const heightBefore = await page.evaluate(() => document.body.scrollHeight);
  await cafe.hover();
  const tooltip = page.locator("#vocabulary-translation");
  await tooltip.waitFor({ timeout: 10_000 });
  const tooltipMeanings = await tooltip.locator(".vocabulary-shelf__translation-meanings li").allInnerTexts();
  check("hover shows the reviewed translation", tooltipMeanings.length === 2, tooltipMeanings.join(" | "));
  // The glossary has no frequency field: the reviewed file's own order is what
  // is shown, first meaning first.
  check("meanings keep the reviewed order", tooltipMeanings[0]?.includes("咖啡这种饮料") && tooltipMeanings[1]?.includes("咖啡馆"), tooltipMeanings.join(" | "));
  check("the translation cannot swallow a click", (await tooltip.evaluate((node) => getComputedStyle(node).pointerEvents)) === "none", await tooltip.evaluate((node) => getComputedStyle(node).pointerEvents));
  const heightAfter = await page.evaluate(() => document.body.scrollHeight);
  check("the translation does not shift the page", heightBefore === heightAfter, `${heightBefore} → ${heightAfter}`);
  check("no title attribute is used", (await cafe.getAttribute("title")) === null, "title absent");

  // Clicking a neighbouring word while the layer is up must reach that word.
  const neighbour = page.locator(".vocabulary-study__word").nth((await page.locator(".vocabulary-study__word").count()) - 1);
  await neighbour.scrollIntoViewIfNeeded();
  await neighbour.click();
  check("a neighbour stays clickable through the layer", (await page.locator(".vocabulary-study__card").count()) === 1, "card opened");
  await page.getByRole("button", { name: "关闭" }).click();

  // Keyboard focus shows the same meanings.
  await cafe.scrollIntoViewIfNeeded();
  await cafe.focus();
  await tooltip.waitFor({ timeout: 10_000 });
  check("focus shows the same translation", (await tooltip.locator("li").count()) === 2, `${await tooltip.locator("li").count()} meanings`);
  check("the focused tile is described by the layer", (await cafe.getAttribute("aria-describedby")) === "vocabulary-translation", (await cafe.getAttribute("aria-describedby")) ?? "none");
  await page.keyboard.press("Escape");
  check("escape dismisses the translation", (await page.locator("#vocabulary-translation").count()) === 0, "dismissed");

  // The layer is `fixed`: it has to move with its word, not hang over whatever
  // word is at the coordinate it was first shown at.
  await cafe.hover();
  await tooltip.waitFor({ timeout: 10_000 });
  const gapTo = () => page.evaluate(() => {
    const tile = document.querySelector('[data-word-key="cafe"]');
    const layer = document.querySelector("#vocabulary-translation");
    if (!tile || !layer) return 9_999;
    return Math.round(layer.getBoundingClientRect().top - tile.getBoundingClientRect().bottom);
  });
  const gapBefore = await gapTo();
  await page.evaluate(() => window.scrollBy(0, 20));
  await page.waitForTimeout(200);
  const gapAfter = await gapTo();
  check("the layer sits under its word", gapBefore >= 0 && gapBefore <= 16, `${gapBefore}px below the word`);
  check("the layer follows its word while scrolling", gapAfter >= 0 && gapAfter <= 16, `${gapBefore}px → ${gapAfter}px`);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));

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
  // A result set holds no shelf ranks: no bands, no rail, and no page either.
  check("a search result drops the bands and the rail", (await page.locator(".vocabulary-rank-band").count()) === 0 && (await page.locator('nav[aria-label="按名次跳转"]').count()) === 0, "no bands, no rail");
  check("a search result holds every match", searched.length > 1 && searched.length < 7_922, `${searched.length} matches`);

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

  // A hydration mismatch or a crashed frame would surface here rather than in a
  // screenshot nobody diffs.
  check("no uncaught page errors while using the page", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | ") || "none");
  if (resourceErrors.length) console.log(`resource requests that 404 (not page errors): ${resourceErrors.slice(0, 3).join(" | ")}`);
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
