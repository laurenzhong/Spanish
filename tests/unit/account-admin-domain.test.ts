// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_REASON_MAX_LENGTH,
  ACCOUNT_REASON_MIN_LENGTH,
  isAccountRole,
  isAccountStatus,
  isOwnerAccountDeletionConfirmation,
  isValidAccountReason,
  normalizeAccountReason,
  ownerAccountDeletionConfirmation,
  planAccountStatusChange,
  planOwnerAccountDeletion,
  SELF_ACCOUNT_DELETION_CONFIRMATION,
} from "@/src/modules/account/domain/account-admin";

describe("account administration domain", () => {
  it("validates and trims management reasons", () => {
    expect(ACCOUNT_REASON_MIN_LENGTH).toBe(4);
    expect(ACCOUNT_REASON_MAX_LENGTH).toBe(500);
    expect(normalizeAccountReason("  policy violation  ")).toBe("policy violation");
    expect(isValidAccountReason("  违规内容  ")).toBe(true);
    expect(isValidAccountReason("abc")).toBe(false);
    expect(isValidAccountReason("a".repeat(501))).toBe(false);
    expect(() => normalizeAccountReason("abc")).toThrow(/invalid-account-reason/u);
  });

  it("guards the account role/status enums", () => {
    expect(isAccountRole("owner")).toBe(true);
    expect(isAccountRole("member")).toBe(true);
    expect(isAccountRole("admin")).toBe(false);
    expect(isAccountStatus("active")).toBe(true);
    expect(isAccountStatus("suspended")).toBe(true);
    expect(isAccountStatus("deleted")).toBe(false);
  });

  it("plans status changes with self and last-owner protection", () => {
    expect(
      planAccountStatusChange({
        actorUserId: "owner",
        target: { userId: "member", role: "member", status: "active" },
        nextStatus: "suspended",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "change", from: "active", to: "suspended" });

    expect(
      planAccountStatusChange({
        actorUserId: "owner",
        target: { userId: "owner", role: "owner", status: "active" },
        nextStatus: "suspended",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "conflict", reason: "self" });

    expect(
      planAccountStatusChange({
        actorUserId: "owner",
        target: { userId: "other-owner", role: "owner", status: "active" },
        nextStatus: "suspended",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "conflict", reason: "last-owner" });

    expect(
      planAccountStatusChange({
        actorUserId: "owner",
        target: { userId: "other-owner", role: "owner", status: "active" },
        nextStatus: "suspended",
        ownerCount: 2,
      }),
    ).toEqual({ kind: "change", from: "active", to: "suspended" });

    // Repeating the current state is a no-op (callers may reconcile the ban).
    expect(
      planAccountStatusChange({
        actorUserId: "owner",
        target: { userId: "member", role: "member", status: "suspended" },
        nextStatus: "suspended",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "noop", status: "suspended" });

    // Activation is never blocked by the last-owner rule.
    expect(
      planAccountStatusChange({
        actorUserId: "owner",
        target: { userId: "owner", role: "owner", status: "suspended" },
        nextStatus: "active",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "change", from: "suspended", to: "active" });
  });

  it("plans owner-initiated deletion and builds confirmation phrases", () => {
    expect(SELF_ACCOUNT_DELETION_CONFIRMATION).toBe("DELETE_MY_ACCOUNT");
    const publicUid = "SN-7K4M-9Q2P";
    expect(ownerAccountDeletionConfirmation(publicUid)).toBe(`DELETE ${publicUid}`);
    expect(isOwnerAccountDeletionConfirmation(`DELETE ${publicUid}`, publicUid)).toBe(
      true,
    );
    expect(isOwnerAccountDeletionConfirmation("DELETE_MY_ACCOUNT", publicUid)).toBe(
      false,
    );

    expect(
      planOwnerAccountDeletion({
        actorUserId: "owner",
        targetUserId: "owner",
        targetRole: "owner",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "conflict", reason: "self" });

    expect(
      planOwnerAccountDeletion({
        actorUserId: "owner-a",
        targetUserId: "owner-b",
        targetRole: "owner",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "conflict", reason: "last-owner" });

    expect(
      planOwnerAccountDeletion({
        actorUserId: "owner-a",
        targetUserId: "member",
        targetRole: "member",
        ownerCount: 1,
      }),
    ).toEqual({ kind: "allowed" });

    expect(
      planOwnerAccountDeletion({
        actorUserId: "owner-a",
        targetUserId: "owner-b",
        targetRole: "owner",
        ownerCount: 2,
      }),
    ).toEqual({ kind: "allowed" });
  });
});
