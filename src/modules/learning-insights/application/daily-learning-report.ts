import { buildLearningReport, LEARNING_REPORT_VERSION, type LearningReportFeedback } from "../domain/report";
import type { LearningReportRepository, LearningReportRecord } from "../repositories/learning-observation-repository";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function assertDate(value: string): string {
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new Error("invalid-report-date");
  return value;
}

export async function generateDailyLearningReport(
  repository: LearningReportRepository,
  userId: string,
  options: Readonly<{ localDate: string; timezone: string; now?: Date; generationId?: string }>,
): Promise<LearningReportRecord> {
  const localDate = assertDate(options.localDate);
  const existing = await repository.getReport(userId, localDate, LEARNING_REPORT_VERSION);
  if (existing) return existing;
  const now = options.now ?? new Date();
  const observations = await repository.listObservations(userId, { since: new Date(now.getTime() - 14 * 86_400_000), limit: 2_000 });
  const feedback = await repository.listAllReportFeedback(userId);
  const snapshot = buildLearningReport(observations, { localDate, timezone: options.timezone, now, feedback });
  return repository.saveReport(userId, snapshot, options.generationId ?? crypto.randomUUID());
}

export function localDateForTimezone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
  } catch {
    // An invalid stored timezone should not prevent the private report from loading.
  }
  return now.toISOString().slice(0, 10);
}

export async function getDailyLearningReport(
  repository: LearningReportRepository,
  userId: string,
  localDate: string,
): Promise<LearningReportRecord | null> {
  return repository.getReport(userId, assertDate(localDate), LEARNING_REPORT_VERSION);
}

export async function recordDailyLearningReportFeedback(
  repository: LearningReportRepository,
  userId: string,
  reportId: string,
  input: Readonly<{ candidateKey: string; feedback: LearningReportFeedback; dedupeKey: string }>,
) {
  const report = await repository.getReportById(userId, reportId);
  if (!report) throw new Error("report-not-found");
  if (!report.candidates.some((candidate) => candidate.candidateKey === input.candidateKey)) throw new Error("candidate-not-found");
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{2,200}$/u.test(input.candidateKey)) throw new Error("invalid-candidate-key");
  if (!/^[a-z0-9][a-z0-9:._-]{2,200}$/u.test(input.dedupeKey)) throw new Error("invalid-feedback-dedupe-key");
  return repository.recordReportFeedback(userId, reportId, input.candidateKey, input.feedback, input.dedupeKey);
}
