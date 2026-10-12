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
import { readFileSync } from "node:fs";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

// The acceptance run measures the page with and without the meanings payload in
// one window, which means two servers; the base URL is therefore overridable.
const base = process.env.VOCAB_VERIFY_BASE ?? "http://127.0.0.1:3100";
const results: string[] = [];
const check = (label: string, passed: boolean, detail = ""): void => {
  results.push(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Language Reactor's meaning asset, exactly as `scripts/build-lr-meaning-asset.ts`
 * writes it, or `null` while the scrape has not landed it. The hover checks then
 * compare against the asset instead of assuming which source is feeding the page.
 */
async function readMeaningAsset(): Promise<{ meanings: Record<string, readonly string[]> } | null> {
  // `VOCAB_MEANINGS_ASSET` means the server under test was pointed at another
  // path on purpose — that is the "without the payload" pass of the comparison,
  // so the meanings the page should show are not this file's.
  if (process.env.VOCAB_MEANINGS_ASSET) return null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(process.cwd(), "content", "word-lists", "es-meanings-v1.json"), "utf8")) as { meanings?: unknown };
    return parsed.meanings && typeof parsed.meanings === "object" && !Array.isArray(parsed.meanings)
      ? { meanings: parsed.meanings as Record<string, readonly string[]> }
      : null;
  } catch {
    return null;
  }
}

/** Whether the layer shows the asset's own list for a word, in the asset's order. */
function matchesAsset(shown: readonly string[], expected: readonly string[] | undefined): boolean {
  if (!expected?.length) return false;
  const firstLines = shown.map((item) => item.split("\n")[0]?.trim() ?? "");
  const wanted = expected.slice(0, 3).map((entry) => entry.trim());
  return firstLines.length === wanted.length && firstLines.every((line, index) => line === wanted[index]);
}

/**
 * The component's own close delay: `vocabulary-shelf.tsx`'s `scheduleHide` waits
 * 120 ms after the pointer leaves the word before the card can go away (Language
 * Reactor's popup uses 100 ms). Every walk below waits this plus 100 ms after
 * arriving, so a pending close would have fired unless a real hit target under
 * the pointer was holding the card open.
 */
const CLOSE_DELAY_MS = 120;
/**
 * 16–30 ms between pointer points. Playwright's `mouse.move(..., { steps: n })`
 * dispatches its n points with no delay at all — the entire traversal takes about
 * 0 ms — which is why a `steps: 6` walk followed by a 120 ms wait still passed on
 * a build whose buttons a hand could not reach. The owner reported that bug twice
 * while the check was green.
 */
const TRAVEL_STEP_MS = 22;
/** How far the arc bows sideways past the card's edge (20–40 px): hands overshoot. */
const TRAVEL_OVERSHOOT_PX = 34;

type Point = Readonly<{ x: number; y: number }>;
type PointerWalk = Readonly<{
  samples: number;
  /** Steps whose `elementFromPoint` reached neither a word nor the layer. */
  deadZones: readonly number[];
  /** Steps where the layer was gone: the card vanished under the pointer. */
  lostCard: readonly number[];
  /** Steps where the layer was open, but on a different word. */
  reTargets: readonly number[];
}>;

/** A quadratic arc from `from` to `to`, bowing `overshoot` px sideways. */
function arcPath(from: Point, to: Point, overshoot: number, samples: number): readonly Point[] {
  const control = { x: (from.x + to.x) / 2 + overshoot, y: (from.y + to.y) / 2 };
  const points: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    points.push({
      x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
      y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
    });
  }
  return points;
}

/**
 * Walk the pointer point by point, waiting between points, and at *every* point
 * ask the browser what is under it. That question is the dead-zone detector: when
 * `elementFromPoint(x, y).closest("[data-word-key], #vocabulary-translation-layer")`
 * is null, the pointer is over a strip with no hit target — the gap a hand fell
 * through while the card re-targeted away. The same probe records whether the card
 * is still open and still on the same word, so "the card survived the trip" is
 * asserted at every step rather than only at the end.
 */
async function walkPointer(page: Page, path: readonly Point[], word: string, pauseAt?: Readonly<{ index: number; ms: number }>): Promise<PointerWalk> {
  const deadZones: number[] = [];
  const lostCard: number[] = [];
  const reTargets: number[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index];
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(TRAVEL_STEP_MS);
    if (pauseAt && index === pauseAt.index) await page.waitForTimeout(pauseAt.ms);
    const probe = await page.evaluate(`(() => {
      const hit = document.elementFromPoint(${point.x}, ${point.y});
      const layer = document.getElementById("vocabulary-translation-layer");
      const row = layer ? layer.closest("li") : null;
      const tile = row ? row.querySelector("[data-word]") : null;
      return {
        reachable: Boolean(hit && hit.closest("[data-word-key], #vocabulary-translation-layer")),
        open: Boolean(layer),
        word: tile ? tile.getAttribute("data-word") : "none",
      };
    })()`) as Readonly<{ reachable: boolean; open: boolean; word: string }>;
    if (!probe.reachable) deadZones.push(index);
    if (!probe.open) lostCard.push(index);
    if (probe.word !== word) reTargets.push(index);
  }
  return { samples: path.length, deadZones, lostCard, reTargets };
}

function walkLine(label: string, walk: PointerWalk): string {
  return `${label}: ${walk.samples} points @ ${TRAVEL_STEP_MS}ms | dead zones [${walk.deadZones.join(",")}] | card lost [${walk.lostCard.join(",")}] | re-targeted [${walk.reTargets.join(",")}]`;
}

function walkIsClean(walk: PointerWalk): boolean {
  return walk.deadZones.length === 0 && walk.lostCard.length === 0 && walk.reTargets.length === 0;
}

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
  // Item 1: how much blank sits above the section navigation. It used to be the
  // shell's 48px top padding plus the page's own 12px.
  const topSpace = await page.evaluate(`(() => {
    const nav = document.querySelector("nav.read-section-navigation");
    return nav ? Math.round(nav.getBoundingClientRect().top) : -1;
  })()`) as number;
  console.log(`blank above the section navigation: ${topSpace}px`);
  check("the section navigation sits near the top of the content", topSpace >= 0 && topSpace <= 32, `${topSpace}px above it`);

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
  // `textContent`, not `innerText`: a band the browser is skipping under
  // `content-visibility: auto` reports an empty `innerText` although its text is
  // in the DOM (find-in-page and screen readers read the DOM, not the paint).
  check("last band heading is clipped to the shelf", (await page.locator(".vocabulary-rank-band").last().textContent()) === "排名 7901 - 7922", await page.locator(".vocabulary-rank-band").last().textContent() ?? "none");

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
  // The number the acceptance quotes against the pre-change 110-550 ms: both are
  // "first paint after the response arrived", so a slow TTFB cannot hide in it.
  console.log(`client first paint (FCP - TTFB): cold ${coldPerf.fcp - coldPerf.ttfb} ms | warm ${clientPaint} ms`);
  check("first paint within 1.5 s of the response", clientPaint > 0 && clientPaint < 1_500, `${clientPaint} ms after TTFB`);
  check("DOM stays under 40k nodes", perf.nodes < 40_000, `${perf.nodes} nodes`);

  // --- sustained scrolling, not a single jump --------------------------------
  // The owner's report was jank while scrolling; a one-shot anchor jump never
  // showed it. This scrolls continuously for three seconds and times every frame
  // (and every Long Animation Frame, which attributes main-thread work).
  // Passed as a string on purpose: the TS/JS transpiler wraps named function
  // expressions with a `__name` helper that does not exist in the page context,
  // so a compiled callback would throw there. The result shape is declared here.
  type SustainedScroll = Readonly<{ frames: number; fps: number; mean: number; p50: number; p95: number; max: number; over33: number; loafCount: number; loafMax: number }>;
  const sustained = await page.evaluate(`(async () => {
    const times = [];
    const loaf = [];
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) loaf.push(Math.round(entry.duration));
      });
      observer.observe({ type: "long-animation-frame", buffered: false });
    } catch (error) { /* not offered here */ }
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 1500);
    await new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      const tick = (now) => {
        times.push(now - last);
        last = now;
        window.scrollBy(0, 24);
        if (now - start < 3000) requestAnimationFrame(tick);
        else resolve(null);
      };
      requestAnimationFrame(tick);
    });
    if (observer) observer.disconnect();
    const sorted = [...times].sort((left, right) => left - right);
    const at = (quantile) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] * 10) / 10;
    return {
      frames: times.length,
      fps: Math.round(times.length / 3),
      mean: Math.round((times.reduce((sum, time) => sum + time, 0) / times.length) * 10) / 10,
      p50: at(0.5),
      p95: at(0.95),
      max: Math.round(Math.max(...times)),
      over33: times.filter((time) => time > 33).length,
      loafCount: loaf.length,
      loafMax: loaf.length ? Math.max(...loaf) : 0,
    };
  })()`) as SustainedScroll;
  console.log(`sustained scroll (3 s): ${sustained.frames} frames ≈ ${sustained.fps} fps | mean ${sustained.mean} ms | p50 ${sustained.p50} | p95 ${sustained.p95} | max ${sustained.max} | frames over 33 ms: ${sustained.over33} | long animation frames: ${sustained.loafCount}${sustained.loafCount ? ` (max ${sustained.loafMax} ms)` : ""}`);
  // The regression this guards against measured 58 ms frames / 17 fps; the fixed
  // page measures ~17 ms. The bar sits deliberately between the two.
  check("sustained scrolling holds a usable frame rate", sustained.mean < 34, `mean ${sustained.mean} ms (${sustained.fps} fps)`);
  check("no frames are dropped badly while scrolling", sustained.over33 <= Math.max(3, Math.round(sustained.frames * 0.05)), `${sustained.over33} of ${sustained.frames} frames over 33 ms`);

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
  // Whether the meanings come from Language Reactor's asset or from the reviewed
  // glossary, the displayed contract is the same: at most three, in the source's
  // own order, never padded.
  const meaningAsset = await readMeaningAsset();
  check("hover shows at most three meanings", tooltipMeanings.length > 0 && tooltipMeanings.length <= 3, `${tooltipMeanings.length} meanings: ${tooltipMeanings.join(" | ")}`);
  check("the meanings shown are the source's own list, in its own order", meaningAsset ? matchesAsset(tooltipMeanings, meaningAsset.meanings.cafe ?? meaningAsset.meanings.café) : (tooltipMeanings[0]?.includes("咖啡这种饮料") === true && tooltipMeanings[1]?.includes("咖啡馆") === true), meaningAsset ? `asset order: ${(meaningAsset.meanings.cafe ?? meaningAsset.meanings.café ?? []).join(" | ")}` : "reviewed glossary order (LR asset absent)");
  check("no claim about commonness is made", !/最常用|按频率|常用度/u.test(await tooltip.innerText()), "no frequency wording");
  check("the tile shows the same meaning the hover list leads with", (await cafe.innerText()).includes(tooltipMeanings[0]?.split("\n")[0]?.trim() ?? "\u0000"), `tile: ${(await cafe.innerText()).split("\n").join(" / ")}`);
  // The contract changed with task-22: the layer must be hoverable and clickable
  // now, so the *wrapper* stays click-through (it is mostly empty space) while the
  // card itself is a hit target. The neighbour-click check below still proves the
  // layer does not steal clicks meant for a visible word.
  const layerPointerEvents = await page.locator("#vocabulary-translation-layer").evaluate((node) => getComputedStyle(node).pointerEvents);
  const cardPointerEvents = await page.locator(".vocabulary-shelf__translation-card").evaluate((node) => getComputedStyle(node).pointerEvents);
  check("the layer wrapper stays click-through while the card is clickable", layerPointerEvents === "none" && cardPointerEvents === "auto", `wrapper ${layerPointerEvents}, card ${cardPointerEvents}`);
  const heightAfter = await page.evaluate(() => document.body.scrollHeight);
  check("the translation does not shift the page", heightBefore === heightAfter, `${heightBefore} → ${heightAfter}`);
  check("no title attribute is used", (await cafe.getAttribute("title")) === null, "title absent");

  // --- the layer must not be painted under the band below it -----------------
  // Each band is a stacking context (`content-visibility: auto` implies paint
  // containment), so the layer's own z-index can only order it inside its band.
  // Hover the last word of a band — the layer then has to cross into the next
  // one — and hit-test the layer's centre. `elementFromPoint` ignores
  // `pointer-events: none` elements, so the probe re-enables pointer events for
  // the hit test only and puts the inline style back afterwards.
  await page.evaluate(() => {
    const next = document.querySelector('[data-band-start="101"]');
    if (next) window.scrollTo(0, Math.max(0, next.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2));
  });
  await page.waitForTimeout(400);
  // The words that carry meanings differ between the two passes (the reviewed
  // glossary alone has ~100 of them), so walk the row from the right and use the
  // first word that actually shows a layer. The layer must cross into the band
  // below, which is why it is the *last* row of band 1 that is hovered.
  const hoverableInRow = async (words: readonly string[]) => {
    for (const word of [...words].reverse()) {
      const tile = page.locator(`[data-word="${word}"]`).first();
      if ((await tile.count()) === 0) continue;
      await tile.scrollIntoViewIfNeeded();
      await tile.hover();
      try {
        await page.locator("#vocabulary-translation-layer").waitFor({ timeout: 1_200 });
        return tile;
      } catch { /* this word has no meanings in this pass */ }
    }
    return null;
  };
  const lastRowWords = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-band-start="1"] .vocabulary-study__word')];
    const lastTop = Math.round(tiles[tiles.length - 1].getBoundingClientRect().top);
    return tiles.filter((tile) => Math.abs(tile.getBoundingClientRect().top - lastTop) < 2).map((tile) => tile.getAttribute("data-word") ?? "");
  });
  const crossing = await hoverableInRow(lastRowWords);
  if (!crossing) throw new Error("no word in the last row of band 1 shows a translation layer");
  await page.waitForTimeout(200);
  const occlusion = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".vocabulary-shelf__translation-card");
    if (!layer) return { present: false, crosses: false, onTop: false, hit: "absent", restored: false };
    const rect = layer.getBoundingClientRect();
    const next = document.querySelector('[data-band-start="101"]');
    const before = layer.getAttribute("style");
    layer.style.pointerEvents = "auto";
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    layer.setAttribute("style", before ?? "");
    return {
      present: true,
      crosses: next ? rect.bottom > next.getBoundingClientRect().top : false,
      onTop: Boolean(hit) && (hit === layer || layer.contains(hit)),
      hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}` : "none",
      restored: (layer.getAttribute("style") ?? "") === (before ?? ""),
    };
  });
  check("the layer is not painted under the band below it", occlusion.present && occlusion.crosses && occlusion.onTop, `crosses: ${occlusion.crosses} | hit at the layer's centre: ${occlusion.hit} | inline style restored: ${occlusion.restored}`);

  // The layer is wider than a tile, so in the right-hand column it has to open
  // leftwards rather than push a horizontal scrollbar out of the page.
  const firstRowWords = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-band-start="1"] .vocabulary-study__word')];
    const firstTop = Math.round(tiles[0].getBoundingClientRect().top);
    return tiles.filter((tile) => Math.abs(tile.getBoundingClientRect().top - firstTop) < 2).map((tile) => tile.getAttribute("data-word") ?? "");
  });
  const rightMostTile = await hoverableInRow(firstRowWords);
  if (!rightMostTile) throw new Error("no word in the first row of band 1 shows a translation layer");
  await page.waitForTimeout(200);
  const inViewport = await page.evaluate(() => {
    const layer = document.querySelector(".vocabulary-shelf__translation-card");
    if (!layer) return { flipped: false, left: 9_999, right: 9_999, viewport: window.innerWidth, overflow: 9_999 };
    const rect = layer.getBoundingClientRect();
    return {
      flipped: layer.classList.contains("is-flipped"),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check("the layer stays inside the page in the right-hand column", inViewport.left >= 0 && inViewport.right <= inViewport.viewport && inViewport.overflow <= 1, `left ${inViewport.left} / right ${inViewport.right} of ${inViewport.viewport} | flipped ${inViewport.flipped} | page overflow ${inViewport.overflow}`);

  // --- item 2: the first row's first words, which were still occluded ---------
  // Each of those rows keeps the entrance animation's filled `transform`, so the
  // row is its own stacking context; the layer only escapes if the row is lifted
  // too. The hit test names the element it actually reaches, so a regression says
  // what is on top rather than just "not the layer".
  const firstRow = await page.evaluate(`(() => {
    const tiles = [...document.querySelectorAll('[data-band-start="1"] .vocabulary-study__word')];
    const firstTop = Math.round(tiles[0].getBoundingClientRect().top);
    return tiles.filter((tile) => Math.abs(tile.getBoundingClientRect().top - firstTop) < 2).map((tile) => tile.getAttribute("data-word"));
  })()`) as readonly string[];
  let firstRowOk = 0;
  let firstRowTried = 0;
  for (const word of firstRow.slice(0, 3)) {
    const tile = page.locator(`[data-word="${word}"]`).first();
    if ((await tile.count()) === 0) continue;
    await page.mouse.move(0, 0);
    await tile.scrollIntoViewIfNeeded();
    await tile.hover();
    try { await page.locator("#vocabulary-translation-layer").waitFor({ timeout: 2_500 }); } catch { continue; }
    await page.waitForTimeout(120);
    firstRowTried += 1;
    const probe = await page.evaluate(`(() => {
      const layer = document.getElementById("vocabulary-translation-layer");
      const rect = layer.getBoundingClientRect();
      const before = layer.style.pointerEvents;
      layer.style.pointerEvents = "auto";
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      layer.style.pointerEvents = before;
      return {
        onLayer: Boolean(hit) && (hit === layer || layer.contains(hit)),
        hit: hit ? hit.tagName.toLowerCase() + "." + String(hit.className).split(" ").slice(0, 2).join(".") + " band=" + (((hit.closest("[data-band-start]") || {}).dataset || {}).bandStart ?? "none") : "none",
      };
    })()`) as Readonly<{ onLayer: boolean; hit: string }>;
    if (probe.onLayer) firstRowOk += 1;
    else console.log(`  OCCLUDED for ${word}: hit ${probe.hit}`);
  }
  check("the layer is on top for the first words of the first row", firstRowTried > 0 && firstRowOk === firstRowTried, `${firstRowOk}/${firstRowTried} on top`);

  // --- item 3: the pointer must reach the card and its buttons must work ------
  // Presence is not the assertion. For *every* button: re-open the card from the
  // word, travel to the button point by point with real waiting time, ask at each
  // point what is under the pointer, wait longer than the close delay on arrival,
  // then click and require the mark to change.
  const markWord = firstRow.find((word) => Boolean(word)) as string;
  const markTile = page.locator(`[data-word="${markWord}"]`).first();
  const readMarks = async () => (await page.evaluate(`(() => {
    const marks = {};
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sueno:vocabulary-status:v1:")) marks[key.replace("sueno:vocabulary-status:v1:", "")] = window.localStorage.getItem(key);
    }
    const tile = document.querySelector('[data-word="${markWord}"]');
    return { marks: JSON.stringify(marks), tileClasses: tile ? tile.className : "gone" };
  })()`)) as Readonly<{ marks: string; tileClasses: string }>;
  const marksBefore = await readMarks();
  const quickButtons = page.locator("#vocabulary-translation-layer .vocabulary-shelf__translation-actions button");
  const quickCount = await quickButtons.count();
  const outcomes: string[] = [];
  const walks: PointerWalk[] = [];
  let clicksThatChanged = 0;
  let aborted = 0;
  for (let index = 0; index < quickCount; index += 1) {
    const button = quickButtons.nth(index);
    const label = (await button.getAttribute("aria-label", { timeout: 2_000 }).catch(() => null)) ?? `button ${index}`;
    try {
      // Back to the word, then open the card again: each button gets its own
      // word→button trip instead of a hop between two adjacent buttons.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(CLOSE_DELAY_MS + 100);
      await markTile.scrollIntoViewIfNeeded();
      await markTile.hover();
      await page.locator("#vocabulary-translation-layer").waitFor({ timeout: 6_000 });
      await page.waitForTimeout(200); // dwell on the word, as a reader does

      const tileBox = await markTile.boundingBox();
      const buttonBox = await button.boundingBox({ timeout: 2_000 }).catch(() => null);
      if (!tileBox || !buttonBox) { outcomes.push(`${label}: no box`); continue; }
      const from = { x: tileBox.x + tileBox.width / 2, y: tileBox.y + tileBox.height - 4 };
      const to = { x: buttonBox.x + buttonBox.width / 2, y: buttonBox.y + buttonBox.height / 2 };
      const walk = await walkPointer(page, arcPath(from, to, TRAVEL_OVERSHOOT_PX, 26), markWord);
      walks.push(walk);

      // Arrive, then wait past the close delay: a card held open by a real hit
      // target is still there; one that only survived because the pointer
      // teleported is not.
      await page.mouse.move(to.x, to.y);
      await page.waitForTimeout(CLOSE_DELAY_MS + 100);
      const arrived = await page.evaluate(`(() => {
        const layer = document.getElementById("vocabulary-translation-layer");
        const row = layer ? layer.closest("li") : null;
        const tile = row ? row.querySelector("[data-word]") : null;
        const under = document.elementFromPoint(${to.x}, ${to.y});
        return {
          open: Boolean(layer),
          word: tile ? tile.getAttribute("data-word") : "none",
          underIsButton: Boolean(under && under.closest(".vocabulary-shelf__translation-actions")),
        };
      })()`) as Readonly<{ open: boolean; word: string; underIsButton: boolean }>;
      const pressed = await button.getAttribute("aria-pressed", { timeout: 2_000 }).catch(() => null);
      const before = await readMarks();
      await page.mouse.click(to.x, to.y);
      await page.waitForTimeout(250);
      const after = await readMarks();
      const changed = after.marks !== before.marks;
      if (changed) clicksThatChanged += 1;
      outcomes.push(`${label}: arrived=${arrived.open && arrived.word === markWord && arrived.underIsButton} pressed=${pressed} changed=${changed}`);
    } catch (error) {
      // A card that vanished mid-trip has to be a recorded failure, not an abort:
      // naming the dead zone is the whole point of this check.
      aborted += 1;
      outcomes.push(`${label}: vanished mid-trip (${String(error).slice(0, 80)})`);
    }
  }
  const marksAfter = await readMarks();
  for (const walk of walks) console.log(`  ${walkLine("word→button", walk)}`);
  console.log(`  marking walk (${markWord}): ${outcomes.join(" | ")}`);
  check("every point of a word→button trip has a hit target", walks.length === quickCount && quickCount > 0 && walks.every((walk) => walk.deadZones.length === 0), walks.map((walk) => `[${walk.deadZones.join(",")}]`).join(" ") || `no walk (${aborted} aborted)`);
  check("the card stays open on the same word for the whole trip", walks.length === quickCount && quickCount > 0 && walks.every((walk) => walk.lostCard.length === 0 && walk.reTargets.length === 0), walks.map((walk) => `lost[${walk.lostCard.join(",")}] re[${walk.reTargets.join(",")}]`).join(" ") || `no walk (${aborted} aborted)`);
  check("the pointer reaches the card without it vanishing", aborted === 0 && outcomes.length === quickCount && outcomes.every((entry) => entry.includes("arrived=true")), outcomes.join(" | "));
  check("every click on a card button changes the mark", quickCount > 0 && clicksThatChanged === quickCount, `${clicksThatChanged}/${quickCount} | ${outcomes.join(" | ")}`);
  check("clicking the card's buttons changes the mark", marksAfter.marks !== marksBefore.marks && /familiar|learning/.test(marksAfter.marks), `${marksBefore.marks} → ${marksAfter.marks}`);
  if (quickCount > 0 && !walks.every(walkIsClean)) console.log(`  ${walkLine("first failing trip", walks.find((walk) => !walkIsClean(walk)) as PointerWalk)}`);

  // ...and the same thing the way a hand does it: slower, from the word's edge,
  // with a pause mid-path. The walk above already replaces Playwright's
  // zero-delay `steps:`; this is the wandering variant, and it asserts the same
  // two per-step facts (a hit target under every point, the card on this word).
  {
    const humanTile = page.locator(`[data-word="${markWord}"]`).first();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(CLOSE_DELAY_MS + 100);
    await humanTile.scrollIntoViewIfNeeded();
    const humanBox = await humanTile.boundingBox();
    if (!humanBox) throw new Error("no box for the human-path check");
    await page.mouse.move(humanBox.x + humanBox.width / 2, humanBox.y + humanBox.height / 2);
    await page.waitForTimeout(700); // dwell on the word, as a reader does
    const humanButton = page.locator("#vocabulary-translation-layer .vocabulary-shelf__translation-actions button").first();
    const humanButtonBox = await humanButton.boundingBox();
    if (!humanButtonBox) throw new Error("no button box for the human-path check");
    const from = { x: humanBox.x + humanBox.width / 2, y: humanBox.y + humanBox.height - 4 };
    const to = { x: humanButtonBox.x + humanButtonBox.width / 2, y: humanButtonBox.y + humanButtonBox.height / 2 };
    // 26 points × 22 ms ≈ 570 ms of travel, with a pause at the halfway mark.
    const humanWalk = await walkPointer(page, arcPath(from, to, TRAVEL_OVERSHOOT_PX, 26), markWord, { index: 12, ms: 200 });
    // Arrive, then give a pending close longer than the close delay to fire.
    await page.mouse.move(to.x, to.y);
    await page.waitForTimeout(CLOSE_DELAY_MS + 100);
    const humanProbe = await page.evaluate(`(() => {
      const layer = document.getElementById("vocabulary-translation-layer");
      const row = layer ? layer.closest("li") : null;
      const tile = row ? row.querySelector("[data-word]") : null;
      const under = document.elementFromPoint(${to.x}, ${to.y});
      return {
        open: Boolean(layer),
        word: tile ? tile.getAttribute("data-word") : "none",
        underIsButton: Boolean(under && under.closest(".vocabulary-shelf__translation-actions")),
      };
    })()`) as Readonly<{ open: boolean; word: string; underIsButton: boolean }>;
    const humanMarksBefore = await readMarks();
    await page.mouse.click(to.x, to.y);
    await page.waitForTimeout(250);
    const humanMarksAfter = await readMarks();
    console.log(`  ${walkLine("slow wandering path", humanWalk)}`);
    check("no point on a hand's path is a dead zone", humanWalk.deadZones.length === 0, `dead zones at steps [${humanWalk.deadZones.join(",")}]`);
    check("a hand's path keeps the card on the same word", humanWalk.lostCard.length === 0 && humanWalk.reTargets.length === 0 && humanProbe.open && humanProbe.word === markWord && humanProbe.underIsButton, `card lost at [${humanWalk.lostCard.join(",")}] | re-targeted at [${humanWalk.reTargets.join(",")}] | open ${humanProbe.open} | word ${humanProbe.word} | over button ${humanProbe.underIsButton}`);
    check("a hand's click on the card's button changes the mark", humanMarksAfter.marks !== humanMarksBefore.marks && /familiar|learning/.test(humanMarksAfter.marks), `${humanMarksBefore.marks} → ${humanMarksAfter.marks}`);
  }

  // The label is the button's accessible name whether or not it is shown, and
  // focus reveals it — not only hover. Focus is reached the way a keyboard
  // reaches it: from the word, by Tab.
  const quickButton = quickButtons.first();
  const buttonName = await quickButton.getAttribute("aria-label");
  await page.mouse.move(0, 0);
  await markTile.focus();
  await page.locator("#vocabulary-translation-layer").waitFor({ timeout: 5_000 }).catch(() => {});
  await page.keyboard.press("Tab");
  const labelShownOnFocus = await page.evaluate(`(() => {
    const active = document.activeElement;
    const layer = document.getElementById("vocabulary-translation-layer");
    const isQuickButton = Boolean(active && active.closest(".vocabulary-shelf__translation-actions"));
    const label = isQuickButton ? active.querySelector(".vocabulary-shelf__translation-actions-label") : null;
    return {
      layerOpen: Boolean(layer),
      focused: active ? (active.getAttribute("aria-label") || String(active.className) || active.tagName) : "none",
      isQuickButton,
      shown: label ? getComputedStyle(label).display !== "none" : false,
    };
  })()`) as Readonly<{ layerOpen: boolean; focused: string; isQuickButton: boolean; shown: boolean }>;
  check("the icon button keeps an accessible name", (buttonName ?? "").length > 0, buttonName ?? "none");
  check("keyboard focus reveals the button's label, not only hover", labelShownOnFocus.layerOpen && labelShownOnFocus.isQuickButton && labelShownOnFocus.shown, `focused ${labelShownOnFocus.focused} | layer ${labelShownOnFocus.layerOpen} | shown ${labelShownOnFocus.shown}`);

  // --- against the real Language Reactor asset, once the scrape has landed ---
  // Sampling is driven by the asset itself: a one-meaning word, a two-meaning
  // word and a three-meaning word if it has them, so "never padded to three" is
  // checked against real data rather than asserted in the abstract.
  if (meaningAsset) {
    const byLength = [1, 2, 3]
      .map((length) => Object.entries(meaningAsset.meanings).find(([, list]) => list.length === length)?.[0])
      .filter((word): word is string => Boolean(word));
    console.log(`LR asset: ${Object.keys(meaningAsset.meanings).length} words | sampled ${byLength.join(", ") || "none"}`);
    let matched = 0;
    for (const word of byLength) {
      const tile = page.locator(`[data-word="${word}"]`).first();
      if ((await tile.count()) === 0) continue;
      await tile.scrollIntoViewIfNeeded();
      await tile.hover();
      await page.waitForTimeout(120);
      const shown = await page.locator("#vocabulary-translation .vocabulary-shelf__translation-meanings li").allInnerTexts();
      if (matchesAsset(shown, meaningAsset.meanings[word])) matched += 1;
      else console.log(`  MISMATCH for ${word}: shown ${JSON.stringify(shown)} vs asset ${JSON.stringify(meaningAsset.meanings[word])}`);
      const expectedLead = (meaningAsset.meanings[word] ?? [])[0] ?? "\u0000";
      check(`the tile leads with the asset's first meaning for ${word}`, (await tile.innerText()).includes(expectedLead), expectedLead);
    }
    check("sampled words show the asset's own list, in its own order", matched === byLength.length, `${matched}/${byLength.length} matched`);
  } else {
    console.log("LR asset not present (content/word-lists/es-meanings-v1.json): hover checked against the reviewed glossary");
  }

  // Clicking a neighbouring word while the layer is up must reach that word.
  const neighbour = page.locator(".vocabulary-study__word").nth((await page.locator(".vocabulary-study__word").count()) - 1);
  await neighbour.scrollIntoViewIfNeeded();
  await neighbour.click();
  check("a neighbour stays clickable through the layer", (await page.locator(".vocabulary-study__card").count()) === 1, "card opened");
  // Scoped to the card, and exact: with the meanings asset live, tiles for words
  // like `cerrar` legitimately carry 关闭 as their translation, and an unscoped
  // substring match then resolves to six elements.
  await page.locator(".vocabulary-study__card").getByRole("button", { name: "关闭", exact: true }).click();

  // Keyboard focus shows the same meanings.
  await cafe.scrollIntoViewIfNeeded();
  await cafe.focus();
  await tooltip.waitFor({ timeout: 10_000 });
  check("focus shows the same translation", (await tooltip.locator("li").count()) > 0 && (await tooltip.locator("li").count()) <= 3, `${await tooltip.locator("li").count()} meanings`);
  check("the focused tile is described by the layer", (await cafe.getAttribute("aria-describedby")) === "vocabulary-translation", (await cafe.getAttribute("aria-describedby")) ?? "none");
  await page.keyboard.press("Escape");
  check("escape dismisses the translation", (await page.locator("#vocabulary-translation").count()) === 0, "dismissed");

  // The layer is `fixed`: it has to move with its word, not hang over whatever
  // word is at the coordinate it was first shown at.
  // The layer is anchored inside its word's own row: it must follow that word
  // with no geometry read of its own, and go away when the pointer leaves.
  await cafe.hover();
  await tooltip.waitFor({ timeout: 10_000 });
  const anchoredIn = () => page.evaluate(() => {
    // The positioned element is the layer wrapper (the card is inside it, and
    // the actions row sits beside the card).
    const layer = document.querySelector("#vocabulary-translation-layer");
    if (!layer) return { present: false };
    const row = layer.closest("li");
    const tile = row?.querySelector("[data-word-key]");
    const layerRect = layer.getBoundingClientRect();
    return {
      present: true,
      rowIsTheWordsRow: Boolean(tile) && row?.tagName === "LI",
      gap: tile ? Math.round(layerRect.top - tile.getBoundingClientRect().bottom) : 9_999,
      pointerEvents: getComputedStyle(layer).pointerEvents,
    };
  });
  const before = await anchoredIn();
  check("the layer is anchored inside its word's own row", before.present === true && before.rowIsTheWordsRow === true && Math.abs(before.gap ?? 0) <= 12, `gap ${before.gap}px`);
  check("the layer cannot take a click", before.pointerEvents === "none", before.pointerEvents ?? "absent");

  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(250);
  const afterScroll = await anchoredIn();
  const underPointer = await page.evaluate(() => {
    const element = document.elementFromPoint(720, 400)?.closest("[data-word-key]");
    return Boolean(element && element.textContent);
  });
  check("the layer never floats away from the word under the pointer", underPointer === false || afterScroll.present === false || afterScroll.rowIsTheWordsRow === true, `row anchored: ${afterScroll.rowIsTheWordsRow ?? "gone"}`);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  check("the layer goes away when the pointer leaves the word", (await page.locator("#vocabulary-translation").count()) === 0, "gone");

  // --- item 6: the rail keeps its accessible name and the explanation stays ---
  const railName = await page.locator('nav[aria-label="按名次跳转"]').count();
  check("the rail keeps an accessible name without its caption", railName === 1, `${railName} named rail`);
  const railText = await page.locator(".vocabulary-rank-rail").innerText().catch(() => "");
  check("the rail shows only its numbers", !/名次|滤除|功能词/u.test(railText), railText.replace(/\s+/g, " ").slice(0, 40) || "empty");
  const countLine = await page.locator(".lexicon-result-count").innerText().catch(() => "");
  check("the page still explains what the rank is", /已过滤功能词/u.test(countLine), countLine.slice(0, 60));

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

  // --- item 5: the icon becomes the way back, reachable by keyboard and touch -
  const clearLink = page.getByRole("link", { name: /清除搜索/u });
  const clearCount = await clearLink.count();
  check("an active search turns the icon into a clear control", clearCount === 1, `${clearCount} found`);
  if (clearCount === 1) {
    await clearLink.focus();
    const focused = await page.evaluate(`(() => document.activeElement ? document.activeElement.getAttribute("aria-label") : null)()`) as string | null;
    check("the clear control is reachable by keyboard", typeof focused === "string" && focused.includes("清除搜索"), focused ?? "none");
    const clearBox = await clearLink.boundingBox();
    check("the clear control is a 44px touch target", clearBox !== null && clearBox.width >= 44 && clearBox.height >= 44, clearBox ? `${Math.round(clearBox.width)}x${Math.round(clearBox.height)}` : "no box");
    await clearLink.click();
    // The shelf comes back through a client-side navigation that re-reads the
    // corpus, so wait for the tiles rather than for the network to go quiet.
    await page.waitForFunction(`document.querySelectorAll(".vocabulary-study__word").length > 100`, undefined, { timeout: 180_000 }).catch(() => {});
    const afterClear = await page.locator(".vocabulary-study__word").count();
    check("clearing the search returns the whole shelf", !page.url().includes("search=") && afterClear === 7_922, `${afterClear} tiles | ${page.url()}`);
  }

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
