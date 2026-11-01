import type { LearningObservationEvent } from "./learning-observation";

export const LEARNING_REPORT_ALGORITHM_VERSION = "learning-report-v3";
export const LEARNING_REPORT_VERSION = 3;
export const LEARNING_REPORT_WINDOW_DAYS = 14;

export type LearningReportStatus = "generated" | "insufficient_data" | "failed";
export type LearningReportFeedback = "mastered" | "not_relevant" | "review_again";

export type LearningReviewAction = Readonly<{
  kind: "choice" | "judgment" | "cloze" | "recall";
  promptKey: string;
  subjectRef: Readonly<{
    type: "lexeme" | "phrase" | "content_segment" | "skill";
    id: string;
    version: number | null;
  }>;
}>;

export type LearningInsightCandidate = Readonly<{
  candidateKey: string;
  subjectType: "lexeme" | "phrase" | "content_segment" | "skill";
  subjectId: string;
  subjectVersion: number | null;
  score: number;
  strongestSignal: "weak" | "moderate" | "strong";
  signalCount: number;
  distinctSources: number;
  distinctContexts: number;
  sourceEventIds: readonly string[];
  reviewAction: LearningReviewAction;
}>;

export type LearningReportSnapshot = Readonly<{
  localDate: string;
  timezone: string;
  status: LearningReportStatus;
  reportVersion: number;
  algorithmVersion: string;
  summary: string;
  coverage: Readonly<{
    observationCount: number;
    eligibleObservationCount: number;
    excludedObservationCount: number;
    eventTypeCounts: Readonly<Record<string, number>>;
    sourceModuleCounts: Readonly<Record<string, number>>;
    latestObservedAt: string | null;
  }>;
  candidates: readonly LearningInsightCandidate[];
  sourceEventIds: readonly string[];
}>;

export type LearningReportFeedbackState = Readonly<{
  candidateKey: string;
  feedback: LearningReportFeedback;
}>;

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 86_400_000);
}

function contextKey(event: LearningObservationEvent): string {
  const metadata = event.metadata;
  const ref = metadata.contentRef ?? metadata.resolvedRef ?? metadata.subjectRef;
  if (ref) return `${event.sourceModule}:${ref.type}:${ref.id}:${ref.version ?? ""}`;
  return `${event.sourceModule}:${metadata.sourceLabel ?? "unknown"}`;
}

function scoreSignal(event: LearningObservationEvent, now: Date): number {
  const base = event.signalStrength === "strong" ? 5 : event.signalStrength === "moderate" ? 3 : 1;
  const ageWeight = Math.max(0.25, 1 - daysBetween(now, event.occurredAt) / LEARNING_REPORT_WINDOW_DAYS);
  return base * ageWeight;
}

function strongestSignal(events: readonly LearningObservationEvent[]): "weak" | "moderate" | "strong" {
  if (events.some((event) => event.signalStrength === "strong")) return "strong";
  if (events.some((event) => event.signalStrength === "moderate")) return "moderate";
  return "weak";
}

function actionFor(subjectType: LearningInsightCandidate["subjectType"], subjectId: string, subjectVersion: number | null): LearningReviewAction {
  const kind = subjectType === "content_segment" ? "judgment" : subjectType === "skill" ? "recall" : subjectType === "phrase" ? "cloze" : "choice";
  return { kind, promptKey: `review:${kind}:v1`, subjectRef: { type: subjectType, id: subjectId, version: subjectVersion } };
}

export function buildLearningReport(
  observations: readonly LearningObservationEvent[],
  options: Readonly<{
    now?: Date;
    localDate: string;
    timezone: string;
    feedback?: readonly LearningReportFeedbackState[];
  }>,
): LearningReportSnapshot {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - LEARNING_REPORT_WINDOW_DAYS * 86_400_000);
  const recent = observations.filter((event) => event.occurredAt >= since && event.occurredAt <= now);
  const eligible = recent.filter((event) =>
    event.signalStrength !== "exposure" &&
    event.subjectType !== "none" &&
    event.eventType !== "media_exposure" &&
    event.eventType !== "reading_exposure",
  );
  const eventTypeCounts: Record<string, number> = {};
  const sourceModuleCounts: Record<string, number> = {};
  for (const event of recent) {
    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] ?? 0) + 1;
    sourceModuleCounts[event.sourceModule] = (sourceModuleCounts[event.sourceModule] ?? 0) + 1;
  }
  const groups = new Map<string, LearningObservationEvent[]>();
  for (const event of eligible) {
    const key = `${event.subjectType}:${event.subjectId}:${event.subjectVersion ?? ""}`;
    const current = groups.get(key) ?? [];
    current.push(event);
    groups.set(key, current);
  }
  const suppressed = new Set((options.feedback ?? []).filter((item) => item.feedback !== "review_again").map((item) => item.candidateKey));
  const candidates = [...groups.entries()].flatMap(([candidateKey, events]) => {
    const distinctSources = new Set(events.map((event) => event.sourceModule)).size;
    const distinctContexts = new Set(events.map(contextKey)).size;
    const hasStrong = events.some((event) => event.signalStrength === "strong");
    const passes = hasStrong || (events.length >= 2 && (distinctSources >= 2 || distinctContexts >= 2));
    if (!passes || suppressed.has(candidateKey)) return [];
    const first = events[0]!;
    const score = Math.round(events.reduce((sum, event) => sum + scoreSignal(event, now), 0) * 100) / 100;
    return [{
      candidateKey,
      subjectType: first.subjectType as LearningInsightCandidate["subjectType"],
      subjectId: first.subjectId!,
      subjectVersion: first.subjectVersion,
      score,
      strongestSignal: strongestSignal(events),
      signalCount: events.length,
      distinctSources,
      distinctContexts,
      sourceEventIds: events.map((event) => event.id),
      reviewAction: actionFor(first.subjectType as LearningInsightCandidate["subjectType"], first.subjectId!, first.subjectVersion),
    } satisfies LearningInsightCandidate];
  }).sort((a, b) => b.score - a.score || a.candidateKey.localeCompare(b.candidateKey)).slice(0, 3);
  const sourceEventIds = candidates.flatMap((candidate) => candidate.sourceEventIds);
  const latest = recent.reduce<Date | null>((latestDate, event) => !latestDate || event.occurredAt > latestDate ? event.occurredAt : latestDate, null);
  return {
    localDate: options.localDate,
    timezone: options.timezone,
    status: candidates.length > 0 ? "generated" : "insufficient_data",
    reportVersion: LEARNING_REPORT_VERSION,
    algorithmVersion: LEARNING_REPORT_ALGORITHM_VERSION,
    summary: candidates.length > 0 ? "最近的学习线索中，有几处值得用主动回忆再练一次。" : "今天还没有足够的证据判断需要复习的重点。",
    coverage: {
      observationCount: recent.length,
      eligibleObservationCount: eligible.length,
      excludedObservationCount: recent.length - eligible.length,
      eventTypeCounts,
      sourceModuleCounts,
      latestObservedAt: latest?.toISOString() ?? null,
    },
    candidates,
    sourceEventIds,
  };
}
