import type { MediaSeriesRecommendations } from "../repositories/media-series-repository";

export type MediaSeriesRecommendationState =
  | Readonly<{ status: "idle"; generation: number }>
  | Readonly<{ status: "loading"; generation: number }>
  | Readonly<{ status: "empty"; generation: number }>
  | Readonly<{ status: "ready"; generation: number; result: MediaSeriesRecommendations }>
  | Readonly<{ status: "error"; generation: number; error: "timeout" | "failed" }>;
type Event =
  | Readonly<{ type: "start"; generation: number }>
  | Readonly<{ type: "reset"; generation: number }>
  | Readonly<{ type: "resolved"; generation: number; result: MediaSeriesRecommendations }>
  | Readonly<{ type: "failed"; generation: number; error: "timeout" | "failed" }>;

export const initialMediaSeriesRecommendationState: MediaSeriesRecommendationState = { status: "idle", generation: 0 };

export function mediaSeriesRecommendationReducer(state: MediaSeriesRecommendationState, event: Event): MediaSeriesRecommendationState {
  if (!Number.isSafeInteger(event.generation) || event.generation < 1) return state;
  if (event.type === "start" || event.type === "reset") {
    if (event.generation <= state.generation) return state;
    return { status: event.type === "start" ? "loading" : "idle", generation: event.generation };
  }
  if (state.status !== "loading" || event.generation !== state.generation) return state;
  if (event.type === "failed") return { status: "error", generation: event.generation, error: event.error };
  if (!event.result.series || event.result.items.length === 0) return { status: "empty", generation: event.generation };
  return { status: "ready", generation: event.generation, result: event.result };
}
