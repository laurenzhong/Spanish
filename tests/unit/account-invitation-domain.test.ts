// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertInvitationTransition,
  canTransitionInvitation,
  DEFAULT_INVITATION_TTL_HOURS,
  evaluateInvitationRedemption,
  generateInvitationCode,
  hashInvitationCode,
  INVITATION_CODE_PATTERN,
  invitationExpiresAt,
  isInvitationExpired,
  isValidInvitationCode,
  maskInvitationEmail,
  normalizeInvitationCode,
  normalizeInvitationEmail,
  parseInvitationTtlHours,
  resolveInvitationStatus,
  type InvitationStatus,
} from "@/src/modules/account/domain/invitation";
import {
  decodeListCursor,
  encodeListCursor,
} from "@/src/modules/account/domain/pagination-cursor";

const now = new Date("2026-10-21T12:00:00.000Z");

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("account invitation domain", () => {
  it("generates canonical SN-INV codes with 60 bits of deterministic entropy", () => {
    const code = generateInvitationCode(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));
    expect(code).toBe("SN-INV-0123-4567-89AB");
    expect(code).toMatch(/^SN-INV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u);
    expect(code).toMatch(INVITATION_CODE_PATTERN);
    expect(isValidInvitationCode(code)).toBe(true);
    expect(generateInvitationCode(bytes(...Array.from({ length: 12 }, () => 31)))).toBe(
      "SN-INV-ZZZZ-ZZZZ-ZZZZ",
    );
  });

  it("refuses to generate a code from insufficient randomness", () => {
    expect(() => generateInvitationCode(bytes(1, 2, 3))).toThrow(
      /insufficient-invitation-entropy/u,
    );
  });

  it("normalizes copied codes into the canonical dashed form and hashes stably", () => {
    const code = "SN-INV-0123-4567-89AB";
    expect(normalizeInvitationCode("  sn-inv-0123-4567-89ab ")).toBe(code);
    expect(normalizeInvitationCode("sninv0123456789ab")).toBe(code);
    expect(normalizeInvitationCode("SN-INV-0123-4567-89A")).toBeNull();
    expect(normalizeInvitationCode("SN-INV-0123-4567-89AI")).toBeNull();
    expect(normalizeInvitationCode("XX-INV-0123-4567-89AB")).toBeNull();

    const hash = hashInvitationCode(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashInvitationCode("sninv0123456789ab")).toBe(hash);
    expect(hashInvitationCode("SN-INV-ZZZZ-ZZZZ-ZZZZ")).not.toBe(hash);
    expect(() => hashInvitationCode("not-a-code")).toThrow(/invalid-invitation-code/u);
  });

  it("normalizes and masks invitation emails without exposing the local part", () => {
    expect(normalizeInvitationEmail("  Friend@Example.TEST ")).toBe("friend@example.test");
    expect(normalizeInvitationEmail("a@b")).toBeNull();
    expect(normalizeInvitationEmail("no-at-sign.test")).toBeNull();
    expect(normalizeInvitationEmail("two@@example.test")).toBeNull();
    expect(normalizeInvitationEmail("spaces in@example.test")).toBeNull();
    expect(normalizeInvitationEmail("UPPER@EXAMPLE.TEST")).toBe("upper@example.test");
    expect(maskInvitationEmail("friend@example.test")).toBe("f***@example.test");
    expect(maskInvitationEmail("a@example.test")).toBe("a***@example.test");
    expect(maskInvitationEmail("broken")).toBe("***");
  });

  it("computes invitation expiry from ttl hours and parses the env setting fail-safe", () => {
    expect(DEFAULT_INVITATION_TTL_HOURS).toBe(168);
    expect(invitationExpiresAt(now, 168).toISOString()).toBe(
      "2026-10-28T12:00:00.000Z",
    );
    expect(invitationExpiresAt(now, 1).toISOString()).toBe(
      "2026-10-21T13:00:00.000Z",
    );
    expect(() => invitationExpiresAt(now, 0)).toThrow(/invalid-invitation-ttl/u);
    expect(() => invitationExpiresAt(now, 721)).toThrow(/invalid-invitation-ttl/u);
    expect(() => invitationExpiresAt(now, 1.5)).toThrow(/invalid-invitation-ttl/u);

    expect(parseInvitationTtlHours(undefined)).toBe(168);
    expect(parseInvitationTtlHours("")).toBe(168);
    expect(parseInvitationTtlHours("24")).toBe(24);
    expect(parseInvitationTtlHours("720")).toBe(720);
    expect(parseInvitationTtlHours("0")).toBe(168);
    expect(parseInvitationTtlHours("10000")).toBe(168);
    expect(parseInvitationTtlHours("abc")).toBe(168);
  });

  it("treats the expiry boundary as expired", () => {
    expect(isInvitationExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isInvitationExpired(now, now)).toBe(true);
    expect(isInvitationExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });

  it("enforces the invitation state machine", () => {
    expect(canTransitionInvitation("pending", "redeeming")).toBe(true);
    expect(canTransitionInvitation("pending", "revoked")).toBe(true);
    expect(canTransitionInvitation("pending", "expired")).toBe(true);
    expect(canTransitionInvitation("redeeming", "accepted")).toBe(true);
    expect(canTransitionInvitation("redeeming", "failed")).toBe(true);
    for (const terminal of ["accepted", "expired", "revoked", "failed"] as const) {
      for (const next of [
        "pending",
        "redeeming",
        "accepted",
        "expired",
        "revoked",
        "failed",
      ] as const) {
        expect(canTransitionInvitation(terminal as InvitationStatus, next)).toBe(false);
      }
    }
    expect(canTransitionInvitation("pending", "accepted")).toBe(false);
    expect(canTransitionInvitation("redeeming", "revoked")).toBe(false);
    expect(() => assertInvitationTransition("accepted", "redeeming")).toThrow(
      /invalid-invitation-transition:accepted->redeeming/u,
    );
    expect(() => assertInvitationTransition("pending", "redeeming")).not.toThrow();
  });

  it("lazily resolves pending invitations past their deadline as expired", () => {
    expect(resolveInvitationStatus("pending", new Date(now.getTime() - 1), now)).toBe(
      "expired",
    );
    expect(resolveInvitationStatus("pending", new Date(now.getTime() + 1), now)).toBe(
      "pending",
    );
    expect(resolveInvitationStatus("revoked", new Date(now.getTime() - 1), now)).toBe(
      "revoked",
    );
    expect(resolveInvitationStatus("redeeming", new Date(now.getTime() - 1), now)).toBe(
      "redeeming",
    );
  });

  it("evaluates redemption with one indistinguishable invalid outcome", () => {
    const base = {
      email: "friend@example.test",
      expiresAt: new Date(now.getTime() + 60_000),
    };
    expect(
      evaluateInvitationRedemption({ ...base, status: "pending" }, {
        email: "friend@example.test",
        now,
      }),
    ).toEqual({ kind: "redeemable" });
    expect(
      evaluateInvitationRedemption({ ...base, status: "pending" }, {
        email: "other@example.test",
        now,
      }),
    ).toEqual({ kind: "invalid", reason: "email_mismatch" });
    expect(
      evaluateInvitationRedemption(
        { ...base, status: "pending", expiresAt: new Date(now.getTime() - 1) },
        { email: "friend@example.test", now },
      ),
    ).toEqual({ kind: "invalid", reason: "expired" });
    for (const status of ["revoked", "accepted", "failed", "redeeming"] as const) {
      expect(
        evaluateInvitationRedemption({ ...base, status }, {
          email: "friend@example.test",
          now,
        }),
      ).toEqual({
        kind: "invalid",
        reason:
          status === "accepted"
            ? "accepted"
            : status === "redeeming"
              ? "in_progress"
              : status,
      });
    }
  });

  it("round-trips opaque pagination cursors and rejects malformed input", () => {
    const id = "00000000-0000-4000-8000-000000000123";
    const cursor = encodeListCursor({ createdAt: now, id });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeListCursor(cursor)).toEqual({ createdAt: now, id });
    expect(decodeListCursor("not-a-cursor")).toBeNull();
    expect(decodeListCursor("")).toBeNull();
    expect(
      decodeListCursor(
        Buffer.from(JSON.stringify({ v: 2, createdAt: now.toISOString(), id })).toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeListCursor(
        Buffer.from(JSON.stringify({ v: 1, createdAt: "not-a-date", id })).toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeListCursor(
        Buffer.from(JSON.stringify({ v: 1, createdAt: now.toISOString(), id: "nope" })).toString("base64url"),
      ),
    ).toBeNull();
  });
});
