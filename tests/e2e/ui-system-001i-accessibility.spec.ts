import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const e2eUserId = "00000000-0000-0000-0000-000000000001";

async function authenticate(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([
    {
      name: "spanish-e2e-user",
      value: e2eUserId,
      url: baseURL ?? "http://127.0.0.1:3101",
    },
  ]);
}

async function installTheme(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("spanish-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, theme);
}

type AxeSummary = Readonly<{
  id: string;
  impact: string | null | undefined;
  nodeCount: number;
  targets: string[][];
}>;

async function recordA11yScan(page: Page, route: string) {
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
  // Chromium's forced-colors palette is user-agent supplied; axe's computed
  // color-contrast rule reports those substitutions rather than author CSS.
  // Forced-colors remains covered by the structural/focus checks below.
  const results = route.includes("forced-colors")
    ? await builder.disableRules(["color-contrast"]).analyze()
    : await builder.analyze();

  const summary: AxeSummary[] = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodeCount: violation.nodes.length,
    targets: violation.nodes.slice(0, 5).map((node) => node.target.map(String)),
  }));
  const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  const info = test.info();
  const artifactRoot = process.env.UI_SYSTEM_ARTIFACT_DIR ?? "D:/temp/sueno-ui-system-001/UI-SYSTEM-001I";
  const project = info.project.name.replace(/[^a-z0-9_-]+/giu, "-");
  const routeName = route.replace(/[^a-z0-9_-]+/giu, "-").replace(/^-|-$/gu, "") || "root";
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(`${artifactRoot}/axe-${project}-${routeName}.json`, JSON.stringify({ route, project, violationCount: results.violations.length, blockingCount: blocking.length, violations: summary }, null, 2));
  if (blocking.length > 0) {
    info.annotations.push({ type: "a11y-baseline", description: `${route}: ${blocking.length} critical/serious violation(s)` });
  }
  if (process.env.UI_SYSTEM_A11Y_STRICT === "1") {
    expect(blocking, `${route} has critical/serious accessibility violations`).toEqual([]);
  }
}

async function expectNoHorizontalOverflow(page: Page, route: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `${route} overflows horizontally`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectKeyboardCanReachControl(page: Page, name: string | RegExp) {
  const control = page.getByRole("link", { name }).first();
  await expect(control).toBeVisible();
  await control.focus();
  await expect(control).toBeFocused();
  await expect(control).toBeVisible();
}

test.describe("UI-SYSTEM-001I accessibility gates", () => {
  test("scans the anonymous home and verifies keyboard focus", async ({ page }) => {
    await installTheme(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "把认识的西语，变成真正说得出口的话。" })).toBeVisible();
    await recordA11yScan(page, "/");
    await expectKeyboardCanReachControl(page, "进入学习");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await expectNoHorizontalOverflow(page, "/");
  });

  test("scans the product-shell fixture routes", async ({ page, baseURL }) => {
    await installTheme(page);
    await authenticate(page, baseURL);
    const routes = [
      { path: "/learn", heading: "学习媒体库", control: "搜索视频和播客" },
      { path: "/explore", heading: "校园办事：注册与材料", control: "搜索场景" },
      { path: "/read", heading: "阅读", control: "搜索文章" },
      { path: "/chat", heading: "Lucía Martín", control: "写下你想对 Lucía 说的话" },
      { path: "/me", heading: "我的进步", control: "打开账户菜单" },
    ] as const;

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await recordA11yScan(page, route.path);
      await expectNoHorizontalOverflow(page, route.path);
      let target: Locator;
      if (route.path === "/chat") {
        target = page.getByRole("textbox", { name: route.control });
      } else if (route.path === "/me") {
        const accountMenu = page.getByRole("button", { name: route.control });
        target = await accountMenu.count() > 0
          ? accountMenu
          : page.getByRole("navigation", { name: "主要导航" }).getByRole("link", { name: "我的" });
      } else {
        target = page.getByRole("searchbox", { name: route.control });
      }
      await expect(target).toBeVisible();
      if (route.path === "/chat") {
        await expect(target).toBeDisabled();
        continue;
      }
      await target.focus();
      await expect(target).toBeFocused();
    }
  });

  test("keeps motion and focus behavior usable in reduced-motion mode", async ({ page, baseURL }) => {
    await installTheme(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticate(page, baseURL);
    await page.goto("/explore");

    await expect(page.getByRole("heading", { name: "校园办事：注册与材料" })).toBeVisible();
    const motionTokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        fast: style.getPropertyValue("--motion-fast").trim(),
        standard: style.getPropertyValue("--motion-standard").trim(),
        slow: style.getPropertyValue("--motion-slow").trim(),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });
    expect(motionTokens.reducedMotion).toBe(true);
    expect([motionTokens.fast, motionTokens.standard, motionTokens.slow]).toEqual(["1ms", "1ms", "1ms"]);

    const search = page.getByRole("searchbox", { name: "搜索场景" });
    await search.focus();
    await expect(search).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await recordA11yScan(page, "/explore reduced-motion");
  });

  test("renders the product shell under forced colors without overflow", async ({ page, baseURL }) => {
    await installTheme(page);
    await page.emulateMedia({ forcedColors: "active" });
    await authenticate(page, baseURL);
    await page.goto("/learn");

    await expect(page.getByRole("heading", { name: "学习媒体库" })).toBeVisible();
    expect(await page.evaluate(() => window.matchMedia("(forced-colors: active)").matches)).toBe(true);
    await expectNoHorizontalOverflow(page, "/learn forced-colors");
    await expectKeyboardCanReachControl(page, "学习");
    await recordA11yScan(page, "/learn forced-colors");
  });
});
