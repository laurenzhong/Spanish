// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createAccountInvitation,
  listAccountInvitations,
  redeemAccountInvitation,
  revokeAccountInvitation,
} from "@/src/modules/account";
import { hashInvitationCode } from "@/src/modules/account/domain/invitation";

import {
  expectActionError,
  FakeAccountAdminRepository,
  FakeAccountProvisioner,
  FakeAdminAuditRepository,
  TEST_NOW,
  testUuid,
} from "./account-test-fakes";

const clock = () => TEST_NOW;
const randomBytes = () => Uint8Array.from({ length: 16 }, (_value, index) => index);
const DETERMINISTIC_CODE = "SN-INV-0123-4567-89AB";
const OWNER_ID = testUuid(1);

function createDeps(
  overrides: Partial<Parameters<typeof createAccountInvitation>[0]> = {},
) {
  const repository = new FakeAccountAdminRepository();
  const auditRepository = new FakeAdminAuditRepository();
  return {
    repository,
    auditRepository,
    deps: {
      repository,
      auditRepository,
      registrationEnabled: true,
      clock,
      randomBytes,
      ...overrides,
    },
  };
}

describe("createAccountInvitation", () => {
  it("fails closed when invitations are disabled", async () => {
    const { deps, repository } = createDeps({ registrationEnabled: false });
    await expect(
      createAccountInvitation(deps, {
        ownerId: OWNER_ID,
        requestId: "req-1",
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "REGISTRATION_CLOSED", 403);
      return true;
    });
    expect(repository.invitations).toHaveLength(0);
  });

  it("creates a hashed, expiring invitation and returns the plaintext code once", async () => {
    const { deps, repository, auditRepository } = createDeps();
    const result = await createAccountInvitation(deps, {
      ownerId: OWNER_ID,
      requestId: "req-1",
      email: "  Friend@Example.TEST ",
      role: "member",
      expiresInHours: 24,
      notes: "alpha friend",
    });

    expect(result.code).toBe(DETERMINISTIC_CODE);
    expect(result.invitation).toMatchObject({
      emailMasked: "f***@example.test",
      role: "member",
      status: "pending",
      createdAt: TEST_NOW.toISOString(),
    });
    const stored = repository.invitations[0]!;
    expect(stored.email).toBe("friend@example.test");
    expect(stored.tokenHash).toBe(hashInvitationCode(DETERMINISTIC_CODE));
    expect(stored.tokenHash).not.toContain(DETERMINISTIC_CODE);
    expect(stored.expiresAt.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    expect(auditRepository.entries).toEqual([
      expect.objectContaining({
        actorUserId: OWNER_ID,
        action: "invitation.create",
        targetKind: "invitation",
        targetId: stored.id,
        requestId: "req-1",
        reason: "alpha friend",
      }),
    ]);
    expect(JSON.stringify(result.invitation)).not.toContain("friend@example.test");
  });

  it("defaults to seven days and reports a conflict for a pending duplicate", async () => {
    const { deps, repository } = createDeps();
    const first = await createAccountInvitation(deps, {
      ownerId: OWNER_ID,
      requestId: "req-1",
      email: "friend@example.test",
    });
    expect(first.invitation.expiresAt).toBe("2026-10-28T12:00:00.000Z");

    await expect(
      createAccountInvitation(deps, {
        ownerId: OWNER_ID,
        requestId: "req-2",
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_CONFLICT", 409);
      return true;
    });
    expect(repository.invitations).toHaveLength(1);
  });

  it("keeps the business result when the best-effort audit write fails", async () => {
    const { deps, repository, auditRepository } = createDeps();
    auditRepository.failRecord = true;
    const result = await createAccountInvitation(deps, {
      ownerId: OWNER_ID,
      requestId: "req-1",
      email: "friend@example.test",
    });
    expect(result.code).toBe(DETERMINISTIC_CODE);
    expect(repository.invitations).toHaveLength(1);
  });
});

describe("listAccountInvitations", () => {
  it("rejects malformed cursors", async () => {
    const repository = new FakeAccountAdminRepository();
    await expect(
      listAccountInvitations({ repository, clock }, { limit: 20, cursor: "garbage" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "VALIDATION_FAILED", 400);
      return true;
    });
  });

  it("lazily expires stale invitations and paginates masked rows", async () => {
    const repository = new FakeAccountAdminRepository();
    const auditRepository = new FakeAdminAuditRepository();
    for (let index = 0; index < 3; index += 1) {
      await createAccountInvitation(
        {
          repository,
          auditRepository,
          registrationEnabled: true,
          clock,
          randomBytes: () =>
            Uint8Array.from({ length: 16 }, (_value, offset) => offset + index),
        },
        { ownerId: OWNER_ID, requestId: "req", email: `friend${index}@example.test` },
      );
    }
    repository.invitations[0]!.expiresAt = new Date(TEST_NOW.getTime() - 1);

    const firstPage = await listAccountInvitations(
      { repository, clock },
      { limit: 2 },
    );
    expect(firstPage.invitations).toHaveLength(2);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();
    expect(repository.invitations[0]!.status).toBe("expired");

    const secondPage = await listAccountInvitations(
      { repository, clock },
      { limit: 2, cursor: firstPage.page.nextCursor ?? undefined },
    );
    expect(secondPage.page.hasMore).toBe(false);
    const allEmails = [...firstPage.invitations, ...secondPage.invitations].map(
      (invitation) => invitation.emailMasked,
    );
    expect(allEmails.every((email) => email.includes("***@example.test"))).toBe(true);
    expect(allEmails.some((email) => email.includes("friend"))).toBe(false);

    const expiredOnly = await listAccountInvitations(
      { repository, clock },
      { limit: 20, status: "expired" },
    );
    expect(expiredOnly.invitations).toHaveLength(1);
  });
});

describe("revokeAccountInvitation", () => {
  async function seedInvitation() {
    const context = createDeps();
    await createAccountInvitation(context.deps, {
      ownerId: OWNER_ID,
      requestId: "req",
      email: "friend@example.test",
    });
    const repository = context.repository;
    const invitation = repository.invitations[0]!;
    return { ...context, invitation };
  }

  it("revokes a pending invitation and writes the audit entry", async () => {
    const { repository, auditRepository, invitation } = await seedInvitation();
    const result = await revokeAccountInvitation(
      { repository, auditRepository, clock },
      {
        ownerId: OWNER_ID,
        requestId: "req-revoke",
        invitationId: invitation.id,
        reason: "owner changed plans",
      },
    );
    expect(result.invitation.status).toBe("revoked");
    expect(result.invitation.revokedAt).toBe(TEST_NOW.toISOString());
    expect(auditRepository.entries.at(-1)).toEqual(
      expect.objectContaining({
        action: "invitation.revoke",
        targetId: invitation.id,
        beforeState: { status: "pending" },
        afterState: { status: "revoked" },
        reason: "owner changed plans",
      }),
    );
  });

  it("rejects unknown invitations with 404 and non-pending ones with 409", async () => {
    const { repository } = await seedInvitation();
    await expect(
      revokeAccountInvitation(
        { repository, auditRepository: new FakeAdminAuditRepository(), clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          invitationId: testUuid(1234),
          reason: "no longer needed",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "RESOURCE_NOT_FOUND", 404);
      return true;
    });

    const accepted = repository.invitations[0]!;
    accepted.status = "accepted";
    accepted.acceptedUserId = testUuid(50);
    accepted.acceptedAt = TEST_NOW;
    await expect(
      revokeAccountInvitation(
        { repository, auditRepository: new FakeAdminAuditRepository(), clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          invitationId: accepted.id,
          reason: "no longer needed",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_CONFLICT", 409);
      return true;
    });
  });

  it("validates the audit reason", async () => {
    const { repository, invitation } = await seedInvitation();
    await expect(
      revokeAccountInvitation(
        { repository, auditRepository: new FakeAdminAuditRepository(), clock },
        {
          ownerId: OWNER_ID,
          requestId: "req",
          invitationId: invitation.id,
          reason: "no",
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "VALIDATION_FAILED", 400);
      return true;
    });
  });
});

describe("redeemAccountInvitation", () => {
  const expectedUserId = testUuid(901);

  async function seedPendingInvitation(
    overrides: { email?: string; expiresAt?: Date; role?: "member" | "owner" } = {},
  ) {
    const { deps, repository, auditRepository } = createDeps();
    await createAccountInvitation(deps, {
      ownerId: OWNER_ID,
      requestId: "req",
      email: overrides.email ?? "friend@example.test",
      role: overrides.role,
    });
    const invitation = repository.invitations[0]!;
    if (overrides.expiresAt) invitation.expiresAt = overrides.expiresAt;
    return { repository, auditRepository, invitation };
  }

  function depsFor(
    repository: FakeAccountAdminRepository,
    provisioner: FakeAccountProvisioner | null = new FakeAccountProvisioner(),
    registrationEnabled = true,
  ) {
    return { repository, provisioner, registrationEnabled, clock };
  }

  it("fails closed when disabled or when the provisioner is not configured", async () => {
    const { repository, invitation } = await seedPendingInvitation();
    await expect(
      redeemAccountInvitation(depsFor(repository, new FakeAccountProvisioner(), false), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "REGISTRATION_CLOSED", 403);
      return true;
    });

    await expect(
      redeemAccountInvitation(depsFor(repository, null), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    // The single-use invitation is not consumed by a configuration failure.
    expect(repository.invitations[0]!.status).toBe("pending");
    expect(repository.invitations[0]!.id).toBe(invitation.id);
  });

  it("returns the same INVITATION_INVALID for unknown, expired, revoked and mismatched invitations", async () => {
    const unknown = await seedPendingInvitation();
    await expect(
      redeemAccountInvitation(depsFor(unknown.repository), {
        code: "SN-INV-ZZZZ-ZZZZ-ZZZZ",
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_INVALID", 400);
      return true;
    });

    const mismatch = await seedPendingInvitation();
    await expect(
      redeemAccountInvitation(depsFor(mismatch.repository), {
        code: DETERMINISTIC_CODE,
        email: "other@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_INVALID", 400);
      return true;
    });

    const expired = await seedPendingInvitation({
      expiresAt: new Date(TEST_NOW.getTime() - 1),
    });
    await expect(
      redeemAccountInvitation(depsFor(expired.repository), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_INVALID", 400);
      return true;
    });

    const revoked = await seedPendingInvitation();
    revoked.invitation.status = "revoked";
    revoked.invitation.revokedAt = TEST_NOW;
    await expect(
      redeemAccountInvitation(depsFor(revoked.repository), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_INVALID", 400);
      return true;
    });

    const accepted = await seedPendingInvitation();
    accepted.invitation.status = "accepted";
    accepted.invitation.acceptedUserId = testUuid(77);
    accepted.invitation.acceptedAt = TEST_NOW;
    await expect(
      redeemAccountInvitation(depsFor(accepted.repository), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "INVITATION_INVALID", 400);
      return true;
    });
  });

  it("provisions the Auth user, applies the invited role and accepts the invitation", async () => {
    const { repository, invitation } = await seedPendingInvitation({ role: "owner" });
    repository.seedUser({ userId: expectedUserId, publicUid: "SN-AAAA-1111" });
    const provisioner = new FakeAccountProvisioner();
    const result = await redeemAccountInvitation(depsFor(repository, provisioner), {
      code: DETERMINISTIC_CODE,
      email: "friend@example.test",
    });

    expect(result).toEqual({ status: "ready", email: "friend@example.test" });
    expect(provisioner.createdEmails).toEqual(["friend@example.test"]);
    const invitationAfter = repository.invitations[0]!;
    expect(invitationAfter.status).toBe("accepted");
    expect(invitationAfter.acceptedUserId).toBe(expectedUserId);
    expect(invitationAfter.acceptedAt).toEqual(TEST_NOW);
    expect(invitationAfter.id).toBe(invitation.id);
    expect(repository.users[0]).toMatchObject({ role: "owner", status: "active" });
    expect(provisioner.deletedUserIds).toHaveLength(0);
  });

  it("allows exactly one concurrent redemption of the same code", async () => {
    const { repository } = await seedPendingInvitation();
    repository.seedUser({ userId: expectedUserId, publicUid: "SN-AAAA-2222" });
    const provisioner = new FakeAccountProvisioner();
    const results = await Promise.allSettled([
      redeemAccountInvitation(depsFor(repository, provisioner), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
      redeemAccountInvitation(depsFor(repository, provisioner), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectActionError(rejected[0]!.reason, "INVITATION_INVALID", 400);
    expect(provisioner.createdEmails).toHaveLength(1);
    expect(repository.invitations[0]!.status).toBe("accepted");
  });

  it("marks the invitation failed when Auth user creation fails", async () => {
    const { repository } = await seedPendingInvitation();
    const provisioner = new FakeAccountProvisioner();
    provisioner.failCreate = true;
    await expect(
      redeemAccountInvitation(depsFor(repository, provisioner), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    expect(repository.invitations[0]!.status).toBe("failed");
    expect(repository.invitations[0]!.failureCode).toBe("provisioning_failed");
  });

  it("compensates with deleteUser when the profile write fails", async () => {
    const { repository } = await seedPendingInvitation();
    // No seeded profile: the trigger-created profile is missing.
    const provisioner = new FakeAccountProvisioner();
    await expect(
      redeemAccountInvitation(depsFor(repository, provisioner), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    expect(provisioner.deletedUserIds).toEqual([expectedUserId]);
    expect(repository.invitations[0]!.status).toBe("failed");
    expect(repository.invitations[0]!.failureCode).toBe("provisioning_partial");
  });

  it("keeps a failed invitation when the compensating Auth deletion also fails", async () => {
    const { repository } = await seedPendingInvitation();
    const provisioner = new FakeAccountProvisioner();
    provisioner.failDelete = true;
    await expect(
      redeemAccountInvitation(depsFor(repository, provisioner), {
        code: DETERMINISTIC_CODE,
        email: "friend@example.test",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectActionError(error, "ACCOUNT_PROVISIONING_FAILED", 503);
      return true;
    });
    expect(repository.invitations[0]!.status).toBe("failed");
    expect(repository.invitations[0]!.failureCode).toBe("provisioning_partial");
  });
});
