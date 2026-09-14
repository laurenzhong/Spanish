import { describe, expect, it } from "vitest";

import { buildFourCapabilityOverview, type ProfileEvidence, type SkillStateSnapshot } from "@/src/modules/profile/domain";

const userId = "00000000-0000-4000-8000-000000000031";
const baseState = (skillKey: string, values: Partial<SkillStateSnapshot> = {}): SkillStateSnapshot => ({ userId, skillKey, confidence: values.confidence ?? 0.8, evidenceCount: values.evidenceCount ?? 3, mastery: values.mastery ?? 0.8, snapshotVersion: 1, lastEvidenceAt: values.lastEvidenceAt ?? new Date("2026-08-22T08:00:00.000Z") });
const baseEvidence = (skillKey: string, modality: ProfileEvidence["modality"], values: Partial<ProfileEvidence> = {}): ProfileEvidence => ({ skillKey, modality, confidence: values.confidence ?? 0.8, evidenceWeight: values.evidenceWeight ?? 0.8, outcomeScore: values.outcomeScore ?? 1, occurredAt: values.occurredAt ?? new Date("2026-08-22T08:00:00.000Z"), practiceAttemptId: values.practiceAttemptId ?? null, hintLevel: values.hintLevel ?? 0, sceneLabel: values.sceneLabel ?? null });

describe("buildFourCapabilityOverview", () => {
  it("keeps four groups visible and empty without inventing values", () => {
    const overview = buildFourCapabilityOverview(userId, [], [], new Date("2026-08-23T00:00:00.000Z"));
    expect(overview.capabilityGroups.map((group) => group.key)).toEqual(["lexical", "communication", "voice", "shadowing"]);
    expect(overview.capabilityGroups.every((group) => group.mastery === null && group.status === "data-insufficient")).toBe(true);
    expect(overview.summary).toEqual({ totalEvidence: 0, totalGroups: 4, verifiedGroups: 0 });
  });

  it("routes typing lexical evidence only to lexical and keeps voice empty", () => {
    const overview = buildFourCapabilityOverview(userId, [baseState("lexical.recognition", { evidenceCount: 1, confidence: 0.4, mastery: 0.7 })], [baseEvidence("lexical.recognition", "typing")]);
    expect(overview.capabilityGroups.find((group) => group.key === "lexical")).toMatchObject({ evidenceCount: 1, oralCoverage: 0 });
    expect(overview.capabilityGroups.find((group) => group.key === "voice")).toMatchObject({ evidenceCount: 0, mastery: null, oralCoverage: null });
  });

  it("does not trust a voice snapshot when its only evidence was typing", () => {
    const overview = buildFourCapabilityOverview(userId, [baseState("pronunciation.clarity")], [baseEvidence("pronunciation.clarity", "typing")]);
    expect(overview.capabilityGroups.find((group) => group.key === "voice")).toMatchObject({ evidenceCount: 0, mastery: null, confidence: null });
  });

  it("allows communication typing and speech but restricts voice to speech", () => {
    const overview = buildFourCapabilityOverview(userId, [baseState("task.request"), baseState("pronunciation.clarity")], [baseEvidence("task.request", "typing"), baseEvidence("pronunciation.clarity", "speech")]);
    expect(overview.capabilityGroups.find((group) => group.key === "communication")).toMatchObject({ evidenceCount: 3, oralCoverage: 0 });
    expect(overview.capabilityGroups.find((group) => group.key === "voice")).toMatchObject({ evidenceCount: 3, oralCoverage: 1 });
  });

  it("keeps shadowing separate from communication and de-duplicates representative attempts", () => {
    const evidence = [baseEvidence("shadowing.completeness", "speech", { practiceAttemptId: "attempt-1" }), baseEvidence("shadowing.rhythm", "speech", { practiceAttemptId: "attempt-1" })];
    const overview = buildFourCapabilityOverview(userId, [baseState("shadowing.completeness"), baseState("shadowing.rhythm")], evidence);
    expect(overview.capabilityGroups.find((group) => group.key === "shadowing")).toMatchObject({ evidenceCount: 6 });
    expect(overview.capabilityGroups.find((group) => group.key === "shadowing")?.representativeAttempts).toHaveLength(1);
    expect(overview.capabilityGroups.find((group) => group.key === "communication")).toMatchObject({ evidenceCount: 0, mastery: null });
  });
});
