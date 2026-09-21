import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const e2eUserId = "00000000-0000-4000-8000-000000000001";
const artifactRoot = process.env.SUENO_UI_ARTIFACT_ROOT ?? "D:/temp/sueno-ui-system-001/UI-SYSTEM-001I";
const routes = [
  { name: "public home", path: "/", heading: "把认识的西语，变成真正说得出口的话。", authenticated: false },
  { name: "learn library", path: "/learn", heading: "学习媒体库", authenticated: true },
  { name: "explore", path: "/explore", heading: "校园办事：注册与材料", authenticated: true },
  { name: "read shelf", path: "/read", heading: "阅读", authenticated: true },
  { name: "article reader", path: "/read/article/article.sueno-first-cafe@1", heading: "Una conversación que empieza con un café", authenticated: true },
  { name: "chat", path: "/chat/lucia", heading: "Lucía Martín", authenticated: true },
  { name: "profile", path: "/me", heading: "我的进步", authenticated: true },
  { name: "content workflow", path: "/me/content-workflow", heading: "内容工作流", authenticated: true },
] as const;

type AxeResult = {
  route: string;
  name: string;
  project: string;
  viewport: string;
  colorScheme: "light" | "dark";
  reducedMotion: boolean;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  violations: Array<{
    id: string;
    impact: string | null | undefined;
    help: string;
    nodes: Array<{
      target: string[];
      html: string;
      failureSummary: string | undefined;
    }>;
  }>;
};

const results: AxeResult[] = [];

async function authenticate(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Playwright baseURL is required for the accessibility gate.");
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: baseURL }]);
}

async function scanRoute(
  page: Page,
  baseURL: string | undefined,
  route: (typeof routes)[number],
  project: string,
  colorScheme: "light" | "dark",
  reducedMotion: boolean,
) {
  if (route.authenticated) await authenticate(page, baseURL);
  await page.emulateMedia({ colorScheme, reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.addInitScript((theme) => {
    window.localStorage.setItem("spanish-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, colorScheme);
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
  // Authenticated fixture routes may keep an unavailable API request open.
  // Axe only needs the rendered DOM, so use a bounded quiet period instead of
  // making the scan depend on every background request settling.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(50);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const counts = axe.violations.reduce(
    (acc, violation) => {
      const impact = violation.impact ?? "minor";
      if (impact === "critical" || impact === "serious" || impact === "moderate" || impact === "minor") acc[impact] += 1;
      return acc;
    },
    { critical: 0, serious: 0, moderate: 0, minor: 0 },
  );
  const result: AxeResult = {
    route: route.path,
    name: route.name,
    project,
    viewport: `${await page.evaluate(() => window.innerWidth)}x${await page.evaluate(() => window.innerHeight)}`,
    colorScheme,
    reducedMotion,
    ...counts,
    violations: axe.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target.map(String), html: node.html, failureSummary: node.failureSummary })),
    })),
  };
  results.push(result);
  expect(result.critical, `${route.path} has critical axe violations`).toBe(0);
  expect(result.serious, `${route.path} has serious axe violations`).toBe(0);
}

test.describe.configure({ mode: "serial" });

for (const route of routes) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe: ${route.name} (${colorScheme})`, async ({ page, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chromium", "Run one deterministic axe scan per route.");
      await scanRoute(page, baseURL, route, testInfo.project.name, colorScheme, false);
    });
  }
}

test.afterAll(() => {
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(
    join(artifactRoot, "axe-results.json"),
    JSON.stringify(
      {
        task: "UI-SYSTEM-001",
        batch: "UI-SYSTEM-001I",
        generatedAt: new Date().toISOString(),
        environment: "local fake/fixture Playwright Chromium; light and dark; prefers-reduced-motion",
        routes: results,
        summary: {
          routes: results.length,
          critical: results.reduce((sum, result) => sum + result.critical, 0),
          serious: results.reduce((sum, result) => sum + result.serious, 0),
          moderate: results.reduce((sum, result) => sum + result.moderate, 0),
          minor: results.reduce((sum, result) => sum + result.minor, 0),
        },
      },
      null,
      2,
    ),
    "utf8",
  );
});
