import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lucía proactive workflow", () => {
  it("fails the workflow when proactive generation fails", () => {
    const workflow = readFileSync(".github/workflows/lucia-proactive-daily.yml", "utf8");

    expect(workflow).toContain("continue-on-error: false");
    expect(workflow).not.toContain("continue-on-error: true");
  });

  it("keeps the scheduled runner bounded, serialized, and explicitly configured", () => {
    const workflow = readFileSync(".github/workflows/lucia-proactive-daily.yml", "utf8");
    expect(workflow).toContain('cron: "*/15 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("group: lucia-proactive-${{ github.ref }}");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain("LUCIA_PROACTIVE_USER_IDS: ${{ vars.LUCIA_PROACTIVE_USER_IDS }}");
    expect(workflow).toContain("ref: 97627ab52678aa1af469f78869ec599597e494f0");
    expect(workflow).toContain("CONVERSATION_PROVIDER: ${{ vars.CONVERSATION_PROVIDER || 'deepseek' }}");
    expect(workflow).toContain("OPENAI_API_ENDPOINT: ${{ vars.OPENAI_API_ENDPOINT || 'https://api.deepseek.com/v1' }}");
    expect(workflow).toContain("OPENAI_API_STYLE: ${{ vars.OPENAI_API_STYLE || 'chat-completions' }}");
    expect(workflow).toContain("OPENAI_REASONING_EFFORT: ${{ vars.OPENAI_REASONING_EFFORT || 'high' }}");
    expect(workflow).toContain("OPENAI_CONVERSATION_MODEL: ${{ vars.OPENAI_CONVERSATION_MODEL || 'deepseek-flash' }}");
    expect(workflow).toContain("run: pnpm conversation:proactive");
  });
});
