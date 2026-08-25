import type { LearningActivityEvent } from "../domain/learning-activity";

export type LearningActivityPayload = Omit<
  LearningActivityEvent,
  "occurredAt"
>;

export type LearningActivitySender = (
  event: LearningActivityPayload,
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
    this.emit("ended");
  }

  private emit(eventType: LearningActivityPayload["eventType"]): void {
    const event: LearningActivityPayload = {
      clientInstanceId: this.clientInstanceId,
      eventType,
      sequence: this.sequence++,
    };
    this.lastSentType = eventType;
    void this.send(event).catch(() => undefined);
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

  private handleVisibilityChange = (): void => {
    this.foreground = document.visibilityState !== "hidden";
    if (!this.foreground && this.lastSentType !== "inactive") {
      this.emit("inactive");
    }
  };

  private handleBlur = (): void => {
    this.foreground = false;
    if (this.lastSentType !== "inactive") this.emit("inactive");
  };

  private handleFocus = (): void => {
    this.foreground = document.visibilityState !== "hidden";
    this.markInteraction();
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
  return async (event) => {
    const response = await fetcher(`/api/v1/practice/sessions/${sessionId}/activity`, {
      body: JSON.stringify(event),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("learning-activity-request-failed");
  };
}

export const learningActivityRecorderConstants = {
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
} as const;
