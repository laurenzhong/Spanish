import { z } from "zod";

import { rebuildSkillState, type SkillStateSnapshot } from "./update-skill-state";

const representativeAttemptSchema = z.object({
  occurredAt: z.string().datetime(),
  modality: z.enum(["listening", "reading", "speech", "typing"]),
  sceneLabel: z.string().nullable(),
  hintLevel: z.number().int().min(0).max(3).nullable(),
});

export const profileAxisSchema = z.object({
  confidence: z.number().min(0).max(1).nullable(),
  description: z.string(),
  evidenceCount: z.number().int().nonnegative(),
  key: z.string().min(1),
  label: z.string().min(1),
  lastEvidenceAt: z.string().datetime().nullable(),
  mastery: z.number().min(0).max(1).nullable(),
  oralCoverage: z.number().min(0).max(1).nullable(),
  previousMastery: z.number().min(0).max(1).nullable(),
  previousConfidence: z.number().min(0).max(1).nullable(),
  representativeAttempts: z.array(representativeAttemptSchema).max(3),
  skillKeys: z.array(z.string()),
  status: z.enum(["data-insufficient", "accumulating", "developing", "verified"]),
});

export const profileOverviewSchema = z.object({
  axes: z.array(profileAxisSchema).length(8),
  generatedAt: z.string().datetime(),
  summary: z.object({
    totalEvidence: z.number().int().nonnegative(),
    totalAxes: z.number().int().positive(),
    verifiedAxes: z.number().int().nonnegative(),
  }),
});

export type ProfileAxis = z.infer<typeof profileAxisSchema>;
export type ProfileOverview = z.infer<typeof profileOverviewSchema>;
export type ProfileRepresentativeAttempt = z.infer<typeof representativeAttemptSchema>;

export type ProfileEvidence = Readonly<{
  confidence: number;
  occurredAt: Date;
  evidenceWeight: number;
  skillKey: string;
  modality: "listening" | "reading" | "speech" | "typing";
  outcomeScore: number;
  practiceAttemptId: string | null;
  hintLevel: number | null;
  sceneLabel: string | null;
}>;

type AxisDefinition = Readonly<{
  description: string;
  key: string;
  label: string;
  prefixes: readonly string[];
}>;

export const PROFILE_AXIS_DEFINITIONS: readonly AxisDefinition[] = [
  {
    key: "listening-comprehension",
    label: "听辨理解",
    description: "听懂对方的重点、意图和语气。",
    prefixes: ["listening.", "comprehension."],
  },
  {
    key: "instant-reaction",
    label: "即时反应",
    description: "在有限准备时间内组织出可接住的回应。",
    prefixes: ["reaction.", "oral.reaction"],
  },
  {
    key: "pronunciation-clarity",
    label: "发音清晰",
    description: "让关键发音足够清楚，不要求唯一口音。",
    prefixes: ["pronunciation."],
  },
  {
    key: "fluency-rhythm",
    label: "语流节奏",
    description: "保持自然的停顿、连贯和轮次衔接。",
    prefixes: ["fluency."],
  },
  {
    key: "expression-accuracy",
    label: "表达准确",
    description: "用合适的词形和结构表达想传达的意思。",
    prefixes: ["grammar.", "accuracy."],
  },
  {
    key: "conversation-strategy",
    label: "交际策略",
    description: "会请求澄清、修复误解并推动沟通继续。",
    prefixes: ["task.", "pragmatics."],
  },
  {
    key: "chunk-retrieval",
    label: "语块调用",
    description: "在真实情境中调用熟悉表达，而不是逐词翻译。",
    prefixes: ["chunk.", "lexical."],
  },
  {
    key: "transfer-expression",
    label: "迁移表达",
    description: "把学过的表达迁移到陌生信息和关系中。",
    prefixes: ["transfer.", "interaction."],
  },
];

function matchesAxis(skillKey: string, definition: AxisDefinition): boolean {
  return definition.prefixes.some((prefix) => skillKey.startsWith(prefix));
}

function weightedAverage(
  states: readonly SkillStateSnapshot[],
  value: (state: SkillStateSnapshot) => number,
): number | null {
  if (states.length === 0) return null;
  const totalWeight = states.reduce(
    (sum, state) => sum + Math.max(state.evidenceCount, 1),
    0,
  );
  return states.reduce(
    (sum, state) =>
      sum + value(state) * Math.max(state.evidenceCount, 1),
    0,
  ) / totalWeight;
}

function latestDate(states: readonly SkillStateSnapshot[]): Date | null {
  return states.reduce<Date | null>((latest, state) => {
    if (!state.lastEvidenceAt) return latest;
    return !latest || state.lastEvidenceAt > latest
      ? state.lastEvidenceAt
      : latest;
  }, null);
}

function statusFor(
  mastery: number | null,
  confidence: number | null,
  evidenceCount: number,
): ProfileAxis["status"] {
  if (evidenceCount === 0 || mastery === null || confidence === null) {
    return "data-insufficient";
  }
  if (evidenceCount < 3 || confidence < 0.5) return "accumulating";
  if (mastery >= 0.7 && confidence >= 0.7) return "verified";
  return "developing";
}

function historicalStates(
  userId: string,
  evidence: readonly ProfileEvidence[],
  cutoff: Date,
): readonly SkillStateSnapshot[] {
  const grouped = new Map<string, ProfileEvidence[]>();
  for (const item of evidence) {
    if (item.occurredAt > cutoff) continue;
    const entries = grouped.get(item.skillKey) ?? [];
    entries.push(item);
    grouped.set(item.skillKey, entries);
  }
  return [...grouped.entries()].map(([skillKey, entries]) =>
    rebuildSkillState(
      userId,
      skillKey,
      [...entries]
        .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
        .map((item) => ({
          confidence: item.confidence,
          evidenceWeight: item.evidenceWeight,
          occurredAt: item.occurredAt,
          outcomeScore: item.outcomeScore,
        })),
    ),
  );
}

function representativeAttempts(
  evidence: readonly ProfileEvidence[],
  skillKeys: readonly string[],
): ProfileRepresentativeAttempt[] {
  const seenAttempts = new Set<string>();
  return [...evidence]
    .filter((item) => skillKeys.includes(item.skillKey))
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .filter((item) => {
      if (!item.practiceAttemptId) return true;
      if (seenAttempts.has(item.practiceAttemptId)) return false;
      seenAttempts.add(item.practiceAttemptId);
      return true;
    })
    .slice(0, 3)
    .map((item) => ({
      occurredAt: item.occurredAt.toISOString(),
      hintLevel: item.hintLevel,
      modality: item.modality,
      sceneLabel: item.sceneLabel,
    }));
}

export function buildProfileOverview(
  userId: string,
  states: readonly SkillStateSnapshot[],
  evidence: readonly ProfileEvidence[],
  generatedAt = new Date(),
): ProfileOverview {
  const cutoff = new Date(generatedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 28);
  const previous = historicalStates(userId, evidence, cutoff);
  const axes = PROFILE_AXIS_DEFINITIONS.map((definition) => {
    const matchingStates = states.filter((state) =>
      matchesAxis(state.skillKey, definition),
    );
    const skillKeys = matchingStates.map((state) => state.skillKey);
    const matchingEvidence = evidence.filter((item) =>
      skillKeys.includes(item.skillKey),
    );
    const previousStates = previous.filter((state) =>
      skillKeys.includes(state.skillKey),
    );
    const evidenceCount = matchingStates.reduce(
      (sum, state) => sum + state.evidenceCount,
      0,
    );
    const mastery = weightedAverage(matchingStates, (state) => state.mastery);
    const confidence = weightedAverage(
      matchingStates,
      (state) => state.confidence,
    );
    const oralEvidence = matchingEvidence.filter(
      (item) => item.modality === "speech",
    ).length;

    return {
      confidence,
      description: definition.description,
      evidenceCount,
      key: definition.key,
      label: definition.label,
      lastEvidenceAt: latestDate(matchingStates)?.toISOString() ?? null,
      mastery,
      oralCoverage:
        matchingEvidence.length > 0 ? oralEvidence / matchingEvidence.length : null,
      previousConfidence: weightedAverage(previousStates, (state) => state.confidence),
      previousMastery: weightedAverage(previousStates, (state) => state.mastery),
      representativeAttempts: representativeAttempts(evidence, skillKeys),
      skillKeys,
      status: statusFor(mastery, confidence, evidenceCount),
    } satisfies ProfileAxis;
  });

  return profileOverviewSchema.parse({
    axes,
    generatedAt: generatedAt.toISOString(),
    summary: {
      totalEvidence: axes.reduce((sum, axis) => sum + axis.evidenceCount, 0),
      totalAxes: axes.length,
      verifiedAxes: axes.filter((axis) => axis.status === "verified").length,
    },
  });
}
