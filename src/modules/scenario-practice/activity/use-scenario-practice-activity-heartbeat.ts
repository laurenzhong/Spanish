"use client";

import { useEffect, useRef } from "react";

import type { LearningActivityRecorder } from "@/src/modules/profile/activity";

import { createScenarioPracticeActivityHeartbeat } from "./scenario-practice-activity-heartbeat";

/**
 * Starts learning-activity collection for an open scenario-practice session and
 * tears it down on unmount or when the session id becomes `null` (practice
 * completed or not server-persisted). `stop()` cancels the heartbeat timer, the
 * lifecycle listeners and pending requests, then sends the single `ended`
 * event; a later `start()` on the same session continues the sequence, so
 * restarting after a rolled-back completion cannot re-use a sequence number.
 *
 * The recorder never breaks practice: a failed heartbeat is dropped.
 */
export function useScenarioPracticeActivityHeartbeat(
  sessionId: string | null,
): void {
  const recorderRef = useRef<LearningActivityRecorder | null>(null);
  const recorderSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    if (recorderSessionIdRef.current !== sessionId || !recorderRef.current) {
      recorderRef.current?.stop();
      recorderRef.current = createScenarioPracticeActivityHeartbeat(sessionId);
      recorderSessionIdRef.current = sessionId;
    }
    const recorder = recorderRef.current;
    recorder.start();
    return () => recorder.stop();
  }, [sessionId]);
}
