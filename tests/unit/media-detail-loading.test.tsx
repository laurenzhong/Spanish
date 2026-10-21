import { Suspense, type ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MediaDetailPage from "@/app/(product)/learn/media/[stableKey]/page";
import MediaDetailLoading from "@/app/(product)/learn/media/[stableKey]/loading";

const route = vi.hoisted(() => ({ stableKey: "podcast.episode42" }));
vi.mock("next/navigation", () => ({ useParams: () => route }));
afterEach(cleanup);

describe("media detail loading", () => {
  it("uses the compact stacked podcast skeleton without a duplicate current segment", () => {
    route.stableKey = "podcast.episode42";
    const { container } = render(<MediaDetailLoading />);
    expect(container.querySelector("article")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".media-learning-workbench")).toHaveClass("media-learning-workbench--podcast");
    expect(container.querySelector(".media-detail__player--audio-loading")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".media-current-segment")).toBeNull();
    expect(container.querySelector("button, input, audio")).toBeNull();
  });

  it.each(["video.episode42", "youtube.episode42", "media.custom"])("preserves the generic video skeleton for %s", (stableKey) => {
    route.stableKey = stableKey;
    const { container } = render(<MediaDetailLoading />);
    expect(container.querySelector(".media-learning-workbench")).not.toHaveClass("media-learning-workbench--podcast");
    expect(container.querySelector(".media-detail__player--loading")).toBeInTheDocument();
    expect(container.querySelector(".media-current-segment")).toBeInTheDocument();
  });

  it("wraps the data half in a Suspense boundary whose fallback is the same detail skeleton", async () => {
    const element = await MediaDetailPage({ params: Promise.resolve({ stableKey: "podcast.episode42" }) }) as ReactElement<{ fallback: ReactElement }>;
    expect(element.type).toBe(Suspense);
    // The route-level loading.tsx and the in-page fallback render the same
    // component, so a direct visit streams the detail skeleton immediately.
    expect(element.props.fallback.type).toBe(MediaDetailLoading);
  });
});
