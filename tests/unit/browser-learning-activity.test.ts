import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserLearningActivityRecorder,
  learningActivityRecorderConstants,
  type LearningActivityPayload,
  type LearningActivitySendOptions,
} from "@/src/modules/profile/activity";

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

function eventTypes(send: { mock: { calls: unknown[][] } }): string[] {
  return send.mock.calls.map(
    (call) => (call[0] as LearningActivityPayload).eventType,
  );
}

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

  it("re-emits active as soon as the hidden page becomes visible again", () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const recorder = createBrowserLearningActivityRecorder(send);

    recorder.start();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    recorder.stop();

    // The Flutter adapter re-emits on `resumed` instead of waiting a heartbeat.
    expect(eventTypes(send)).toEqual(["active", "inactive", "active", "ended"]);
    expect(send.mock.calls.map(([event]) => event.sequence)).toEqual([0, 1, 2, 3]);
  });

  it("keeps one timer and one set of listeners when start is called twice", () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const recorder = createBrowserLearningActivityRecorder(send);

    recorder.start();
    recorder.start();
    vi.advanceTimersByTime(learningActivityRecorderConstants.heartbeatIntervalMs);
    recorder.stop();

    expect(eventTypes(send)).toEqual(["active", "active", "ended"]);
  });

  it("cancels pending heartbeats on stop, then sends ended last and nothing after", async () => {
    vi.useFakeTimers();
    const sent: Array<{ event: LearningActivityPayload; signal?: AbortSignal }> = [];
    const send = vi.fn(
      (event: LearningActivityPayload, options?: LearningActivitySendOptions) => {
        sent.push({ event, signal: options?.signal });
        return new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("learning-activity-aborted"));
          });
        });
      },
    );
    const recorder = createBrowserLearningActivityRecorder(send);

    recorder.start();
    vi.advanceTimersByTime(learningActivityRecorderConstants.heartbeatIntervalMs);
    recorder.stop();
    const callsAfterStop = send.mock.calls.length;

    // Teardown released the timer and every lifecycle listener.
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(learningActivityRecorderConstants.heartbeatIntervalMs * 4);
    await vi.advanceTimersByTimeAsync(0);

    expect(send.mock.calls.length).toBe(callsAfterStop);
    expect(eventTypes(send)).toEqual(["active", "active", "ended"]);
    expect(sent.at(-1)!.event.eventType).toBe("ended");
    // The terminal event keeps a live signal; everything before it is cancelled.
    expect(sent.at(-1)!.signal?.aborted).toBe(false);
    expect(sent.slice(0, -1).every(({ signal }) => signal?.aborted === true)).toBe(true);
  });

  it("drops a failed heartbeat without reusing its sequence or breaking the caller", async () => {
    vi.useFakeTimers();
    const delivered: number[] = [];
    const send = vi.fn(async (event: LearningActivityPayload) => {
      if (event.sequence === 1) throw new Error("learning-activity-offline");
      delivered.push(event.sequence);
    });
    const recorder = createBrowserLearningActivityRecorder(send);

    expect(() => recorder.start()).not.toThrow();
    vi.advanceTimersByTime(learningActivityRecorderConstants.heartbeatIntervalMs);
    expect(() => recorder.stop()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    const sequences = send.mock.calls.map(([event]) => event.sequence);
    expect(sequences).toEqual([0, 1, 2]);
    // Unique and monotonic: a transport retry of any event is idempotent server-side.
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(delivered).toEqual([0, 2]);
  });

  it("survives a sender that throws synchronously", () => {
    vi.useFakeTimers();
    const send = vi.fn(() => {
      throw new Error("learning-activity-unavailable");
    });
    const recorder = createBrowserLearningActivityRecorder(send);

    expect(() => recorder.start()).not.toThrow();
    expect(() => {
      vi.advanceTimersByTime(learningActivityRecorderConstants.heartbeatIntervalMs);
    }).not.toThrow();
    expect(() => recorder.stop()).not.toThrow();
    expect(send).toHaveBeenCalledTimes(3);
  });
});
