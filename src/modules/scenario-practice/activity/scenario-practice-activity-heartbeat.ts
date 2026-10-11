import {
  createBrowserLearningActivityRecorder,
  createFetchLearningActivitySender,
  type LearningActivityRecorder,
} from "@/src/modules/profile/activity";

/**
 * Scenario practice is the only Web flow that owns a server `practice_sessions`
 * row, so it is the only Web flow that can record learning activity. The
 * protocol, cadence and foreground semantics are not re-implemented here: the
 * recorder and the fetch sender are the same ones the paused Flutter client
 * mirrors (`apps/mobile/lib/features/training/activity/learning_activity_recorder.dart`)
 * and `POST /api/v1/practice/sessions/:sessionId/activity` is the only endpoint.
 */
export type ScenarioPracticeSessionSnapshot = Readonly<{
  completed?: boolean;
  persistence?: "account" | "device";
  sessionId: string;
}>;

export type ScenarioPracticeHeartbeatOptions = Readonly<{
  fetcher?: typeof fetch;
}>;

/**
 * The one rule the practice UI applies: heartbeat only while a restored
 * checkpoint names a server-persisted session that has not been completed.
 * Device-only practice has no server row (the endpoint answers 404), a
 * completed practice already received its terminal `ended`, and the checkpoint
 * must be hydrated first so a stale render cannot start collection.
 */
export function scenarioPracticeHeartbeatSessionId(
  session: ScenarioPracticeSessionSnapshot,
  options: Readonly<{ hydrated: boolean }>,
): string | null {
  if (!options.hydrated) return null;
  if (session.completed === true) return null;
  if (session.persistence !== "account") return null;
  return session.sessionId.length > 0 ? session.sessionId : null;
}

export function createScenarioPracticeActivityHeartbeat(
  sessionId: string,
  options: ScenarioPracticeHeartbeatOptions = {},
): LearningActivityRecorder {
  return createBrowserLearningActivityRecorder(
    createFetchLearningActivitySender(sessionId, options.fetcher),
  );
}
