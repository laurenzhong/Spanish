import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CandidateReviewWorkbench, ContentWorkflowDashboard } from "@/src/modules/content-acquisition";

afterEach(() => cleanup());

describe("owner content workflow UI", () => {
  it("opens directly on candidates and keeps sources and runs secondary", () => {
    render(<ContentWorkflowDashboard sources={[]} runs={[]} candidates={[{
      id: "00000000-0000-4000-8000-000000000731", sourceId: "source", externalItemId: "item", normalizedUrl: "https://example.test/article", title: "La vida diaria", contentType: "article", language: "es", metadata: {}, publishedAt: null, contentHash: "a".repeat(64), status: "review_ready", rightsStatus: "verified", generationId: "g1", revision: 3, lastActivityAt: new Date(), rejectedAt: null, publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null,
    }]} />);
    expect(screen.getByRole("heading", { name: "等待你的判断" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /La vida diaria/u })).toHaveAttribute("href", "/me/content-workflow/00000000-0000-4000-8000-000000000731");
    expect(screen.getByRole("heading", { name: "来源" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近运行" })).toBeInTheDocument();
  });

  it("shows independent gates and disables publishing when the real publisher is absent", () => {
    render(<CandidateReviewWorkbench initialData={{
      candidate: { id: "00000000-0000-4000-8000-000000000732", title: "Un vídeo", normalizedUrl: "https://example.test/video", contentType: "video", language: "es", contentHash: "b".repeat(64), metadata: {}, status: "review_ready", rightsStatus: "verified", revision: 4, publicationStatus: "draft" },
      source: { displayName: "Fixture", rightsStatus: "verified" }, reviews: [], artifacts: [], attempts: [], publisherAvailable: false,
    }} />);
    expect(screen.getByText("西语内容审核")).toBeInTheDocument();
    expect(screen.getByText("中文教学审核")).toBeInTheDocument();
    expect(screen.getByText("结构校验")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显式发布" })).toBeDisabled();
    expect(screen.getByText(/尚无正式 publisher/u)).toBeInTheDocument();
  });
});
