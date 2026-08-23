import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentPackExperience } from "@/src/modules/content/ui/content-pack-experience";
import {
  completeContentPackActivity,
  createContentPackProgress,
  isContentPackAvailable,
  parseContentPackProgress,
  projectContentPack,
} from "@/src/modules/content/domain";

const pack = projectContentPack({
  stableKey: "test.cafe-pack",
  version: 1,
  title: { "zh-CN": "咖啡馆对话" },
  summary: { "zh-CN": "听懂并继续一段自然对话。" },
  cefr: "A2",
  status: "draft",
  segments: [
    {
      position: 0,
      text: "Hola, me llamo Ana.",
      translations: { "zh-CN": "你好，我叫 Ana。" },
      chunks: [{ kind: "target", stressed: true, text: "me llamo Ana" }],
    },
  ],
  activities: [
    {
      position: 0,
      segmentPosition: undefined,
      activityType: "listening",
      modality: "listening",
      instructions: { "zh-CN": "先听全文。" },
      configuration: { scope: "full" },
    },
    {
      position: 1,
      segmentPosition: 0,
      activityType: "reading",
      modality: "reading",
      instructions: { "zh-CN": "展开第一段。" },
      configuration: { showTranslation: true },
    },
    {
      position: 2,
      segmentPosition: 0,
      activityType: "typing",
      modality: "typing",
      instructions: { "zh-CN": "写一句回复。" },
      configuration: { minimumCharacters: 3, createsOralEvidence: false },
    },
    {
      position: 3,
      segmentPosition: 0,
      activityType: "speaking",
      modality: "speech",
      instructions: { "zh-CN": "准备开口。" },
      configuration: { createsOralEvidence: true },
    },
  ],
});

describe("content pack domain and experience", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it("keeps draft packs unavailable unless explicitly allowed", () => {
    expect(isContentPackAvailable(pack)).toBe(false);
    expect(isContentPackAvailable(pack, true)).toBe(true);
  });

  it("restores only known activities and safely falls back from corrupt progress", () => {
    const progress = parseContentPackProgress(pack, {
      completedActivityIds: [pack.activities[0]?.id, "unknown"],
      currentActivityId: "unknown",
      draftReply: "a".repeat(5_000),
    });
    expect(progress.completedActivityIds).toEqual([pack.activities[0]?.id]);
    expect(progress.currentActivityId).toBe(pack.activities[1]?.id);
    expect(progress.draftReply).toHaveLength(4_000);
    expect(parseContentPackProgress(pack, "bad")).toEqual(createContentPackProgress(pack));
  });

  it("renders a single linear experience and uses browser text fallback", async () => {
    const user = userEvent.setup();
    render(<ContentPackExperience pack={pack} />);

    expect(screen.getByRole("heading", { name: "咖啡馆对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放全文" })).toBeInTheDocument();
    expect(screen.queryByText("Hola, me llamo Ana.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "播放全文" }));
    expect(screen.getByRole("status")).toHaveTextContent("浏览器暂时无法朗读");

    await user.click(screen.getByRole("button", { name: "展开西语和中文" }));
    expect(screen.getByText("Hola, me llamo Ana.")).toBeInTheDocument();
    expect(screen.getByText("你好，我叫 Ana。")).toBeInTheDocument();
  });

  it("persists a typed draft and does not label it oral evidence", async () => {
    const user = userEvent.setup();
    render(<ContentPackExperience pack={pack} />);
    const textarea = screen.getByRole("textbox", { name: "你的回复" });
    await user.type(textarea, "Hola");
    await user.click(screen.getByRole("button", { name: "完成这一步" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(`content-pack-progress:v1:${pack.id}`) ?? "{}");
      expect(stored.draftReply).toBe("Hola");
    });
    expect(screen.queryByText(/口语证据/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入口语复核" })).toHaveAttribute("href", "/learn/practice");
  });

  it("advances progress through a pure transition", () => {
    const start = createContentPackProgress(pack);
    const next = completeContentPackActivity(start, pack, pack.activities[0]!.id);
    expect(next.completedActivityIds).toEqual([pack.activities[0]!.id]);
    expect(next.currentActivityId).toBe(pack.activities[1]!.id);
  });
});
