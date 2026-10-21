import type { LearningActivityEvent } from "../domain/learning-activity";

export type LearningActivityPayload = Omit<
  LearningActivityEvent,
  "occurredAt"
>;

export type LearningActivitySendOptions = Readonly<{
  /**
   * Aborted when the recorder is torn down, so a pending heartbeat cannot
   * outlive the practice page. A sender may ignore it and still be correct.
   */
  signal?: AbortSignal;
}>;

export type LearningActivitySender = (
  event: LearningActivityPayload,
  options?: LearningActivitySendOptions,
) => Promise<void>;

export type LearningActivityRecorder = Readonly<{
  markInteraction(): void;
  start(): void;
  stop(): void;
}>;

const HEARTBEAT_INTERVAL_MS = 15_000;
const IDLE_TIMEOUT_MS = 60_000;

function createClientInstanceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

class BrowserLearningActivityRecorder implements LearningActivityRecorder {
  private readonly clientInstanceId = createClientInstanceId();
  private sequence = 0;
  private timer: number | null = null;
  private started = false;
  private foreground = true;
  private lastInteractionAt = 0;
  private lastSentType: LearningActivityPayload["eventType"] | null = null;
  private readonly inFlight = new Set<AbortController>();

  constructor(private readonly send: LearningActivitySender) {}

  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.foreground = document.visibilityState !== "hidden";
    this.lastInteractionAt = Date.now();
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("blur", this.handleBlur);
    window.addEventListener("focus", this.handleFocus);
    window.addEventListener("pointerdown", this.markInteraction);
    window.addEventListener("keydown", this.markInteraction);
    this.emit("active");
    this.timer = window.setInterval(this.tick, HEARTBEAT_INTERVAL_MS);
  }

  markInteraction = (): void => {
    if (!this.started) return;
    this.lastInteractionAt = Date.now();
    if (this.foreground && this.lastSentType === "inactive") {
      this.emit("active");
    }
  };

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("blur", this.handleBlur);
    window.removeEventListener("focus", this.handleFocus);
    window.removeEventListener("pointerdown", this.markInteraction);
    window.removeEventListener("keydown", this.markInteraction);
    // Pending heartbeats are cancelled first so the terminal event is the only
    // request still in flight; `emit` gives `ended` a fresh, un-aborted signal.
    this.abortInFlight();
    this.emit("ended");
  }

  private abortInFlight(): void {
    for (const controller of [...this.inFlight]) controller.abort();
    this.inFlight.clear();
  }

  private emit(eventType: LearningActivityPayload["eventType"]): void {
    const event: LearningActivityPayload = {
      clientInstanceId: this.clientInstanceId,
      eventType,
      sequence: this.sequence++,
    };
    this.lastSentType = eventType;
    const controller = new AbortController();
    this.inFlight.add(controller);
    const settle = () => {
      this.inFlight.delete(controller);
    };
    try {
      // A failed or rejected heartbeat is dropped, never re-queued: the sequence
      // is consumed, so a transport retry of the same event is idempotent and a
      // new attempt can never re-use it. Collection must not break training.
      void this.send(event, { signal: controller.signal }).then(settle, settle);
    } catch {
      settle();
    }
  }

  private tick = (): void => {
    if (!this.started) return;
    const recentlyActive = Date.now() - this.lastInteractionAt <= IDLE_TIMEOUT_MS;
    if (this.foreground && recentlyActive) {
      this.emit("active");
    } else if (this.lastSentType !== "inactive") {
      this.emit("inactive");
    }
  };

  /**
   * Mirrors the Flutter adapter's `didChangeAppLifecycleState`: leaving the
   * foreground emits `inactive`, returning to it counts as interaction and
   * re-emits `active` immediately instead of waiting for the next heartbeat.
   */
  private setForeground(foreground: boolean): void {
    this.foreground = foreground;
    if (!foreground) {
      if (this.lastSentType !== "inactive") this.emit("inactive");
      return;
    }
    this.markInteraction();
  }

  private handleVisibilityChange = (): void => {
    this.setForeground(document.visibilityState !== "hidden");
  };

  private handleBlur = (): void => {
    this.setForeground(false);
  };

  private handleFocus = (): void => {
    this.setForeground(document.visibilityState !== "hidden");
  };
}

export function createBrowserLearningActivityRecorder(
  send: LearningActivitySender,
): LearningActivityRecorder {
  return new BrowserLearningActivityRecorder(send);
}

export function createFetchLearningActivitySender(
  sessionId: string,
  fetcher: typeof fetch = fetch,
): LearningActivitySender {
  return async (event, options) => {
    const response = await fetcher(`/api/v1/practice/sessions/${sessionId}/activity`, {
      body: JSON.stringify(event),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: options?.signal,
    });
    if (!response.ok) throw new Error("learning-activity-request-failed");
  };
}

export const learningActivityRecorderConstants = {
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
} as const;
