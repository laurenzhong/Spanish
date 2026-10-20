import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaCard } from "@/src/modules/media/domain/media";
import { MediaCardView } from "@/src/modules/media/ui/media-card";

const card: MediaCard = { id: "video.card-test@1", stableKey: "video.card-test", version: 1, kind: "video", title: "Un día", summary: "", sourceName: "Fuente original", language: "es", region: null, cefr: "A2", topics: [], durationMs: 10000, publishedAt: null, curatedAt: "2026-10-16T00:00:00Z", contentHash: "a".repeat(64), progress: null };
afterEach(cleanup);

describe("media card series entry", () => {
  it("retains the direct episode link and renders an independent series link and original source", () => {
    const { container } = render(<MediaCardView item={{ ...card, series: { seriesKey: "series.real", title: "Serie real", kind: "video", orderMode: "ordered", revision: 1, seasonNumber: 0, episodeNumber: 0, episodeLabel: null } }} />);
    expect(screen.getByRole("link", { name: /Un día/ })).toHaveAttribute("href", "/learn/media/video.card-test");
    expect(screen.getByRole("link", { name: /Serie real.*查看系列/ })).toHaveAttribute("href", "/learn/series/series.real");
    expect(container.querySelector(".media-card__source")).toHaveTextContent("Fuente original");
    expect(screen.getByText("第 0 季 · 第 0 集")).toBeVisible();
    expect(container.querySelector("a a")).toBeNull();
  });
  it("keeps cards without a series compatible without invented labels", () => {
    render(<MediaCardView item={card} />);
    expect(screen.queryByText(/查看系列/)).not.toBeInTheDocument();
    expect(screen.queryByText(/第.*集/)).not.toBeInTheDocument();
  });
});
