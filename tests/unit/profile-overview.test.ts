import { describe, expect, it } from "vitest";

import {
  buildProfileOverview,
  type ProfileEvidence,
} from "@/src/modules/profile/domain";
import type { SkillStateSnapshot } from "@/src/modules/profile/domain";

const userId = "00000000-0000-4000-8000-000000000031";

function state(
  skillKey: string,
  values: Partial<SkillStateSnapshot> = {},
): SkillStateSnapshot {
  return {
    confidence: values.confidence ?? 0.4,
    evidenceCount: values.evidenceCount ?? 1,
    lastEvidenceAt: values.lastEvidenceAt ?? new Date("2026-08-22T08:00:00.000Z"),
    mastery: values.mastery ?? 0.5,
    skillKey,
    snapshotVersion: 1,
    userId,
  };
}

function evidence(
  skillKey: string,
  modality: ProfileEvidence["modality"],
): ProfileEvidence {
  return {
    occurredAt: new Date("2026-08-22T08:00:00.000Z"),
    skillKey,
    modality,
  };
}

describe("buildProfileOverview", () => {
  it("keeps all eight axes visible without inventing values", () => {
    const overview = buildProfileOverview(
      userId,
      [],
      [],
      new Date("2026-08-23T00:00:00.000Z"),
    );

    expect(overview.axes).toHaveLength(8);
    expect(overview.axes.every((axis) => axis.status === "data-insufficient")).toBe(
      true,
    );
    expect(overview.axes.every((axis) => axis.mastery === null)).toBe(true);
    expect(overview.summary).toEqual({
      totalAxes: 8,
      totalEvidence: 0,
      verifiedAxes: 0,
    });
  });

  it("aggregates related skills by evidence weight and keeps oral coverage separate", () => {
    const overview = buildProfileOverview(
      userId,
      [
        state("task.start", {
          confidence: 0.6,
          evidenceCount: 2,
          mastery: 0.4,
        }),
        state("task.need", {
          confidence: 0.8,
          evidenceCount: 1,
          mastery: 0.8,
        }),
      ],
      [evidence("task.start", "speech"), evidence("task.need", "typing")],
      new Date("2026-08-23T00:00:00.000Z"),
    );

    const axis = overview.axes.find((item) => item.key === "conversation-strategy");
    expect(axis).toMatchObject({
      confidence: 2 / 3,
      evidenceCount: 3,
      mastery: 8 / 15,
      oralCoverage: 0.5,
      status: "developing",
    });
  });

  it("only marks an axis verified when both mastery and confidence are strong", () => {
    const overview = buildProfileOverview(
      userId,
      [
        state("fluency.turn-taking", {
          confidence: 0.8,
          evidenceCount: 3,
          mastery: 0.8,
        }),
      ],
      [
        evidence("fluency.turn-taking", "speech"),
        evidence("fluency.turn-taking", "speech"),
        evidence("fluency.turn-taking", "speech"),
      ],
      new Date("2026-08-23T00:00:00.000Z"),
    );

    expect(overview.axes.find((item) => item.key === "fluency-rhythm")).toMatchObject({
      status: "verified",
      oralCoverage: 1,
    });
  });
});
