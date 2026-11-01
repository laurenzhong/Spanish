// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  deleteAccountAsOwner,
  deleteOwnAccount,
  setAccountStatus,
  type AccountDeletionDeps,
} from "@/src/modules/account";

import {
  expectActionError,
  FakeAccountAdminRepository,
  FakeAccountProvisioner,
  FakeAdminAuditRepository,
  FakePrivacyRepository,
  FakeStorageObjectDeleter,
  TEST_NOW,
  testUuid,
} from "./account-test-fakes";

const clock = () => TEST_NOW;
const OWNER_ID = testUuid(1);

function deletionDeps(options: {
  repository: FakeAccountAdminRepository;
  provisioner?: FakeAccountProvisioner | null;
  privacy?: FakePrivacyRepository;
  audit?: FakeAdminAuditRepository;
}): AccountDeletionDeps {
  return {
    repository: options.repository,
    auditRepository: options.audit ?? new FakeAdminAuditRepository(),
    privacyRepository:
      options.privacy ??
      new FakePrivacyRepository(
        { reservedPublicUids: options.repository.reservedPublicUids },
        options.repository.events,
      ),
    storageDeleter: new FakeStorageObjectDeleter(),
    provisioner:
      options.provisioner === undefined
        ? new FakeAccountProvisioner(options.repository.events)
        : options.provisioner,
    clock,
  };
}

describe("setAccountStatus", () => {
  it("returns 404 for an unknown public uid and 400 for an invalid reason", async () => {
    const repository = new FakeAccountAdminRepository();
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner();
    await expect(
      setAccountStatus(
        { repository, auditRepository, provisioner, clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: "SN-AAAA-1111",
          status: "suspended",
          reason: "policy violation",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "RESOURCE_NOT_FOUND", 404);
      return true;
    });

    repository.seedUser({ publicUid: "SN-AAAA-1111" });
    await expect(
      setAccountStatus(
        { repository, auditRepository, provisioner, clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: "SN-AAAA-1111",
          status: "suspended",
          reason: "no",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "VALIDATION_FAILED", 400);
      return true;
    });
  });

  it("refuses self-suspension and suspending the last owner", async () => {
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner();
    const selfRepository = new FakeAccountAdminRepository();
    selfRepository.seedUser({
      userId: OWNER_ID,
      publicUid: "SN-OWNR-1111",
      role: "owner",
    });
    await expect(
      setAccountStatus(
        { repository: selfRepository, auditRepository, provisioner, clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: "SN-OWNR-1111",
          status: "suspended",
          reason: "lock myself out",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_STATE_CONFLICT", 409);
      return true;
    });

    const lastOwnerRepository = new FakeAccountAdminRepository();
    lastOwnerRepository.seedUser({
      userId: testUuid(2),
      publicUid: "SN-OWNR-2222",
      role: "owner",
    });
    await expect(
      setAccountStatus(
        { repository: lastOwnerRepository, auditRepository, provisioner, clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: "SN-OWNR-2222",
          status: "suspended",
          reason: "remove the last owner",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_STATE_CONFLICT", 409);
      return true;
    });
    expect(lastOwnerRepository.users[0]!.status).toBe("active");
  });

  it("writes the database state before banning, and audits once", async () => {
    const events: string[] = [];
    const repository = new FakeAccountAdminRepository(events);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner(events);
    const member = repository.seedUser({ publicUid: "SN-MEMB-3333" });

    const result = await setAccountStatus(
      { repository, auditRepository, provisioner, clock },
      {
        ownerId: OWNER_ID,
        requestId: "req-suspend",
        publicUid: member.publicUid,
        status: "suspended",
        reason: "shared banned content",
      },
    );

    expect(result.user.accountStatus).toBe("suspended");
    expect(events).toEqual([
      "updateAccountStatus:suspended",
      `ban:${member.userId}`,
    ]);
    expect(auditRepository.entries).toEqual([
      expect.objectContaining({
        action: "user.suspend",
        targetId: member.publicUid,
        reason: "shared banned content",
        afterState: { accountStatus: "suspended", role: "member" },
      }),
    ]);
  });

  it("keeps the account blocked when the ban call fails and reconciles on retry", async () => {
    const events: string[] = [];
    const repository = new FakeAccountAdminRepository(events);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner(events);
    provisioner.failBan = true;
    const member = repository.seedUser({ publicUid: "SN-MEMB-4444" });
    const deps = { repository, auditRepository, provisioner, clock };
    const input = {
      ownerId: OWNER_ID,
      requestId: "req",
      publicUid: member.publicUid,
      status: "suspended" as const,
      reason: "shared banned content",
    };

    await expect(setAccountStatus(deps, input)).rejects.toSatisfy(
      (error: unknown) => {
        expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
        return true;
      },
    );
    expect(repository.users[0]!.status).toBe("suspended");
    expect(auditRepository.entries).toHaveLength(1);

    provisioner.failBan = false;
    events.length = 0;
    const retried = await setAccountStatus(deps, input);
    expect(retried.user.accountStatus).toBe("suspended");
    expect(events).toEqual([`ban:${member.userId}`]);
    expect(auditRepository.entries).toHaveLength(1);
  });

  it("unbans before activating and audits the activation", async () => {
    const events: string[] = [];
    const repository = new FakeAccountAdminRepository(events);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner(events);
    const member = repository.seedUser({
      publicUid: "SN-MEMB-5555",
      status: "suspended",
    });

    const result = await setAccountStatus(
      { repository, auditRepository, provisioner, clock },
      {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: member.publicUid,
        status: "active",
        reason: "appeal accepted",
      },
    );
    expect(result.user.accountStatus).toBe("active");
    expect(events).toEqual([
      `unban:${member.userId}`,
      "updateAccountStatus:active",
    ]);
    expect(auditRepository.entries).toEqual([
      expect.objectContaining({ action: "user.activate", reason: "appeal accepted" }),
    ]);
  });

  it("keeps the account suspended when the unban call fails", async () => {
    const repository = new FakeAccountAdminRepository();
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner();
    provisioner.failUnban = true;
    const member = repository.seedUser({
      publicUid: "SN-MEMB-6666",
      status: "suspended",
    });
    await expect(
      setAccountStatus(
        { repository, auditRepository, provisioner, clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: member.publicUid,
          status: "active",
          reason: "appeal accepted",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    expect(repository.users[0]!.status).toBe("suspended");
    expect(auditRepository.entries).toHaveLength(0);
  });

  it("fails closed when the provisioning secret is missing", async () => {
    const repository = new FakeAccountAdminRepository();
    const member = repository.seedUser({ publicUid: "SN-MEMB-7777" });
    await expect(
      setAccountStatus(
        {
          repository,
          auditRepository: new FakeAdminAuditRepository(),
          provisioner: null,
          clock,
        },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: member.publicUid,
          status: "suspended",
          reason: "no secret configured",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    expect(repository.users[0]!.status).toBe("active");
  });
});

describe("deleteAccountAsOwner", () => {
  function seedTarget(repository: FakeAccountAdminRepository, role: "member" | "owner" = "member") {
    repository.seedUser({ userId: OWNER_ID, publicUid: "SN-OWNR-0000", role: "owner" });
    return repository.seedUser({ publicUid: "SN-DELE-9999", role });
  }

  it("validates the confirmation phrase and the audit reason", async () => {
    const repository = new FakeAccountAdminRepository();
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    const deps = deletionDeps({ repository, audit: auditRepository });
    await expect(
      deleteAccountAsOwner(deps, {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: target.publicUid,
        confirmation: "DELETE wrong",
        reason: "requested by user",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "VALIDATION_FAILED", 400);
      return true;
    });
    await expect(
      deleteAccountAsOwner(deps, {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: target.publicUid,
        confirmation: `DELETE ${target.publicUid}`,
        reason: "x",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "VALIDATION_FAILED", 400);
      return true;
    });
  });

  it("returns 404 for an unknown uid and idempotent success for a reserved one", async () => {
    const repository = new FakeAccountAdminRepository();
    seedTarget(repository);
    const deps = deletionDeps({ repository });
    await expect(
      deleteAccountAsOwner(deps, {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: "SN-NONE-0000",
        confirmation: "DELETE SN-NONE-0000",
        reason: "requested by user",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "RESOURCE_NOT_FOUND", 404);
      return true;
    });
    repository.reservedPublicUids.add("SN-GONE-0000");
    await expect(
      deleteAccountAsOwner(deps, {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: "SN-GONE-0000",
        confirmation: "DELETE SN-GONE-0000",
        reason: "requested by user",
      }),
    ).resolves.toEqual({ deleted: true, alreadyDeleted: true });
  });

  it("refuses deleting yourself and deleting the last owner", async () => {
    const repository = new FakeAccountAdminRepository();
    const self = repository.seedUser({
      userId: OWNER_ID,
      publicUid: "SN-OWNR-1111",
      role: "owner",
    });
    await expect(
      deleteAccountAsOwner(deletionDeps({ repository }), {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: self.publicUid,
        confirmation: `DELETE ${self.publicUid}`,
        reason: "delete myself via console",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_STATE_CONFLICT", 409);
      return true;
    });

    const solo = new FakeAccountAdminRepository();
    const target = solo.seedUser({
      userId: testUuid(2),
      publicUid: "SN-OWNR-2222",
      role: "owner",
    });
    await expect(
      deleteAccountAsOwner(deletionDeps({ repository: solo }), {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: target.publicUid,
        confirmation: `DELETE ${target.publicUid}`,
        reason: "delete the last owner",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_STATE_CONFLICT", 409);
      return true;
    });
  });

  it("runs marker → business clear → auth delete → profile removal → audit in order", async () => {
    const events: string[] = [];
    const repository = new FakeAccountAdminRepository(events);
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner(events);
    const privacy = new FakePrivacyRepository(
      {
        reservedPublicUid: target.publicUid,
        reservedPublicUids: repository.reservedPublicUids,
      },
      events,
    );
    const result = await deleteAccountAsOwner(
      deletionDeps({ repository, provisioner, privacy, audit: auditRepository }),
      {
        ownerId: OWNER_ID,
        requestId: "req-delete",
        publicUid: target.publicUid,
        confirmation: `DELETE ${target.publicUid}`,
        reason: "user requested deletion",
      },
    );

    expect(result).toEqual({ deleted: true, alreadyDeleted: false });
    expect(events).toEqual([
      "markDeletionRequested",
      "clearAccountBusinessData",
      `deleteUser:${target.userId}`,
      "deleteAccountProfile",
    ]);
    expect(auditRepository.entries).toEqual([
      expect.objectContaining({
        actorUserId: OWNER_ID,
        action: "user.delete",
        targetKind: "user",
        targetId: target.publicUid,
        reason: "user requested deletion",
        requestId: "req-delete",
        afterState: { deleted: true },
      }),
    ]);
    expect(repository.users.find((user) => user.userId === target.userId)?.status).toBe(
      "suspended",
    );
    expect(
      repository.users.find((user) => user.userId === target.userId)?.deletionRequestedAt,
    ).toEqual(TEST_NOW);
  });

  it("keeps deletion_requested_at and stays retryable when the Auth deletion fails", async () => {
    const events: string[] = [];
    const repository = new FakeAccountAdminRepository(events);
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner(events);
    provisioner.failDeleteTimes = 1;
    const privacy = new FakePrivacyRepository(
      { reservedPublicUids: repository.reservedPublicUids },
      events,
    );
    const deps = deletionDeps({ repository, provisioner, privacy, audit: auditRepository });
    const input = {
      ownerId: OWNER_ID,
      requestId: "req-delete",
      publicUid: target.publicUid,
      confirmation: `DELETE ${target.publicUid}`,
      reason: "user requested deletion",
    };

    await expect(deleteAccountAsOwner(deps, input)).rejects.toSatisfy(
      (error: unknown) => {
        expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
        return true;
      },
    );
    const marker = repository.users.find((user) => user.userId === target.userId);
    expect(marker?.deletionRequestedAt).toEqual(TEST_NOW);
    expect(marker?.status).toBe("suspended");
    expect(privacy.clearCalls).toBe(1);
    expect(privacy.deletedProfileCalls).toBe(0);
    expect(auditRepository.entries).toHaveLength(0);

    const retried = await deleteAccountAsOwner(deps, input);
    expect(retried).toEqual({ deleted: true, alreadyDeleted: false });
    expect(provisioner.deletedUserIds).toEqual([target.userId]);
    expect(privacy.deletedProfileCalls).toBe(1);
    expect(auditRepository.entries).toHaveLength(1);
  });

  it("returns idempotent success after a completed deletion", async () => {
    const events: string[] = [];
    const repository = new FakeAccountAdminRepository(events);
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner(events);
    const privacy = new FakePrivacyRepository(
      {
        reservedPublicUid: target.publicUid,
        reservedPublicUids: repository.reservedPublicUids,
      },
      events,
    );
    const deps = deletionDeps({ repository, provisioner, privacy, audit: auditRepository });
    const input = {
      ownerId: OWNER_ID,
      requestId: "req",
      publicUid: target.publicUid,
      confirmation: `DELETE ${target.publicUid}`,
      reason: "user requested deletion",
    };
    await deleteAccountAsOwner(deps, input);

    repository.users.splice(
      repository.users.findIndex((user) => user.userId === target.userId),
      1,
    );
    await expect(deleteAccountAsOwner(deps, input)).resolves.toEqual({
      deleted: true,
      alreadyDeleted: true,
    });
    expect(auditRepository.entries).toHaveLength(1);
  });

  it("treats a concurrent tombstone removal after Auth deletion as idempotent", async () => {
    const repository = new FakeAccountAdminRepository();
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner();
    const privacy = new FakePrivacyRepository(
      { reservedPublicUids: repository.reservedPublicUids },
      repository.events,
    );
    privacy.deleteAccountProfile = async () => {
      privacy.deletedProfileCalls += 1;
      privacy.events.push("deleteAccountProfile");
      return false;
    };

    const result = await deleteAccountAsOwner(
      deletionDeps({ repository, provisioner, privacy, audit: auditRepository }),
      {
        ownerId: OWNER_ID,
        requestId: "req-concurrent-retry",
        publicUid: target.publicUid,
        confirmation: `DELETE ${target.publicUid}`,
        reason: "concurrent retry",
      },
    );

    expect(result).toEqual({ deleted: true, alreadyDeleted: true });
    expect(provisioner.deletedUserIds).toEqual([target.userId]);
    expect(auditRepository.entries).toHaveLength(0);
  });

  it("keeps the marker when clearing business data fails", async () => {
    const repository = new FakeAccountAdminRepository();
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    const privacy = new FakePrivacyRepository(
      { reservedPublicUids: repository.reservedPublicUids },
      repository.events,
    );
    privacy.failClear = true;
    await expect(
      deleteAccountAsOwner(
        deletionDeps({ repository, privacy, audit: auditRepository }),
        {
          ownerId: OWNER_ID,
          requestId: "req",
          publicUid: target.publicUid,
          confirmation: `DELETE ${target.publicUid}`,
          reason: "user requested deletion",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    expect(
      repository.users.find((user) => user.userId === target.userId)?.deletionRequestedAt,
    ).toEqual(TEST_NOW);
    expect(auditRepository.entries).toHaveLength(0);
  });

  it("completes even when the best-effort audit write fails", async () => {
    const repository = new FakeAccountAdminRepository();
    const target = seedTarget(repository);
    const auditRepository = new FakeAdminAuditRepository();
    auditRepository.failRecord = true;
    const result = await deleteAccountAsOwner(
      deletionDeps({ repository, audit: auditRepository }),
      {
        ownerId: OWNER_ID,
        requestId: "req",
        publicUid: target.publicUid,
        confirmation: `DELETE ${target.publicUid}`,
        reason: "user requested deletion",
      },
    );
    expect(result).toEqual({ deleted: true, alreadyDeleted: false });
  });
});

describe("deleteOwnAccount", () => {
  it("returns idempotent success for an account that is already gone", async () => {
    const repository = new FakeAccountAdminRepository();
    await expect(
      deleteOwnAccount(deletionDeps({ repository }), {
        userId: testUuid(42),
        requestId: "req",
      }),
    ).resolves.toEqual({ deleted: true, alreadyDeleted: true });
  });

  it("deletes the caller's own account and audits the self-service action", async () => {
    const repository = new FakeAccountAdminRepository();
    const user = repository.seedUser({
      userId: OWNER_ID,
      publicUid: "SN-SELF-0000",
      role: "owner",
    });
    const auditRepository = new FakeAdminAuditRepository();
    const provisioner = new FakeAccountProvisioner();
    const result = await deleteOwnAccount(
      deletionDeps({ repository, provisioner, audit: auditRepository }),
      { userId: user.userId, requestId: "req-self" },
    );
    expect(result).toEqual({ deleted: true, alreadyDeleted: false });
    expect(provisioner.deletedUserIds).toEqual([user.userId]);
    expect(auditRepository.entries).toEqual([
      expect.objectContaining({
        actorUserId: user.userId,
        action: "user.delete",
        targetId: user.publicUid,
        reason: "Self-service account deletion.",
      }),
    ]);
  });
});
