import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

type ReplayCase = Readonly<{
  caseId: string;
  category: string;
  dailyState: string;
  relationshipStage: string;
  userMessage: string;
  responseActPlan: string;
  questionBudget: number;
  intensityCeiling: number;
  inputKind?: string;
  expectedOutputStatus?: string;
}>;

describe("Lucía provider-neutral replay contract", () => {
  it("keeps fixed scenarios independent from a concrete provider", async () => {
    const root = path.join(process.cwd(), "tests", "fixtures", "evaluation", "lucia-provider-v1");
    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as { providerNeutral: boolean; cases: string };
    const cases = JSON.parse(await readFile(path.join(root, manifest.cases), "utf8")) as ReplayCase[];
    expect(manifest.providerNeutral).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(cases.map((item) => item.caseId)).size).toBe(cases.length);
    for (const item of cases) {
      expect(item.caseId).toMatch(/^[A-F]\d{2}$/u);
      expect(item.responseActPlan).not.toMatch(/minimax|openai|gpt|model/iu);
      expect(item.questionBudget).toBeGreaterThanOrEqual(0);
      expect(item.intensityCeiling).toBeGreaterThanOrEqual(0);
    }
    expect(cases.find((item) => item.caseId === "F05")).toMatchObject({ expectedOutputStatus: "no-reply", inputKind: "provider-failure" });
  });
});
