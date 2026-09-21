import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const e2eUserId = "00000000-0000-0000-0000-000000000001";
const artifactRoot = process.env.SUENO_UI_ARTIFACT_ROOT ?? "D:/temp/sueno-ui-system-001/UI-SYSTEM-001J";
const batchName = process.env.SUENO_UI_BATCH ?? "UI-SYSTEM-001J";

type ActionMeasure = Readonly<{
  name: string;
  durationMs: number | null;
  completed: boolean;
}>;

type PerformanceSnapshot = Readonly<{
  navigation: Readonly<{ ttfbMs: number | null; domContentLoadedMs: number | null; loadEventMs: number | null }>;
  paint: Readonly<{ fcpMs: number | null; lcpMs: number | null }>;
  cls: number;
  longTasks: Readonly<{ count: number; maxDurationMs: number; totalDurationMs: number }>;
  eventTiming: Readonly<{ supported: boolean; count: number; maxDurationMs: number; p75DurationMs: number | null }>;
  resources: Readonly<{ count: number; transferBytes: number; encodedBytes: number }>;
}>;

type InteractionArtifact = Readonly<{
  task: "UI-SYSTEM-001";
  batch: string;
  generatedAt: string;
  project: string;
  sample: number;
  viewport: string;
  route: string;
  status: "pass" | "partial" | "fail";
  actions: readonly ActionMeasure[];
  performance: PerformanceSnapshot;
  thresholds: Readonly<{ actionLatencyMs: number; inpMs: number; longTaskMs: number }>;
  notes: readonly string[];
}>;

type PerfWindow = Window & {
  __suenoUiPerformance?: {
    eventTimingSupported: boolean;
    eventDurations: number[];
    longTasks: number[];
    layoutShift: number;
    lcp: number | null;
  };
};

async function authenticate(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Playwright baseURL is required for the performance gate.");
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: baseURL }]);
}

async function installPerformanceObservers(page: Page) {
  await page.addInitScript(() => {
    const state = {
      eventTimingSupported: false,
      eventDurations: [] as number[],
      longTasks: [] as number[],
      layoutShift: 0,
      lcp: null as number | null,
    };
    const register = (type: string, callback: (entries: PerformanceEntry[]) => void, options: PerformanceObserverInit) => {
      try {
        const observer = new PerformanceObserver((list) => callback(list.getEntries()));
        observer.observe(options);
        return true;
      } catch {
        return false;
      }
    };
    state.eventTimingSupported = register("event", (entries) => {
      for (const entry of entries) {
        const duration = entry.duration;
        if (Number.isFinite(duration) && duration > 0) state.eventDurations.push(duration);
      }
    }, { type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    register("longtask", (entries) => {
      for (const entry of entries) if (Number.isFinite(entry.duration)) state.longTasks.push(entry.duration);
    }, { type: "longtask", buffered: true });
    register("layout-shift", (entries) => {
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput && Number.isFinite(shift.value)) state.layoutShift += shift.value ?? 0;
      }
    }, { type: "layout-shift", buffered: true });
    register("largest-contentful-paint", (entries) => {
      const last = entries.at(-1);
      if (last) state.lcp = last.startTime;
    }, { type: "largest-contentful-paint", buffered: true });
    (window as PerfWindow).__suenoUiPerformance = state;
  });
}

async function measureAction(page: Page, name: string, action: () => Promise<void>, completed: () => Promise<void>): Promise<ActionMeasure> {
  const mark = `sueno-ui-${name}`;
  await page.evaluate((markName) => performance.mark(`${markName}-start`), mark);
  let didComplete = false;
  try {
    await action();
    await completed();
    didComplete = true;
  } finally {
    await page.evaluate((markName) => {
      performance.mark(`${markName}-end`);
      performance.measure(markName, `${markName}-start`, `${markName}-end`);
    }, mark);
  }
  const durationMs = await page.evaluate((markName) => {
    const measure = performance.getEntriesByName(markName, "measure").at(-1);
    return measure ? Math.round(measure.duration * 100) / 100 : null;
  }, mark);
  return { name, durationMs, completed: didComplete };
}

async function readPerformanceSnapshot(page: Page): Promise<PerformanceSnapshot> {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation").at(-1) as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint").at(-1)?.startTime ?? null;
    const state = (window as PerfWindow).__suenoUiPerformance;
    const eventDurations = [...(state?.eventDurations ?? [])].sort((left, right) => left - right);
    const longTasks = state?.longTasks ?? [];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return {
      navigation: {
        ttfbMs: navigation ? Math.round((navigation.responseStart - navigation.requestStart) * 100) / 100 : null,
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd * 100) / 100 : null,
        loadEventMs: navigation ? Math.round(navigation.loadEventEnd * 100) / 100 : null,
      },
      paint: { fcpMs: fcp === null ? null : Math.round(fcp * 100) / 100, lcpMs: state?.lcp === null || state?.lcp === undefined ? null : Math.round(state.lcp * 100) / 100 },
      cls: Math.round((state?.layoutShift ?? 0) * 10_000) / 10_000,
      longTasks: {
        count: longTasks.length,
        maxDurationMs: longTasks.length ? Math.round(Math.max(...longTasks) * 100) / 100 : 0,
        totalDurationMs: Math.round(longTasks.reduce((sum, duration) => sum + duration, 0) * 100) / 100,
      },
      eventTiming: {
        supported: state?.eventTimingSupported ?? false,
        count: eventDurations.length,
        maxDurationMs: eventDurations.length ? Math.round(Math.max(...eventDurations) * 100) / 100 : 0,
        p75DurationMs: eventDurations.length ? Math.round(eventDurations[Math.min(eventDurations.length - 1, Math.floor(eventDurations.length * 0.75))] * 100) / 100 : null,
      },
      resources: {
        count: resources.length,
        transferBytes: resources.reduce((sum, resource) => sum + (resource.transferSize || 0), 0),
        encodedBytes: resources.reduce((sum, resource) => sum + (resource.encodedBodySize || 0), 0),
      },
    } satisfies PerformanceSnapshot;
  });
}

async function writeArtifact(page: Page, testInfo: TestInfo, route: string, actions: readonly ActionMeasure[], notes: readonly string[]) {
  const performance = await readPerformanceSnapshot(page);
  const actionLatencyBudget = 200;
  const inpBudget = 200;
  const longTaskBudget = 200;
  const hasCompletedActionOverBudget = actions.some((action) => action.completed && (action.durationMs ?? 0) > actionLatencyBudget);
  const hasLongInteraction = performance.eventTiming.p75DurationMs !== null && performance.eventTiming.p75DurationMs > inpBudget;
  const hasLongTask = performance.longTasks.maxDurationMs > longTaskBudget;
  const status = hasCompletedActionOverBudget || hasLongInteraction || hasLongTask ? "partial" : "pass";
  const artifact: InteractionArtifact = {
    task: "UI-SYSTEM-001",
    batch: batchName,
    generatedAt: new Date().toISOString(),
    project: testInfo.project.name,
    sample: testInfo.repeatEachIndex + 1,
    viewport: `${page.viewportSize()?.width ?? "unknown"}x${page.viewportSize()?.height ?? "unknown"}`,
    route,
    status,
    actions,
    performance,
    thresholds: { actionLatencyMs: actionLatencyBudget, inpMs: inpBudget, longTaskMs: longTaskBudget },
    notes: [
      "Action latency is a user-visible completion measure, not a substitute for Event Timing INP.",
      performance.eventTiming.supported ? "Event Timing entries were available in this browser." : "Event Timing entries were unavailable; INP remains not_run.",
      ...notes,
    ],
  };
  await mkdir(artifactRoot, { recursive: true });
  const filename = `interaction-${testInfo.project.name}-${route.replace(/[^a-z0-9_-]+/giu, "-").replace(/^-|-$/gu, "") || "root"}-sample-${testInfo.repeatEachIndex + 1}.json`;
  await writeFile(`${artifactRoot}/${filename}`, JSON.stringify(artifact, null, 2), "utf8");
  expect(actions.every((action) => action.completed), `${route} interaction did not complete`).toBe(true);
}

async function installConversationFixture(page: Page) {
  await page.route("**/api/v1/conversations", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { conversations: [{ conversationId: "conversation-lucia", characterKey: "lucia", characterName: "Lucía Martín", avatarClass: "avatar--lucia", roleLabel: "主要好友", lastMessageAt: null, lastMessage: null }] } }) });
  });
  await page.route("**/api/v1/character-network/lucia-contact", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey: "lucia", status: "active", relationshipStage: "familiar", conversationId: "conversation-lucia" } }) });
  });
  await page.route("**/api/v1/character-network/introductions", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { offers: [] } }) });
  });
  await page.route("**/api/v1/conversations/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { characterKey: "lucia", messages: [] } }) });
  });
  await page.route("**/api/v1/conversations/*/stream", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise(() => undefined);
  });
}

test.describe("UI-SYSTEM-001J interaction performance", () => {
  // A fresh isolated Next dev build can spend more than the default 30s
  // compiling the first authenticated route; do not classify that warm-up as
  // an interaction failure.
  test.setTimeout(60_000);

  test("measures learn search and filter popover", async ({ page, baseURL }, testInfo) => {
    await installPerformanceObservers(page);
    await authenticate(page, baseURL);
    await page.goto("/learn", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "学习媒体库" })).toBeVisible();
    const actions: ActionMeasure[] = [];
    actions.push(await measureAction(page, "learn-filter-open", async () => {
      await page.getByRole("button", { name: /筛选/u }).click();
    }, async () => {
      await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
    }));
    actions.push(await measureAction(page, "learn-filter-select", async () => {
      await page.getByRole("combobox", { name: "地区" }).selectOption("es-ES");
    }, async () => {
      await expect(page.getByRole("combobox", { name: "地区" })).toHaveValue("es-ES");
    }));
    await page.keyboard.press("Escape");
    await writeArtifact(page, testInfo, "/learn", actions, ["No real media or provider request was used."]);
  });

  test("measures explore filter interaction", async ({ page, baseURL }, testInfo) => {
    await installPerformanceObservers(page);
    await authenticate(page, baseURL);
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "探索场景" })).toBeVisible();
    const actions: ActionMeasure[] = [];
    actions.push(await measureAction(page, "explore-filter-open", async () => {
      await page.getByRole("button", { name: "筛选场景" }).click();
    }, async () => {
      await expect(page.getByRole("dialog", { name: "场景筛选" })).toBeVisible();
    }));
    actions.push(await measureAction(page, "explore-filter-available", async () => {
      await page.getByRole("button", { name: "可立即开始" }).click();
    }, async () => {
      await expect(page).toHaveURL(/(?:\?|&)filter=available(?:&|$)/u);
    }));
    await writeArtifact(page, testInfo, "/explore", actions, ["Filter navigation was exercised against the local fixture route."]);
  });

  test("measures chat send and stop interaction", async ({ page, baseURL }, testInfo) => {
    await installPerformanceObservers(page);
    await authenticate(page, baseURL);
    await installConversationFixture(page);
    await page.goto("/chat/lucia", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Lucía Martín" })).toBeVisible();
    const composer = page.getByRole("textbox", { name: "写下你想对 Lucía 说的话" });
    await composer.fill("Hola, Lucía");
    const actions: ActionMeasure[] = [];
    actions.push(await measureAction(page, "chat-send-to-stop-visible", async () => {
      await page.getByRole("button", { name: "发送消息" }).click();
    }, async () => {
      await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
    }));
    actions.push(await measureAction(page, "chat-stop-to-cancelled", async () => {
      await page.getByRole("button", { name: "停止回复" }).click();
    }, async () => {
      await expect(page.locator('[data-status="cancelled"]')).toBeVisible();
    }));
    await writeArtifact(page, testInfo, "/chat/lucia", actions, ["Streaming was held by a local route fixture and cancelled through the user-facing Stop control."]);
  });
});
