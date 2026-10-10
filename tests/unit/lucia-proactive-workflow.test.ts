import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lucía proactive workflow", () => {
  it("fails the workflow when proactive generation fails", () => {
    const workflow = readFileSync(".github/workflows/lucia-proactive-daily.yml", "utf8");

    expect(workflow).toContain("continue-on-error: false");
    expect(workflow).not.toContain("continue-on-error: true");
  });
});
