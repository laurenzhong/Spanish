import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lucía proactive workflow", () => {
  it("fails the workflow when proactive generation fails", () => {
    const workflow = readFileSync(".github/workflows/lucia-proactive-daily.yml", "utf8");

    expect(workflow).toContain("continue-on-error: false");
    expect(workflow).not.toContain("continue-on-error: true");
    expect(workflow).toContain("CONVERSATION_PROVIDER: ${{ vars.CONVERSATION_PROVIDER || 'deepseek' }}");
    expect(workflow).toContain("OPENAI_API_ENDPOINT: ${{ vars.OPENAI_API_ENDPOINT || 'https://api.deepseek.com/v1' }}");
    expect(workflow).toContain("OPENAI_API_STYLE: ${{ vars.OPENAI_API_STYLE || 'chat-completions' }}");
    expect(workflow).toContain("OPENAI_REASONING_EFFORT: ${{ vars.OPENAI_REASONING_EFFORT || 'high' }}");
    expect(workflow).toContain("OPENAI_CONVERSATION_MODEL: ${{ vars.OPENAI_CONVERSATION_MODEL || 'deepseek-flash' }}");
  });
});
