// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_EXPORT_LIMITS,
  ACCOUNT_EXPORT_VERSION,
  exportAccountData,
} from "@/src/modules/privacy";

import {
  emptyExportSnapshot,
  FakePrivacyRepository,
  TEST_NOW,
} from "./account-test-fakes";

const USER_ID = "00000000-0000-4000-8000-000000000841";

function populatedSnapshot() {
  const snapshot = emptyExportSnapshot({
    publicUid: "SN-EXPT-0001",
    displayName: "Ana",
    role: "owner",
    accountStatus: "active",
    avatarKind: "upload",
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
  });
  return {
    ...snapshot,
    preferences: {
      preferredSpanishRegion: "es-ES",
      correctionMode: "balanced",
      voiceInputPreferred: "preferred",
      learningInsightsEnabled: true,
      recordAssistantLearningIntent: true,
    },
    practiceSessions: {
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000901",
          status: "completed",
          primaryModality: "speech",
          contentVersion: 1,
          startedAt: TEST_NOW,
          completedAt: TEST_NOW,
        },
      ],
      truncated: false,
    },
    evidenceEvents: {
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000902",
          practiceAttemptId: "00000000-0000-4000-8000-000000000903",
          skillKey: "task.start",
          modality: "speech",
          outcomeScore: 0.8,
          evidenceWeight: 0.7,
          confidence: 0.9,
          contentVersion: 1,
          algorithmVersion: "evidence-v1",
          occurredAt: TEST_NOW,
        },
      ],
      truncated: false,
    },
    mediaProgress: {
      rows: [
        {
          mediaVersionId: "00000000-0000-4000-8000-000000000904",
          lastPositionMs: 1200,
          lastSegmentIndex: 1,
          status: "in_progress",
          lastOpenedAt: TEST_NOW,
        },
      ],
      truncated: false,
    },
    conversations: {
      rows: [
        { id: "00000000-0000-4000-8000-000000000905", characterKey: "lucia", createdAt: TEST_NOW },
        { id: "00000000-0000-4000-8000-000000000906", characterKey: "mateo", createdAt: TEST_NOW },
      ],
      truncated: false,
    },
    messages: {
      rows: [
        {
          conversationId: "00000000-0000-4000-8000-000000000905",
          role: "user",
          status: "completed",
          content: "Hola, Lucía.",
          createdAt: TEST_NOW,
        },
        {
          conversationId: "00000000-0000-4000-8000-000000000905",
          role: "character",
          status: "completed",
          content: "¡Hola!",
          createdAt: TEST_NOW,
        },
        {
          conversationId: "00000000-0000-4000-8000-000000000906",
          role: "user",
          status: "completed",
          content: "Buenas.",
          createdAt: TEST_NOW,
        },
      ],
      truncated: false,
    },
  };
}

describe("exportAccountData", () => {
  it("exports private recall scheduling without answer text and reports truncation", async () => {
    const repository = new FakePrivacyRepository();
    repository.snapshot = {
      ...populatedSnapshot(),
      vocabularyRecallProgress: { rows: [{ word: "cafe", mode: "word", stage: "review", revision: 1, successfulReviews: 1, nextReviewAt: TEST_NOW, updatedAt: TEST_NOW }], truncated: true },
    };
    const document = await exportAccountData(repository, USER_ID, { now: TEST_NOW });
    expect(document.vocabularyRecallProgress).toEqual([{ word: "cafe", mode: "word", stage: "review", revision: 1, successfulReviews: 1, nextReviewAt: TEST_NOW.toISOString(), updatedAt: TEST_NOW.toISOString() }]);
    expect(document.truncated.categories).toContain("vocabularyRecallProgress");
  });
  it("builds the versioned export document with per-conversation messages", async () => {
    const repository = new FakePrivacyRepository();
    repository.snapshot = populatedSnapshot();

    const document = await exportAccountData(repository, USER_ID, { now: TEST_NOW });

    expect(document.exportVersion).toBe(ACCOUNT_EXPORT_VERSION);
    expect(document.generatedAt).toBe(TEST_NOW.toISOString());
    expect(repository.lastExportLimits).toEqual(ACCOUNT_EXPORT_LIMITS);
    expect(document.account).toEqual({
      publicUid: "SN-EXPT-0001",
      displayName: "Ana",
      role: "owner",
      accountStatus: "active",
      createdAt: "2026-09-01T08:00:00.000Z",
      avatarKind: "upload",
    });
    expect(document.preferences).toEqual({
      preferredSpanishRegion: "es-ES",
      correctionMode: "balanced",
      voiceInputPreferred: "preferred",
      learningInsightsEnabled: true,
      recordAssistantLearningIntent: true,
    });
    expect(document.learning.evidenceEvents).toEqual([
      expect.objectContaining({ skillKey: "task.start", outcomeScore: 0.8 }),
    ]);
    expect(document.media.progress).toEqual([
      expect.objectContaining({ mediaVersionId: "00000000-0000-4000-8000-000000000904" }),
    ]);
    expect(document.conversations).toEqual([
      {
        characterKey: "lucia",
        createdAt: TEST_NOW.toISOString(),
        messages: [
          { role: "user", status: "completed", content: "Hola, Lucía.", createdAt: TEST_NOW.toISOString() },
          { role: "character", status: "completed", content: "¡Hola!", createdAt: TEST_NOW.toISOString() },
        ],
      },
      {
        characterKey: "mateo",
        createdAt: TEST_NOW.toISOString(),
        messages: [
          { role: "user", status: "completed", content: "Buenas.", createdAt: TEST_NOW.toISOString() },
        ],
      },
    ]);
    expect(document.truncated).toEqual({
      conversations: false,
      messages: false,
      categories: [],
    });
  });

  it("never serializes storage paths, audio ids, signed URLs or credentials", async () => {
    const repository = new FakePrivacyRepository();
    repository.snapshot = populatedSnapshot();
    const document = await exportAccountData(repository, USER_ID, { now: TEST_NOW });
    const serialized = JSON.stringify(document);
    for (const forbidden of [
      "storagePath",
      "storage_path",
      "signedUrl",
      "avatarPath",
      "avatar_path",
      "audioAssetId",
      "audio_asset_id",
      "supabase",
      "SUPABASE",
      "password",
      "token",
      "email",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("reports truncation for every capped collection", async () => {
    const repository = new FakePrivacyRepository();
    const snapshot = emptyExportSnapshot({
      publicUid: "SN-EXPT-0002",
      displayName: null,
      role: "member",
      accountStatus: "active",
      avatarKind: "initials",
      createdAt: TEST_NOW,
    });
    repository.snapshot = {
      ...snapshot,
      practiceSessions: { rows: [], truncated: true },
      savedExpressions: { rows: [], truncated: true },
      conversations: { rows: [], truncated: true },
      messages: { rows: [], truncated: true },
    };
    const document = await exportAccountData(repository, USER_ID, { now: TEST_NOW });
    expect(document.truncated).toEqual({
      conversations: true,
      messages: true,
      categories: ["practiceSessions", "savedExpressions"],
    });
  });

  it("fails when the account profile no longer exists", async () => {
    const repository = new FakePrivacyRepository();
    repository.snapshot = emptyExportSnapshot(null);
    await expect(exportAccountData(repository, USER_ID)).rejects.toThrow(
      /account-export-profile-missing/u,
    );
  });

  it("exports vocabulary marks with clear tombstones and reports truncation", async () => {
    const repository = new FakePrivacyRepository();
    repository.snapshot = {
      ...populatedSnapshot(),
      vocabularyMarks: { rows: [{ word: "cafe", status: "familiar", updatedAt: TEST_NOW }, { word: "pan", status: null, updatedAt: TEST_NOW }], truncated: true },
    };
    const document = await exportAccountData(repository, USER_ID, { now: TEST_NOW });
    expect(document.vocabularyMarks).toEqual([
      { word: "cafe", status: "familiar", updatedAt: TEST_NOW.toISOString() },
      { word: "pan", status: null, updatedAt: TEST_NOW.toISOString() },
    ]);
    expect(document.truncated.categories).toContain("vocabularyMarks");
  });
});
