"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type { MediaPlayback } from "../domain";

type PlaybackSegments = MediaPlayback["segments"];

/**
 * Transcript loading has two honest phases:
 *
 * - `loading` — the text has not arrived yet; the player already works.
 * - `text_ready` — the sentence text is rendered, word-level timings are still
 *   loading or could not be loaded (retry with `retry()`); the text stays.
 * - `ready` — word highlighting is available.
 * - `error` — the text itself failed; the player still works.
 *
 * A word-timing failure must never replace the transcript that already loaded.
 */
export type MediaTranscriptLoadState = Readonly<
  | { status: "loading" }
  | { status: "text_ready"; segments: PlaybackSegments; words: "loading" | "unavailable"; wordsMessage?: string }
  | { status: "ready"; segments: PlaybackSegments }
  | { status: "error"; message: string }
>;

export type PlaybackSegmentsHookResult = Readonly<{
  state: MediaTranscriptLoadState;
  /** Retry the failed phase only: text first, then word highlighting. */
  retry: () => void;
}>;

/**
 * Under the current slow database network a cold full `/playback` read measured
 * 24–33 s (and 6–10 s even once it warmed up). The timeout only exists to turn
 * a hung request into a retryable error; it must stay well above that. The
 * text-only phase is expected to answer in roughly 1–2 s.
 */
export const DEFAULT_PLAYBACK_SEGMENTS_TIMEOUT_MS = 45_000;

const wordTimingSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
}).passthrough();

const segmentSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  sourceText: z.string(),
  translation: z.string().nullable().optional(),
  speaker: z.string().nullable().optional(),
  words: z.array(wordTimingSchema).nullable().optional(),
}).passthrough();

/**
 * The endpoint returns the playback DTO in its usual envelope. This client
 * already holds the validated card/asset from the server overview, so it only
 * consumes the media identity (version guard) and the transcript rows; the
 * shape is still validated strictly rather than trusted.
 */
const playbackResponseSchema = z.object({
  apiVersion: z.string(),
  data: z.object({
    media: z.object({
      stableKey: z.string().min(1),
      version: z.number().int().positive(),
    }).passthrough(),
    segments: z.array(segmentSchema),
  }).passthrough(),
}).passthrough();

type Phase = "text" | "words";

type PlaybackSegmentsRequest = Readonly<{
  stableKey: string;
  expectedVersion: number;
  timeoutMs: number;
  phase: Phase;
  /** Test seam; production leaves this undefined to use the ambient fetch. */
  fetchImpl?: typeof fetch;
}>;

type LoadOutcome =
  | Readonly<{ ok: true; segments: PlaybackSegments }>
  | Readonly<{ ok: false; kind: "aborted" | "timeout" | "http" | "invalid" | "version_mismatch" | "network"; message: string }>;

type InFlightRequest = {
  controller: AbortController;
  promise: Promise<LoadOutcome>;
  subscribers: number;
  abortTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Same-media requests are shared for their whole lifetime. This is what makes
 * a React StrictMode double-mount (setup → cleanup → setup) issue exactly one
 * request per phase: the second subscriber cancels the deferred abort the first
 * cleanup scheduled.
 */
const inFlightRequests = new Map<string, InFlightRequest>();

function requestKey(request: Readonly<{ stableKey: string; expectedVersion: number; phase: Phase }>): string {
  return `${request.stableKey}@${request.expectedVersion}:${request.phase}`;
}

function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  if (fetchImpl) return fetchImpl;
  return (input, init) => globalThis.fetch(input, init);
}

function phaseFailureMessage(phase: Phase, kind: "http" | "invalid" | "network"): string {
  if (phase === "words") return "逐词高亮暂时不可用，可重试。";
  return kind === "invalid" ? "字幕数据不完整，可重试。" : "字幕暂时无法加载，可重试。";
}

async function loadPlaybackSegments(request: PlaybackSegmentsRequest, controller: AbortController): Promise<LoadOutcome> {
  const fetchImpl = resolveFetch(request.fetchImpl);
  const timeoutMessage = request.phase === "words" ? "逐词高亮加载超时，可重试。" : "字幕加载超时，可重试。";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);
  const query = request.phase === "text" ? "?include=text" : "";
  try {
    const response = await fetchImpl(`/api/v1/media/${encodeURIComponent(request.stableKey)}/playback${query}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, kind: "http", message: phaseFailureMessage(request.phase, "http") };
    }
    const parsed = playbackResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { ok: false, kind: "invalid", message: phaseFailureMessage(request.phase, "invalid") };
    }
    const { media, segments } = parsed.data.data;
    if (media.stableKey !== request.stableKey || media.version !== request.expectedVersion) {
      // Never mix two versions: the overview and the transcript have to describe
      // the same published version or the word timings could point at nothing.
      return { ok: false, kind: "version_mismatch", message: "媒体内容已更新，请刷新页面后重试。" };
    }
    return { ok: true, segments: segments as unknown as PlaybackSegments };
  } catch (error) {
    if (timedOut) return { ok: false, kind: "timeout", message: timeoutMessage };
    if (controller.signal.aborted) return { ok: false, kind: "aborted", message: "" };
    void error;
    return { ok: false, kind: "network", message: phaseFailureMessage(request.phase, "network") };
  } finally {
    clearTimeout(timeout);
  }
}

function acquireRequest(request: PlaybackSegmentsRequest): Readonly<{ entry: InFlightRequest; key: string }> {
  const key = requestKey(request);
  const existing = inFlightRequests.get(key);
  if (existing) {
    existing.subscribers += 1;
    if (existing.abortTimer !== null) {
      clearTimeout(existing.abortTimer);
      existing.abortTimer = null;
    }
    return { entry: existing, key };
  }
  const controller = new AbortController();
  const entry: InFlightRequest = {
    controller,
    promise: loadPlaybackSegments(request, controller),
    subscribers: 1,
    abortTimer: null,
  };
  inFlightRequests.set(key, entry);
  void entry.promise.finally(() => {
    if (inFlightRequests.get(key) === entry) inFlightRequests.delete(key);
  });
  return { entry, key };
}

function releaseRequest(key: string): void {
  const entry = inFlightRequests.get(key);
  if (!entry) return;
  entry.subscribers = Math.max(0, entry.subscribers - 1);
  if (entry.subscribers > 0 || entry.abortTimer !== null) return;
  // A real unmount aborts the request on the next turn. Deferring lets a
  // StrictMode remount re-subscribe first, so development never pays for two
  // transcript reads (and never cancels the one it keeps).
  entry.abortTimer = setTimeout(() => {
    const current = inFlightRequests.get(key);
    if (!current || current.subscribers > 0) return;
    inFlightRequests.delete(key);
    current.controller.abort();
  }, 0);
}

/** Test seam: drop any shared in-flight request between test cases. */
export function resetPlaybackSegmentsRequestsForTests(): void {
  for (const [key, entry] of inFlightRequests) {
    if (entry.abortTimer !== null) clearTimeout(entry.abortTimer);
    entry.controller.abort();
    inFlightRequests.delete(key);
  }
}

type TextState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; segments: PlaybackSegments };

type WordsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready" };

/**
 * Load the reviewed transcript for one media version after mount, in two
 * phases.
 *
 * Phase 1 requests `?include=text` so subtitles can render without the word
 * timing JSON. Phase 2 requests the default full playback and merges only the
 * `words` of already-rendered cues, enabling the per-word highlight without
 * resetting the transcript rows. The player is independent of both phases.
 */
export function useMediaPlaybackSegments(input: Readonly<{
  stableKey: string;
  expectedVersion: number;
  /** When false (no reviewed cues) both phases are skipped and the empty state is final. */
  enabled?: boolean;
  timeoutMs?: number;
  /** Test seam; production leaves this undefined to use the ambient fetch. */
  fetchImpl?: typeof fetch;
}>): PlaybackSegmentsHookResult {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PLAYBACK_SEGMENTS_TIMEOUT_MS;
  const enabled = input.enabled ?? true;
  const [textAttempt, setTextAttempt] = useState(0);
  const [wordsAttempt, setWordsAttempt] = useState(0);
  // Initial states are derived from `enabled`, so the "no reviewed cues" case
  // never needs a synchronous setState from an effect.
  const [text, setText] = useState<TextState>(() => enabled ? { status: "loading" } : { status: "ready", segments: [] });
  const [words, setWords] = useState<WordsState>(() => enabled ? { status: "idle" } : { status: "ready" });
  const [mergedSegments, setMergedSegments] = useState<PlaybackSegments | null>(() => enabled ? null : []);
  /** Monotonic per-phase guard: a response from an older effect must not win. */
  const textGenerationRef = useRef(0);
  const wordsGenerationRef = useRef(0);

  // Phase 1: sentence text only. Retries reset the state in the click handler
  // (see `retry`), not inside this effect.
  useEffect(() => {
    if (!enabled) return;
    const generation = textGenerationRef.current + 1;
    textGenerationRef.current = generation;
    let cancelled = false;
    const { entry, key } = acquireRequest({
      stableKey: input.stableKey,
      expectedVersion: input.expectedVersion,
      timeoutMs,
      phase: "text",
      fetchImpl: input.fetchImpl,
    });
    void entry.promise.then((outcome) => {
      if (cancelled || textGenerationRef.current !== generation) return;
      if (outcome.ok) {
        setText({ status: "ready", segments: outcome.segments });
        return;
      }
      if (outcome.kind === "aborted") return;
      setText({ status: "error", message: outcome.message });
    });
    return () => {
      cancelled = true;
      if (textGenerationRef.current === generation) textGenerationRef.current += 1;
      releaseRequest(key);
    };
  }, [enabled, input.expectedVersion, input.fetchImpl, input.stableKey, textAttempt, timeoutMs]);

  // Phase 2: word-level timings for the cues phase 1 already rendered. The
  // loading/unavailable transition for retries is set by `retry`; the first run
  // simply derives `text_ready + words: "loading"` from the states above.
  useEffect(() => {
    if (!enabled || text.status !== "ready" || text.segments.length === 0) return;
    const textSegments = text.segments;
    let cancelled = false;
    const generation = wordsGenerationRef.current + 1;
    wordsGenerationRef.current = generation;
    const { entry, key } = acquireRequest({
      stableKey: input.stableKey,
      expectedVersion: input.expectedVersion,
      timeoutMs,
      phase: "words",
      fetchImpl: input.fetchImpl,
    });
    void entry.promise.then((outcome) => {
      if (cancelled || wordsGenerationRef.current !== generation) return;
      if (outcome.ok) {
        const wordsByIndex = new Map<number, PlaybackSegments[number]["words"]>();
        for (const segment of outcome.segments) wordsByIndex.set(segment.index, segment.words ?? null);
        setMergedSegments(textSegments.map((segment) => ({
          ...segment,
          words: wordsByIndex.get(segment.index) ?? null,
        })));
        setWords({ status: "ready" });
        return;
      }
      if (outcome.kind === "aborted") return;
      // Text already rendered: surface the word-highlight failure without
      // removing the subtitles.
      setWords({ status: "unavailable", message: outcome.message });
    });
    return () => {
      cancelled = true;
      if (wordsGenerationRef.current === generation) wordsGenerationRef.current += 1;
      releaseRequest(key);
    };
  }, [enabled, input.expectedVersion, input.fetchImpl, input.stableKey, text, timeoutMs, wordsAttempt]);

  const retry = useCallback(() => {
    if (text.status === "error") {
      setText({ status: "loading" });
      setWords({ status: "idle" });
      setMergedSegments(null);
      setTextAttempt((value) => value + 1);
      return;
    }
    if (text.status === "ready" && words.status === "unavailable") {
      setWords({ status: "loading" });
      setWordsAttempt((value) => value + 1);
    }
  }, [text.status, words.status]);

  const state = useMemo<MediaTranscriptLoadState>(() => {
    if (text.status === "loading") return { status: "loading" };
    if (text.status === "error") return { status: "error", message: text.message };
    // The player can play media without a reviewed transcript: an empty text
    // phase is final and does not wait for word timings.
    if (text.segments.length === 0) return { status: "ready", segments: [] };
    if (words.status === "ready" && mergedSegments) return { status: "ready", segments: mergedSegments };
    if (words.status === "unavailable") {
      return { status: "text_ready", segments: text.segments, words: "unavailable", wordsMessage: words.message };
    }
    return { status: "text_ready", segments: text.segments, words: "loading" };
  }, [mergedSegments, text, words]);

  return { state, retry };
}
