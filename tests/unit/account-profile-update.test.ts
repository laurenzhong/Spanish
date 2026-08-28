import { describe, expect, it } from "vitest";

import { updateAccountProfile } from "@/src/modules/account/application/update-account-profile";
import type { AccountProfileRecord, AccountRepository } from "@/src/modules/account/repositories";

const record: AccountProfileRecord = {
  userId: "00000000-0000-4000-8000-000000000001",
  publicUid: "SN-7K4M-9Q2P",
  displayName: "Ana",
  nativeLanguage: "zh-CN",
  interfaceLanguage: "zh-CN",
  targetLanguage: "es-ES",
  avatarKind: "upload",
  avatarPresetId: null,
  avatarPath: "private/avatar.webp",
  updatedAt: new Date("2026-08-28T08:00:00.000Z"),
};

describe("updateAccountProfile", () => {
  it("clears an old uploaded avatar when switching to a preset", async () => {
    let update: Parameters<AccountRepository["update"]>[1] | undefined;
    const repository: AccountRepository = {
      async get() { return record; },
      async update(_userId, values) { update = values; return { ...record, ...values, updatedAt: new Date() }; },
    };

    await updateAccountProfile(repository, record.userId, { avatarKind: "preset", avatarPresetId: "green-notebook" });
    expect(update).toMatchObject({ avatarKind: "preset", avatarPresetId: "green-notebook", avatarPath: null });
  });
});
