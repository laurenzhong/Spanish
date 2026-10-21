"use client";

import { useEffect, useRef, useState } from "react";

import type { MediaSeriesEpisodes } from "../repositories/media-series-repository";
import { MediaSeriesReadError, requestMediaSeriesEpisodes } from "./media-series-client";

type ReadState = Readonly<{ status: "loading" | "ready" | "error"; data: MediaSeriesEpisodes | null; error: "unavailable" | "cursor-invalid" | "timeout" | "failed" | null }>;
export function useMediaSeriesEpisodes(seriesKey: string, anchorMediaKey?: string) {
  const [state, setState] = useState<ReadState>({ status: "loading", data: null, error: null });
  const [request, setRequest] = useState<{ cursors: string[]; attempt: number; anchored: boolean }>({ cursors: [], attempt: 0, anchored: Boolean(anchorMediaKey) });
  const generation = useRef(0);
  const anchor = useRef<MediaSeriesEpisodes["anchor"] | null>(null);
  const cursor = request.cursors.at(-1);
  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort("timeout"), 20_000);
    void requestMediaSeriesEpisodes(seriesKey, { cursor, anchorMediaKey: cursor || !request.anchored ? undefined : anchorMediaKey }, controller.signal).then((data) => {
      if (!active || generation.current !== current || controller.signal.aborted) return;
      if (!cursor && request.anchored) anchor.current = data.anchor;
      setState({ status: "ready", data: { ...data, anchor: anchor.current ?? data.anchor }, error: null });
    }).catch((error: unknown) => {
      if (!active || generation.current !== current) return;
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      setState((previous) => ({ status: "error", data: previous.data,
        error: controller.signal.reason === "timeout" ? "timeout" : error instanceof MediaSeriesReadError ? error.code : "failed" }));
    }).finally(() => window.clearTimeout(deadline));
    return () => { active = false; window.clearTimeout(deadline); controller.abort(); };
  }, [seriesKey, anchorMediaKey, cursor, request.attempt, request.anchored]);

  function navigate(cursors: string[], anchored = request.anchored) {
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    setRequest((previous) => ({ cursors, anchored, attempt: previous.attempt + 1 }));
  }
  return {
    ...state,
    pageNumber: request.cursors.length + 1,
    anchored: request.anchored,
    previousPage: () => navigate(request.cursors.slice(0, -1)),
    nextPage: () => { if (state.status === "ready" && state.data?.nextCursor) navigate([...request.cursors, state.data.nextCursor]); },
    retry: () => navigate(state.error === "cursor-invalid" ? [] : request.cursors, state.error === "cursor-invalid" ? Boolean(anchorMediaKey) : request.anchored),
    reset: () => navigate([], Boolean(anchorMediaKey)),
    fromBeginning: () => navigate([], false),
  };
}
