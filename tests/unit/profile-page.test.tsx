import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/modules/profile/ui/profile-overview-panel", () => ({
  ProfileOverviewPanel: () => <div data-testid="profile-overview" />,
}));
vi.mock("@/src/modules/profile/ui/learning-heatmap", () => ({
  LearningHeatmap: () => <div data-testid="learning-heatmap" />,
}));
vi.mock("@/src/modules/character-network/ui/shared-memory-permissions", () => ({
  SharedMemoryPermissions: () => <div data-testid="shared-memory-permissions" />,
}));
vi.mock("@/src/modules/profile/ui/memory-data-controls", () => ({
  MemoryDataControls: () => <div data-testid="memory-data-controls" />,
}));
vi.mock("@/src/modules/profile/ui/voice-data-controls", () => ({
  VoiceDataControls: () => <div data-testid="voice-data-controls" />,
}));
vi.mock("@/src/modules/profile/ui/account-data-controls", () => ({
  AccountDataControls: () => <div data-testid="account-data-controls" />,
}));

import ProfilePage from "@/app/(product)/me/page";

describe("ProfilePage information architecture", () => {
  it("exposes stable anchors for progress, relationship privacy, and account data", () => {
    render(<ProfilePage />);

    expect(screen.getByRole("navigation", { name: "我的页面分区" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "能力与活动" })).toHaveAttribute("href", "#profile-progress");
    expect(screen.getByRole("link", { name: "关系隐私" })).toHaveAttribute("href", "#profile-relationships");
    expect(screen.getByRole("link", { name: "数据与隐私" })).toHaveAttribute("href", "#profile-data");
    expect(screen.getByRole("heading", { name: "能力与活动" })).toHaveAttribute("id", "profile-progress-title");
    expect(screen.getByTestId("profile-overview")).toBeInTheDocument();
    expect(screen.getByTestId("learning-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("account-data-controls")).toBeInTheDocument();
  });
});
