import { expect, test, type Page } from "@playwright/test";

const e2eUserId = "00000000-0000-4000-8000-000000000001";
const e2eBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3101"}`;

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: e2eUserId, url: e2eBaseUrl }]);
}

function profileFixture() {
  const axes = Array.from({ length: 8 }, (_, index) => ({ key: `axis-${index}`, label: `旧维度 ${index}`, description: "历史审计维度", mastery: null, confidence: null, oralCoverage: null, evidenceCount: 0, lastEvidenceAt: null, previousMastery: null, previousConfidence: null, representativeAttempts: [], skillKeys: [], status: "data-insufficient" }));
  const groups = [
    ["lexical", "词汇与短语"],
    ["communication", "交流运用"],
    ["voice", "语音表达"],
    ["shadowing", "跟读表现"],
  ].map(([key, label]) => ({ key, label, description: "当前还在积累证据。", mastery: null, confidence: null, oralCoverage: null, evidenceCount: 0, lastEvidenceAt: null, previousMastery: null, previousConfidence: null, representativeAttempts: [], skillKeys: [], skills: [], status: "data-insufficient" }));
  return { apiVersion: "v1", data: { axes, generatedAt: "2026-09-14T00:00:00.000Z", summary: { totalAxes: 8, totalEvidence: 0, verifiedAxes: 0 }, capabilityGroups: groups, capabilitySummary: { totalEvidence: 0, totalGroups: 4, verifiedGroups: 0 } } };
}

test("shows four capability groups and keeps the profile usable on phone and desktop", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/profile", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileFixture()) }));
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto("/me");
    await expect(page.getByRole("region", { name: "四板块能力", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /词汇与短语/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /交流运用/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /语音表达/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /跟读表现/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
