import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileOverviewPanel } from "@/src/modules/profile/ui/profile-overview-panel";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ProfileOverviewPanel", () => {
  it("shows eight axes and updates the selected detail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          axes: [
            {
              key: "listening-comprehension",
              label: "听辨理解",
              description: "听懂对方的重点、意图和语气。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
            {
              key: "instant-reaction",
              label: "即时反应",
              description: "在有限准备时间内组织出可接住的回应。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
            {
              key: "pronunciation-clarity",
              label: "发音清晰",
              description: "让关键发音足够清楚，不要求唯一口音。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
            {
              key: "fluency-rhythm",
              label: "语流节奏",
              description: "保持自然的停顿、连贯和轮次衔接。",
              mastery: 0.8,
              confidence: 0.8,
              oralCoverage: 1,
              evidenceCount: 3,
              lastEvidenceAt: "2026-08-22T08:00:00.000Z",
              skillKeys: ["fluency.turn-taking"],
              status: "verified",
            },
            {
              key: "expression-accuracy",
              label: "表达准确",
              description: "用合适的词形和结构表达想传达的意思。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
            {
              key: "conversation-strategy",
              label: "交际策略",
              description: "会请求澄清、修复误解并推动沟通继续。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
            {
              key: "chunk-retrieval",
              label: "语块调用",
              description: "在真实情境中调用熟悉表达，而不是逐词翻译。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
            {
              key: "transfer-expression",
              label: "迁移表达",
              description: "把学过的表达迁移到陌生信息和关系中。",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              skillKeys: [],
              status: "data-insufficient",
            },
          ],
          generatedAt: "2026-08-23T00:00:00.000Z",
          summary: { totalAxes: 8, totalEvidence: 3, verifiedAxes: 1 },
        },
      }),
    });

    render(<ProfileOverviewPanel />);
    await waitFor(() => expect(screen.getByTestId("profile-overview")).toBeInTheDocument());

    expect(screen.getByTestId("profile-overview").querySelectorAll(".profile-axis-list button")).toHaveLength(8);
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /语流节奏/ })[0]);
    expect(screen.getByRole("heading", { name: "语流节奏" })).toBeInTheDocument();
    expect(screen.getByText("已验证 · 掌握度与证据可信度都达到当前验证门槛。")).toBeInTheDocument();
  });
});
