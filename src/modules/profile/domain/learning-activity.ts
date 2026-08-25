import { z } from "zod";

export const learningActivityEventSchema = z.object({
  clientInstanceId: z.string().min(1).max(128),
  eventType: z.enum(["active", "inactive", "ended"]),
  occurredAt: z.date(),
  sequence: z.number().int().nonnegative(),
});

export type LearningActivityEvent = Readonly<
  z.infer<typeof learningActivityEventSchema>
>;

const MAX_EVENT_GAP_SECONDS = 45;
const MAX_SESSION_SECONDS = 45 * 60;

function eventKey(event: LearningActivityEvent): string {
  return `${event.clientInstanceId}:${event.sequence}`;
}

/**
 * Counts only intervals bounded by consecutive active heartbeats.
 * Lifecycle pauses, long network gaps, and incomplete tails are intentionally
 * excluded so an idle/background page cannot inflate learning time.
 */
export function activeSecondsForEvents(
  events: readonly LearningActivityEvent[],
): number {
  const unique = new Map<string, LearningActivityEvent>();
  for (const event of events) {
    const parsed = learningActivityEventSchema.parse(event);
    if (!unique.has(eventKey(parsed))) unique.set(eventKey(parsed), parsed);
  }

  const byClient = new Map<string, LearningActivityEvent[]>();
  for (const event of unique.values()) {
    const clientEvents = byClient.get(event.clientInstanceId) ?? [];
    clientEvents.push(event);
    byClient.set(event.clientInstanceId, clientEvents);
  }

  let totalSeconds = 0;
  for (const clientEvents of byClient.values()) {
    const ordered = [...clientEvents].sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.sequence - right.sequence,
    );
    let previousActive: LearningActivityEvent | null = null;
    for (const event of ordered) {
      if (event.eventType !== "active") {
        previousActive = null;
        continue;
      }
      if (previousActive) {
        const gapSeconds =
          (event.occurredAt.getTime() - previousActive.occurredAt.getTime()) /
          1000;
        if (gapSeconds > 0 && gapSeconds <= MAX_EVENT_GAP_SECONDS) {
          totalSeconds += gapSeconds;
        }
      }
      previousActive = event;
    }
  }

  return Math.min(MAX_SESSION_SECONDS, Math.floor(totalSeconds));
}

export const learningActivityConstants = {
  maxEventGapSeconds: MAX_EVENT_GAP_SECONDS,
  maxSessionSeconds: MAX_SESSION_SECONDS,
} as const;
