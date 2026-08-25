import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileOverviewPanel } from "@/src/modules/profile/ui/profile-overview-panel";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ProfileOverviewPanel", () => {
  it("shows eight axes and updates the selected detail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          axes: ([
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
          ]).map((axis) => ({
            previousMastery: null,
            previousConfidence: null,
            representativeAttempts: [],
            ...axis,
          })),
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
    expect(screen.getAllByText("四周前").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("完成可追溯表达后，这里会显示代表性尝试。")).toBeInTheDocument();
  });

  it("renders historical comparison and representative attempts for the selected axis", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          axes: Array.from({ length: 8 }, (_, index) => ({
            key: index === 0 ? "listening-comprehension" : `axis-${index}`,
            label: index === 0 ? "听辨理解" : `维度 ${index}`,
            description: "测试维度",
            mastery: index === 0 ? 0.75 : null,
            confidence: index === 0 ? 0.8 : null,
            oralCoverage: index === 0 ? 0.5 : null,
            evidenceCount: index === 0 ? 2 : 0,
            lastEvidenceAt: index === 0 ? "2026-08-22T08:00:00.000Z" : null,
            previousMastery: 0.5,
            previousConfidence: index === 0 ? 0.6 : null,
            representativeAttempts: index === 0 ? [{
              occurredAt: "2026-08-22T08:00:00.000Z",
              modality: "speech",
              sceneLabel: "咖啡馆",
              hintLevel: 1,
            }] : [],
            skillKeys: index === 0 ? ["listening.primary"] : [],
            status: index === 0 ? "developing" : "data-insufficient",
          })),
          generatedAt: "2026-08-23T00:00:00.000Z",
          summary: { totalAxes: 8, totalEvidence: 2, verifiedAxes: 0 },
        },
      }),
    });

    render(<ProfileOverviewPanel />);
    await waitFor(() => expect(screen.getByTestId("profile-overview")).toBeInTheDocument());

    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(document.querySelector(".profile-radar__area--previous")).toBeInTheDocument();
    expect(screen.getByText("咖啡馆")).toBeInTheDocument();
    expect(screen.getByText("使用 1 级提示")).toBeInTheDocument();
  });

  it("recovers from a profile request failure with the retry action", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            axes: Array.from({ length: 8 }, (_, index) => ({
              key: index === 0 ? "listening-comprehension" : `axis-${index}`,
              label: index === 0 ? "听辨理解" : `维度 ${index}`,
              description: "测试维度",
              mastery: null,
              confidence: null,
              oralCoverage: null,
              evidenceCount: 0,
              lastEvidenceAt: null,
              previousMastery: null,
              previousConfidence: null,
              representativeAttempts: [],
              skillKeys: [],
              status: "data-insufficient",
            })),
            generatedAt: "2026-08-25T00:00:00.000Z",
            summary: { totalAxes: 8, totalEvidence: 0, verifiedAxes: 0 },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(<ProfileOverviewPanel />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByTestId("profile-overview")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
