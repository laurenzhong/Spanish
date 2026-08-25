import { z } from "zod";

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/u;

export const heatmapDaySchema = z.object({
  date: z.string().regex(dateKeyPattern),
  durationMinutes: z.number().int().min(0),
  independentExpressionCount: z.number().int().min(0),
  sceneLabels: z.array(z.string().min(1)),
  sessionCount: z.number().int().min(0),
  skillLabels: z.array(z.string().min(1)),
});

export const learningHeatmapSchema = z.object({
  days: z.array(heatmapDaySchema),
  generatedAt: z.string().datetime(),
  range: z.object({
    from: z.string().regex(dateKeyPattern),
    to: z.string().regex(dateKeyPattern),
  }),
  totals: z.object({
    activeDays: z.number().int().min(0),
    totalMinutes: z.number().int().min(0),
    totalSessions: z.number().int().min(0),
  }),
});

export type HeatmapDay = z.infer<typeof heatmapDaySchema>;
export type LearningHeatmap = z.infer<typeof learningHeatmapSchema>;

export type LearningSession = Readonly<{
  activeSeconds: number;
  attemptCount: number;
  completedAt: Date | null;
  id: string;
  independentExpressionCount: number;
  sceneLabel: string | null;
  startedAt: Date;
  status: "active" | "completed" | "abandoned";
  skillKeys: readonly string[];
}>;

const MAX_SESSION_MINUTES = 45;
const DAY_COUNT = 365;

const axisLabels: readonly [prefix: string, label: string][] = [
  ["listening.", "听辨理解"],
  ["comprehension.", "听辨理解"],
  ["reaction.", "即时反应"],
  ["oral.reaction", "即时反应"],
  ["pronunciation.", "发音清晰"],
  ["fluency.", "语流节奏"],
  ["grammar.", "表达准确"],
  ["accuracy.", "表达准确"],
  ["task.", "交际策略"],
  ["pragmatics.", "交际策略"],
  ["chunk.", "语块调用"],
  ["lexical.", "语块调用"],
  ["transfer.", "迁移表达"],
  ["interaction.", "迁移表达"],
];

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function skillLabel(skillKey: string): string | null {
  return axisLabels.find(([prefix]) => skillKey.startsWith(prefix))?.[1] ?? null;
}

function sessionDurationMinutes(session: LearningSession): number {
  if (session.attemptCount === 0 || session.activeSeconds <= 0) return 0;
  return Math.min(MAX_SESSION_MINUTES, Math.ceil(session.activeSeconds / 60));
}

export function buildLearningHeatmap(
  sessions: readonly LearningSession[],
  generatedAt = new Date(),
): LearningHeatmap {
  const to = dateKey(generatedAt);
  const fromDate = addDays(dateFromKey(to), -(DAY_COUNT - 1));
  const from = dateKey(fromDate);
  const days = new Map<string, HeatmapDay>();

  for (let index = 0; index < DAY_COUNT; index += 1) {
    const current = dateKey(addDays(fromDate, index));
    days.set(current, {
      date: current,
      durationMinutes: 0,
      independentExpressionCount: 0,
      sceneLabels: [],
      sessionCount: 0,
      skillLabels: [],
    });
  }

  for (const session of sessions) {
    const key = dateKey(session.startedAt);
    const day = days.get(key);
    if (!day) continue;
    const durationMinutes = sessionDurationMinutes(session);
    if (durationMinutes === 0) continue;

    const labels = session.skillKeys
      .map(skillLabel)
      .filter((label): label is string => label !== null);
    day.durationMinutes += durationMinutes;
    day.independentExpressionCount += session.independentExpressionCount;
    day.sessionCount += 1;
    day.sceneLabels = session.sceneLabel && !day.sceneLabels.includes(session.sceneLabel)
      ? [...day.sceneLabels, session.sceneLabel]
      : day.sceneLabels;
    day.skillLabels = labels.reduce(
      (unique, label) => unique.includes(label) ? unique : [...unique, label],
      day.skillLabels,
    );
  }

  const values = [...days.values()];
  return learningHeatmapSchema.parse({
    days: values,
    generatedAt: generatedAt.toISOString(),
    range: { from, to },
    totals: {
      activeDays: values.filter((day) => day.durationMinutes > 0).length,
      totalMinutes: values.reduce((sum, day) => sum + day.durationMinutes, 0),
      totalSessions: values.reduce((sum, day) => sum + day.sessionCount, 0),
    },
  });
}

export const learningHeatmapConstants = {
  dayCount: DAY_COUNT,
  maxSessionMinutes: MAX_SESSION_MINUTES,
} as const;
