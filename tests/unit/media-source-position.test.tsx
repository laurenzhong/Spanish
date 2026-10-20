import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaDetailContent } from "@/app/(product)/learn/media/[stableKey]/media-detail-content";

const state = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: async () => ({ id: "owner" }) }));
vi.mock("@/src/modules/media/testing/video-learning-e2e-fixture", () => ({ getVideoLearningE2eFixture: () => ({
  media: { kind: "video", title: "Test", sourceName: "Source", durationMs: 6000 },
  asset: { kind: "official_embed", url: "https://example.test/embed" }, segments: [],
}) }));
vi.mock("@/src/modules/media/testing/podcast-learning-e2e-fixture", () => ({ getPodcastLearningE2eFixture: () => null, waitForPodcastLearningE2eFixture: async () => {} }));
vi.mock("@/src/modules/media/ui/media-learning-workbench", () => ({ MediaLearningWorkbench: (props: Record<string, unknown>) => {
  state.props = props;
  return <div data-testid="workbench" />;
} }));
afterEach(cleanup);

describe("media source positions", () => {
  it.each([
    [{ t: "4250", segment: "2" }, 4250, 2],
    [{ t: "0", segment: "0" }, 0, 0],
    [{ t: "-1", segment: "-2" }, undefined, undefined],
    [{ t: "4.5", segment: "2x" }, undefined, undefined],
    [{ t: ["100", "200"], segment: ["1", "2"] }, undefined, undefined],
    [{ t: "9007199254740992", segment: "9007199254740992" }, undefined, undefined],
  ])("forwards only valid integer source positions from %j", async (search, time, segment) => {
    render(await MediaDetailContent({ stableKey: "youtube.example", searchParams: Promise.resolve(search) }));
    expect(screen.getByTestId("workbench")).toBeInTheDocument();
    expect(state.props.initialPositionMs).toBe(time);
    expect(state.props.initialSegmentIndex).toBe(segment);
  });
});
