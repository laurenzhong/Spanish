import { z } from "zod";

import { rebuildSkillState, type SkillStateSnapshot } from "./update-skill-state";
import { CAPABILITY_GROUP_DEFINITIONS, evidenceMatchesCapability, skillBelongsToCapability, type CapabilityGroupKey } from "./capability-groups";
import type { ProfileEvidence, ProfileRepresentativeAttempt } from "./profile-overview";

const capabilitySkillSchema = z.object({
  key: z.string().min(1),
  mastery: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceCount: z.number().int().nonnegative(),
});

const capabilityGroupSchema = z.object({
  key: z.enum(["lexical", "communication", "voice", "shadowing"]),
  label: z.string().min(1),
  description: z.string(),
  mastery: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceCount: z.number().int().nonnegative(),
  lastEvidenceAt: z.string().datetime().nullable(),
  oralCoverage: z.number().min(0).max(1).nullable(),
  previousMastery: z.number().min(0).max(1).nullable(),
  previousConfidence: z.number().min(0).max(1).nullable(),
  representativeAttempts: z.array(z.object({
    occurredAt: z.string().datetime(),
    modality: z.enum(["listening", "reading", "speech", "typing"]),
    sceneLabel: z.string().nullable(),
    hintLevel: z.number().int().min(0).max(3).nullable(),
  })).max(3),
  skillKeys: z.array(z.string()),
  skills: z.array(capabilitySkillSchema),
  status: z.enum(["data-insufficient", "accumulating", "developing", "verified"]),
});

export const fourCapabilityOverviewSchema = z.object({
  capabilityGroups: z.array(capabilityGroupSchema).length(4),
  generatedAt: z.string().datetime(),
  summary: z.object({ totalEvidence: z.number().int().nonnegative(), totalGroups: z.literal(4), verifiedGroups: z.number().int().nonnegative() }),
});

export type CapabilitySkill = z.infer<typeof capabilitySkillSchema>;
export type CapabilityGroup = z.infer<typeof capabilityGroupSchema>;
export type FourCapabilityOverview = z.infer<typeof fourCapabilityOverviewSchema>;

function weightedAverage(states: readonly SkillStateSnapshot[], value: (state: SkillStateSnapshot) => number): number | null {
  if (states.length === 0) return null;
  const weight = states.reduce((sum, state) => sum + Math.max(state.evidenceCount, 1), 0);
  return states.reduce((sum, state) => sum + value(state) * Math.max(state.evidenceCount, 1), 0) / weight;
}

function lastEvidence(states: readonly SkillStateSnapshot[]): string | null {
  return states.reduce<Date | null>((latest, state) => !state.lastEvidenceAt || (latest && latest >= state.lastEvidenceAt) ? latest : state.lastEvidenceAt, null)?.toISOString() ?? null;
}

function statusFor(mastery: number | null, confidence: number | null, evidenceCount: number): CapabilityGroup["status"] {
  if (!evidenceCount || mastery === null || confidence === null) return "data-insufficient";
  if (evidenceCount < 3 || confidence < 0.5) return "accumulating";
  if (mastery >= 0.7 && confidence >= 0.7) return "verified";
  return "developing";
}

function history(userId: string, evidence: readonly ProfileEvidence[], cutoff: Date): readonly SkillStateSnapshot[] {
  const grouped = new Map<string, ProfileEvidence[]>();
  for (const item of evidence) {
    if (item.occurredAt > cutoff) continue;
    const entries = grouped.get(item.skillKey) ?? [];
    entries.push(item);
    grouped.set(item.skillKey, entries);
  }
  return [...grouped.entries()].map(([skillKey, entries]) => rebuildSkillState(userId, skillKey, entries.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())));
}

function representativeAttempts(evidence: readonly ProfileEvidence[], definition: (typeof CAPABILITY_GROUP_DEFINITIONS)[number]): ProfileRepresentativeAttempt[] {
  const seen = new Set<string>();
  return evidence.filter((item) => evidenceMatchesCapability(item, definition)).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).filter((item) => {
    if (!item.practiceAttemptId) return true;
    if (seen.has(item.practiceAttemptId)) return false;
    seen.add(item.practiceAttemptId);
    return true;
  }).slice(0, 3).map((item) => ({ occurredAt: item.occurredAt.toISOString(), modality: item.modality, sceneLabel: item.sceneLabel, hintLevel: item.hintLevel }));
}

export function buildFourCapabilityOverview(userId: string, states: readonly SkillStateSnapshot[], evidence: readonly ProfileEvidence[], generatedAt = new Date()): FourCapabilityOverview {
  const cutoff = new Date(generatedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 28);
  const previous = history(userId, evidence, cutoff);
  const capabilityGroups = CAPABILITY_GROUP_DEFINITIONS.map((definition) => {
    const matchingEvidence = evidence.filter((item) => evidenceMatchesCapability(item, definition));
    const eligibleSkillKeys = new Set(matchingEvidence.map((item) => item.skillKey));
    const matchingStates = states.filter((state) => skillBelongsToCapability(state.skillKey, definition) && eligibleSkillKeys.has(state.skillKey));
    const skillKeys = matchingStates.map((state) => state.skillKey);
    const previousStates = previous.filter((state) => skillKeys.includes(state.skillKey));
    const skills = matchingStates.map((state) => ({ key: state.skillKey, mastery: state.mastery, confidence: state.confidence, evidenceCount: state.evidenceCount }));
    const evidenceCount = matchingStates.reduce((sum, state) => sum + state.evidenceCount, 0);
    const mastery = weightedAverage(matchingStates, (state) => state.mastery);
    const confidence = weightedAverage(matchingStates, (state) => state.confidence);
    return {
      key: definition.key as CapabilityGroupKey,
      label: definition.label,
      description: definition.description,
      mastery,
      confidence,
      evidenceCount,
      lastEvidenceAt: lastEvidence(matchingStates),
      oralCoverage: matchingEvidence.length ? matchingEvidence.filter((item) => item.modality === "speech").length / matchingEvidence.length : null,
      previousMastery: weightedAverage(previousStates, (state) => state.mastery),
      previousConfidence: weightedAverage(previousStates, (state) => state.confidence),
      representativeAttempts: representativeAttempts(evidence, definition),
      skillKeys,
      skills,
      status: statusFor(mastery, confidence, evidenceCount),
    } satisfies CapabilityGroup;
  });
  return fourCapabilityOverviewSchema.parse({ capabilityGroups, generatedAt: generatedAt.toISOString(), summary: { totalEvidence: capabilityGroups.reduce((sum, group) => sum + group.evidenceCount, 0), totalGroups: 4, verifiedGroups: capabilityGroups.filter((group) => group.status === "verified").length } });
}
