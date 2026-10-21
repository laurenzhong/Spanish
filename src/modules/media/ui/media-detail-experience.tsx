"use client";

import { useMemo } from "react";

import type { MediaPlayback, MediaPlaybackOverview } from "../domain";
import type { AudioPlayerFactory } from "./audio-player-adapter";
import { MediaLearningWorkbench } from "./media-learning-workbench";
import { useMediaPlaybackSegments } from "./use-media-playback-segments";
import type { NativeVideoPlayerFactory, VideoPlayerFactory } from "./video-player-adapter";

/**
 * Client half of the media detail page.
 *
 * The server already resolved the card, the player asset and how many reviewed
 * cues exist, so the title, player and resume position render immediately. The
 * complete transcript is then loaded in the background (text first, word
 * timings second) and handed to the same, already mounted workbench. Nothing
 * here can unmount or re-create the player.
 */
export function MediaDetailExperience({ overview, initialPositionMs, initialSegmentIndex, playerFactory, nativeVideoFactory, audioPlayerFactory }: Readonly<{
  overview: MediaPlaybackOverview;
  initialPositionMs?: number;
  initialSegmentIndex?: number;
  /** Test seams; production leaves these undefined. */
  playerFactory?: VideoPlayerFactory;
  nativeVideoFactory?: NativeVideoPlayerFactory;
  audioPlayerFactory?: AudioPlayerFactory;
}>) {
  const transcript = useMediaPlaybackSegments({
    stableKey: overview.media.stableKey,
    expectedVersion: overview.media.version,
    enabled: overview.segmentCount > 0,
  });
  const playback = useMemo<MediaPlayback>(() => ({
    media: overview.media,
    asset: overview.asset,
    segments: transcript.state.status === "ready" || transcript.state.status === "text_ready"
      ? transcript.state.segments
      : [],
  }), [overview.asset, overview.media, transcript.state]);
  return <MediaLearningWorkbench
    audioPlayerFactory={audioPlayerFactory}
    initialPositionMs={initialPositionMs}
    initialSegmentIndex={initialSegmentIndex}
    nativeVideoFactory={nativeVideoFactory}
    onTranscriptRetry={transcript.retry}
    playback={playback}
    playerFactory={playerFactory}
    transcriptExpectedSegments={overview.segmentCount}
    transcriptState={transcript.state}
  />;
}
