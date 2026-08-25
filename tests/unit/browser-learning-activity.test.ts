import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserLearningActivityRecorder,
  learningActivityRecorderConstants,
} from "@/src/modules/profile/activity";

afterEach(() => {
  vi.useRealTimers();
});

describe("createBrowserLearningActivityRecorder", () => {
  it("emits active heartbeats, pauses after idle, and ends on stop", () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const recorder = createBrowserLearningActivityRecorder(send);

    recorder.start();
    vi.advanceTimersByTime(
      learningActivityRecorderConstants.idleTimeoutMs +
        learningActivityRecorderConstants.heartbeatIntervalMs,
    );
    recorder.stop();

    expect(send.mock.calls.map(([event]) => event.eventType)).toEqual([
      "active",
      "active",
      "active",
      "active",
      "active",
      "inactive",
      "ended",
    ]);
    expect(send.mock.calls.map(([event]) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("resumes active heartbeats after focus and interaction", () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const recorder = createBrowserLearningActivityRecorder(send);

    recorder.start();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    recorder.stop();

    expect(send.mock.calls.map(([event]) => event.eventType)).toEqual([
      "active",
      "inactive",
      "active",
      "ended",
    ]);
  });
});
