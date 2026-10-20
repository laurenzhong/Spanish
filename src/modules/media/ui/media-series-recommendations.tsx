"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useState } from "react";

import type { MediaCard } from "../domain/media";
import { MediaCardView } from "./media-card";
import { initialMediaSeriesRecommendationState, mediaSeriesRecommendationReducer } from "./media-series-recommendation-state";
import { requestMediaSeriesRecommendations } from "./request-media-series-recommendations";
import "./media-series-recommendations.css";

export function MediaSeriesRecommendations({ media, completed }: Readonly<{ media: MediaCard; completed: boolean }>) {
  if (!completed || media.kind !== "video" || !media.series) return null;
  return <CompletedVideoRecommendations key={`${media.id}:${media.series.seriesKey}`} stableKey={media.stableKey} />;
}

function CompletedVideoRecommendations({ stableKey }: Readonly<{ stableKey: string }>) {
  const [attempt, setAttempt] = useState(1);
  const [state, dispatch] = useReducer(mediaSeriesRecommendationReducer, initialMediaSeriesRecommendationState,
    (initial) => mediaSeriesRecommendationReducer(initial, { type: "start", generation: 1 }));
  const id = useId();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort("timeout"), 20_000);
    // A synchronous unmount (including React's development lifecycle check)
    // cancels before a network request is created.
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      return requestMediaSeriesRecommendations(stableKey, controller.signal);
    }).then((result) => {
      if (active && !controller.signal.aborted) dispatch({ type: "resolved", generation: attempt, result });
    }).catch(() => {
      if (!active || (controller.signal.aborted && controller.signal.reason !== "timeout")) return;
      dispatch({ type: "failed", generation: attempt, error: controller.signal.reason === "timeout" ? "timeout" : "failed" });
    }).finally(() => window.clearTimeout(deadline));
    return () => { active = false; window.clearTimeout(deadline); controller.abort(); };
  }, [stableKey, attempt]);

  if (state.status === "idle" || state.status === "empty") return null;
  if (state.status === "loading") return <div className="media-series-recommendations__notice" role="status">正在读取同系列视频…</div>;
  if (state.status === "error") return <div className="media-series-recommendations__notice" data-media-series-recommendations role="alert">
    <p>{state.error === "timeout" ? "读取超时，请重试。" : "暂时无法读取同系列视频，请重试。"}</p>
    <button type="button" onClick={() => {
      const generation = attempt + 1;
      dispatch({ type: "start", generation });
      setAttempt(generation);
    }}>重试</button>
  </div>;
  return <section className="media-series-recommendations" data-media-series-recommendations aria-labelledby={id}>
    <header className="media-series-recommendations__heading">
      <h2 id={id}>当前系列的其他视频</h2>
      <Link href={`/learn/series/${encodeURIComponent(state.result.series!.seriesKey)}`}>查看全部</Link>
    </header>
    <div className="media-series-recommendations__grid">
      {state.result.items.map((item) => <MediaCardView key={item.id} item={item} />)}
    </div>
  </section>;
}
