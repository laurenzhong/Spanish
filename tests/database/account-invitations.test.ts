// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

/**
 * PGlite coverage for the account-management persistence slice
 * (ACCT-ADMIN-001): migration subset 0048/0049, invitation CAS/unique/expiry,
 * append-only audit, role/status CAS and the shared account gate projection.
 */
const state = vi.hoisted(() => ({ database: undefined as unknown }));

vi.mock("@/src/shared/db/client", () => ({
  getDatabase: () => state.database,
  createDatabaseConnection: () => {
    throw new Error("The database tests must use the injected PGlite database.");
  },
}));

import {
  createDrizzleAccountAdminRepository,
  hashInvitationCode,
} from "@/src/modules/account";
import {
  createDrizzleAdminAuditRepository,
  type AdminAuditEntry,
} from "@/src/modules/admin";
import {
  isBlockedAccess,
  readAccountAccess,
} from "@/src/shared/auth/account-access";

const ownerA = "00000000-0000-4000-8000-000000000601";
const ownerB = "00000000-0000-4000-8000-000000000602";
const member = "00000000-0000-4000-8000-000000000603";

async function readMigration(name: string): Promise<string> {
  return (
    await readFile(path.join(process.cwd(), "drizzle", name), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

function repository() {
  return createDrizzleAccountAdminRepository(database as unknown as Database);
}

function auditRepository() {
  return createDrizzleAdminAuditRepository(database as unknown as Database);
}

const now = new Date();

async function seedInvitation(input: {
  email?: string;
  code?: string;
  expiresAt?: Date;
  invitedBy?: string;
} = {}) {
  const code = input.code ?? "SN-INV-0123-4567-89AB";
  const created = await repository().createInvitation({
    email: input.email ?? "friend@example.test",
    role: "member",
    tokenHash: hashInvitationCode(code),
    invitedByUserId: input.invitedBy ?? ownerA,
    expiresAt: input.expiresAt ?? new Date(now.getTime() + 60_000),
    notes: null,
  });
  if (created === "conflict") throw new Error("unexpected-conflict");
  return created;
}

beforeEach(async () => {
  // The shared gate projection short-circuits when the database is not
  // configured, exactly as in production; the injected PGlite database is the
  // authoritative connection for this test file.
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
  client = new PGlite();
  await client.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const name of [
    "0000_big_phalanx.sql",
    "0001_auth_rls.sql",
    "0015_flaky_havok.sql",
    "0021_shallow_killmonger.sql",
    "0022_empty_lenny_balinger.sql",
    "0048_account_access_and_admin_console.sql",
    "0049_admin_read_indexes.sql",
  ]) {
    await client.exec(await readMigration(name));
  }
  database = drizzle(client, { schema });
  state.database = database;
  await client.exec(`
    insert into auth.users (id, email) values
      ('${ownerA}', 'owner-a@example.test'),
      ('${ownerB}', 'owner-b@example.test'),
      ('${member}', 'member@example.test');
    update profiles set role = 'owner' where id in ('${ownerA}', '${ownerB}');
  `);
});

afterEach(async () => {
  delete process.env.DATABASE_URL;
  await client.close();
});

describe("account invitation persistence (0048/0049)", () => {
  it("enforces one pending/redeeming invitation per normalized email", async () => {
    const first = await seedInvitation({ email: "friend@example.test" });
    expect(first.status).toBe("pending");
    const duplicate = await repository().createInvitation({
      email: "friend@example.test",
      role: "member",
      tokenHash: hashInvitationCode("SN-INV-AAAA-AAAA-AAAA"),
      invitedByUserId: ownerA,
      expiresAt: new Date(now.getTime() + 60_000),
      notes: null,
    });
    expect(duplicate).toBe("conflict");

    const revoked = await repository().revokeInvitation(first.id, new Date());
    expect(revoked?.status).toBe("revoked");
    const replacement = await seedInvitation({
      email: "friend@example.test",
      code: "SN-INV-BBBB-BBBB-BBBB",
    });
    expect(replacement.status).toBe("pending");
  });

  it("redeems atomically: exactly one concurrent CAS wins", async () => {
    const invitation = await seedInvitation({ email: "friend@example.test" });
    const nowDate = new Date();
    const results = await Promise.all([
      repository().markInvitationRedeeming({
        tokenHash: invitation.tokenHash,
        email: "friend@example.test",
        now: nowDate,
      }),
      repository().markInvitationRedeeming({
        tokenHash: invitation.tokenHash,
        email: "friend@example.test",
        now: nowDate,
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)?.status).toBe("redeeming");

    const wrongEmail = await seedInvitation({
      email: "second@example.test",
      code: "SN-INV-CCCC-CCCC-CCCC",
    });
    await expect(
      repository().markInvitationRedeeming({
        tokenHash: wrongEmail.tokenHash,
        email: "other@example.test",
        now: nowDate,
      }),
    ).resolves.toBeNull();

    const expired = await seedInvitation({
      email: "expired@example.test",
      code: "SN-INV-DDDD-DDDD-DDDD",
      expiresAt: new Date(nowDate.getTime() - 1),
    });
    await expect(
      repository().markInvitationRedeeming({
        tokenHash: expired.tokenHash,
        email: "expired@example.test",
        now: nowDate,
      }),
    ).resolves.toBeNull();
    await expect(
      repository().expireStaleInvitations(nowDate),
    ).resolves.toBe(1);
    const [expiredRow] = await database
      .select({ status: schema.accountInvitations.status })
      .from(schema.accountInvitations)
      .where(eq(schema.accountInvitations.id, expired.id));
    expect(expiredRow?.status).toBe("expired");
  });

  it("only accepts a redeeming invitation and transitions to failed/accepted accordingly", async () => {
    const invitation = await seedInvitation({ email: "friend@example.test" });
    await expect(
      repository().markInvitationAccepted(invitation.id, member, new Date()),
    ).resolves.toBeNull();

    const nowDate = new Date();
    await repository().markInvitationRedeeming({
      tokenHash: invitation.tokenHash,
      email: "friend@example.test",
      now: nowDate,
    });
    const accepted = await repository().markInvitationAccepted(
      invitation.id,
      member,
      nowDate,
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      acceptedUserId: member,
    });
    await expect(
      repository().revokeInvitation(invitation.id, nowDate),
    ).resolves.toBeNull();

    const failing = await seedInvitation({
      email: "failing@example.test",
      code: "SN-INV-EEEE-EEEE-EEEE",
    });
    await repository().markInvitationRedeeming({
      tokenHash: failing.tokenHash,
      email: "failing@example.test",
      now: nowDate,
    });
    const failed = await repository().markInvitationFailed(
      failing.id,
      "provisioning_partial",
      nowDate,
    );
    expect(failed).toMatchObject({
      status: "failed",
      failureCode: "provisioning_partial",
    });
  });

  it("lists newest-first pages with cursor and status filtering", async () => {
    await seedInvitation({ email: "one@example.test", code: "SN-INV-1111-1111-1111" });
    await seedInvitation({ email: "two@example.test", code: "SN-INV-2222-2222-2222" });
    await seedInvitation({ email: "three@example.test", code: "SN-INV-3333-3333-3333" });

    const firstPage = await repository().listInvitations({ limit: 2 });
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = await repository().listInvitations({
      limit: 2,
      cursor: {
        createdAt: firstPage.rows.at(-1)!.createdAt,
        id: firstPage.rows.at(-1)!.id,
      },
    });
    expect(secondPage.rows).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    const allIds = new Set([
      ...firstPage.rows.map((row) => row.id),
      ...secondPage.rows.map((row) => row.id),
    ]);
    expect(allIds.size).toBe(3);

    const pending = await repository().listInvitations({ limit: 10, status: "pending" });
    expect(pending.rows).toHaveLength(3);
    const accepted = await repository().listInvitations({ limit: 10, status: "accepted" });
    expect(accepted.rows).toHaveLength(0);
  });

  it("rejects duplicate token hashes at the unique index", async () => {
    const invitation = await seedInvitation({ email: "one@example.test" });
    await expect(
      repository().createInvitation({
        email: "two@example.test",
        role: "member",
        tokenHash: invitation.tokenHash,
        invitedByUserId: ownerA,
        expiresAt: new Date(now.getTime() + 60_000),
        notes: null,
      }),
    ).resolves.toBe("conflict");
  });
});

describe("append-only admin audit (0048)", () => {
  const entry: AdminAuditEntry = {
    actorUserId: ownerA,
    action: "invitation.revoke",
    targetKind: "invitation",
    targetId: "00000000-0000-4000-8000-000000000611",
    reason: "owner changed plans",
    requestId: "req-audit-1",
    beforeState: { status: "pending" },
    afterState: { status: "revoked" },
  };

  it("records and lists audit entries without private fields", async () => {
    await auditRepository().record(entry);
    const rows = await auditRepository().list({ limit: 10 });
    expect(rows).toEqual([
      expect.objectContaining({
        actorUserId: ownerA,
        action: "invitation.revoke",
        targetId: entry.targetId,
        reason: "owner changed plans",
      }),
    ]);
    expect(
      await auditRepository().listForTarget("invitation", entry.targetId, 5),
    ).toHaveLength(1);
  });

  it("rejects UPDATE/DELETE/TRUNCATE at the database layer", async () => {
    await auditRepository().record(entry);
    await expect(
      client.exec(`update admin_audit_log set reason = 'rewritten'`),
    ).rejects.toThrow(/admin_audit_log_append_only/u);
    await expect(
      client.exec(`delete from admin_audit_log`),
    ).rejects.toThrow(/admin_audit_log_append_only/u);
    await expect(client.exec(`truncate admin_audit_log`)).rejects.toThrow(
      /admin_audit_log_append_only/u,
    );
    await expect(
      client.exec(
        `insert into admin_audit_log (actor_user_id, action, target_kind, target_id) values ('${ownerA}', 'user.explode', 'user', 'x')`,
      ),
    ).rejects.toThrow(/admin_audit_log_action_check/u);
  });

  it("keeps invitations and the audit log unreadable to client roles", async () => {
    for (const table of ["account_invitations", "admin_audit_log"] as const) {
      for (const privilege of ["select", "insert", "update", "delete"] as const) {
        const result = await client.query<{ allowed: boolean }>(
          `select has_table_privilege('authenticated', '${table}', '${privilege}') as allowed`,
        );
        expect(result.rows[0]?.allowed, `authenticated ${privilege} ${table}`).toBe(
          false,
        );
      }
    }
    const rls = await client.query<{ rowsecurity: boolean }>(
      `select rowsecurity from pg_tables where schemaname = 'public' and tablename in ('account_invitations', 'admin_audit_log')`,
    );
    expect(rls.rows).toHaveLength(2);
    expect(rls.rows.every((row) => row.rowsecurity)).toBe(true);
  });
});

describe("profile role/status/deletion CAS and the shared gate", () => {
  it("writes status conditionally and counts owners", async () => {
    const admin = repository();
    expect(await admin.countOwners()).toBe(2);
    expect(await admin.updateAccountStatus(member, "suspended", new Date())).toBe(true);
    expect(await admin.updateAccountStatus(member, "suspended", new Date())).toBe(false);
    const [stored] = await database
      .select({ status: schema.profiles.accountStatus })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, member));
    expect(stored?.status).toBe("suspended");
  });

  it("sets the invited profile role and marks deletion idempotently", async () => {
    const admin = repository();
    expect(await admin.setInvitedProfile(member, "owner", new Date())).toBe(true);
    expect(await admin.setInvitedProfile("00000000-0000-4000-8000-000000000999", "owner", new Date())).toBe(false);
    expect(await admin.countOwners()).toBe(3);

    const firstMark = await admin.markDeletionRequested(member, new Date("2026-10-21T10:00:00.000Z"));
    expect(firstMark).toMatchObject({ status: "suspended" });
    expect(firstMark?.deletionRequestedAt?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
    const secondMark = await admin.markDeletionRequested(member, new Date("2026-10-22T10:00:00.000Z"));
    expect(secondMark?.deletionRequestedAt?.toISOString()).toBe(
      "2026-10-21T10:00:00.000Z",
    );
  });

  it("reads the shared gate projection for active, suspended and deletion-pending accounts", async () => {
    const admin = repository();
    await expect(readAccountAccess(ownerA)).resolves.toMatchObject({
      role: "owner",
      status: "active",
      deletionPending: false,
    });
    expect(isBlockedAccess(await readAccountAccess(ownerA))).toBe(false);

    await admin.updateAccountStatus(member, "suspended", new Date());
    const suspended = await readAccountAccess(member);
    expect(suspended).toMatchObject({ status: "suspended" });
    expect(isBlockedAccess(suspended)).toBe(true);

    await admin.markDeletionRequested(ownerB, new Date());
    const deletionPending = await readAccountAccess(ownerB);
    expect(deletionPending).toMatchObject({ deletionPending: true });
    expect(isBlockedAccess(deletionPending)).toBe(true);

    await expect(
      readAccountAccess("00000000-0000-4000-8000-000000000999"),
    ).resolves.toBeNull();
  });

  it("maps public uid lookups and reserved uids", async () => {
    const [profile] = await database
      .select({ publicUid: schema.profiles.publicUid })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, member));
    expect(await repository().findUserByPublicUid(profile!.publicUid)).toMatchObject({
      userId: member,
      role: "member",
    });
    expect(await repository().isPublicUidReserved(profile!.publicUid)).toBe(false);
    await database
      .insert(schema.reservedPublicUids)
      .values({ publicUid: profile!.publicUid, reason: "account-deleted" });
    expect(await repository().isPublicUidReserved(profile!.publicUid)).toBe(true);
  });
});
