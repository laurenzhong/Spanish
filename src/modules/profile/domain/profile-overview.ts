import { z } from "zod";

import type { SkillStateSnapshot } from "./update-skill-state";

export const profileAxisSchema = z.object({
  confidence: z.number().min(0).max(1).nullable(),
  description: z.string(),
  evidenceCount: z.number().int().nonnegative(),
  key: z.string().min(1),
  label: z.string().min(1),
  lastEvidenceAt: z.string().datetime().nullable(),
  mastery: z.number().min(0).max(1).nullable(),
  oralCoverage: z.number().min(0).max(1).nullable(),
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

export type ProfileEvidence = Readonly<{
  occurredAt: Date;
  skillKey: string;
  modality: "listening" | "reading" | "speech" | "typing";
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

export function buildProfileOverview(
  _userId: string,
  states: readonly SkillStateSnapshot[],
  evidence: readonly ProfileEvidence[],
  generatedAt = new Date(),
): ProfileOverview {
  const axes = PROFILE_AXIS_DEFINITIONS.map((definition) => {
    const matchingStates = states.filter((state) =>
      matchesAxis(state.skillKey, definition),
    );
    const skillKeys = matchingStates.map((state) => state.skillKey);
    const matchingEvidence = evidence.filter((item) =>
      skillKeys.includes(item.skillKey),
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
