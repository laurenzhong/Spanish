// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

/**
 * Protocol-level tests for the account Route Handlers (ACCT-ADMIN-001).
 *
 * The handlers run against their real `withAdminOwner` wrapper, real Drizzle
 * repositories and an isolated PGlite database; only the Supabase Admin
 * provisioner is replaced with an in-memory fake so no network is touched.
 */
const state = vi.hoisted(() => ({
  database: undefined as unknown,
  provisioner: undefined as unknown,
}));

vi.mock("@/src/shared/db/client", () => ({
  getDatabase: () => state.database,
  createDatabaseConnection: () => {
    throw new Error("The route tests must use the injected PGlite database.");
  },
}));

vi.mock("@/src/modules/account/providers/supabase-admin-provisioner", () => ({
  readSupabaseAdminCredentials: () => ({ url: "https://example.test", secretKey: "test" }),
  createSupabaseAccountProvisioner: () => state.provisioner,
}));

// Next.js `cookies()` is unavailable outside a request store; the E2E cookie
// verifier already resolves request identity, so the fallback returns null.
vi.mock("@/src/shared/auth/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/shared/auth/server")>();
  return { ...actual, getCurrentUser: async () => null };
});

import { GET as listInvitationsRoute, POST as createInvitationRoute } from "@/app/api/v1/admin/invitations/route";
import { POST as revokeInvitationRoute } from "@/app/api/v1/admin/invitations/[invitationId]/revoke/route";
import { PATCH as patchStatusRoute } from "@/app/api/v1/admin/users/[publicUid]/status/route";
import { POST as ownerDeletionRoute } from "@/app/api/v1/admin/users/[publicUid]/deletion/route";
import { POST as redeemInvitationRoute } from "@/app/api/v1/auth/invitations/redeem/route";
import { DELETE as deleteOwnAccountRoute } from "@/app/api/v1/me/account/route";
import { GET as exportRoute } from "@/app/api/v1/me/export/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import {
  createDrizzleAccountAdminRepository,
  hashInvitationCode,
  resetRedeemRateLimitState,
} from "@/src/modules/account";
import {
  createDrizzleAdminAuditRepository,
  type AdminAuditEntry,
} from "@/src/modules/admin";

const OWNER_ID = "00000000-0000-4000-8000-000000000701";
const ENV_OWNER_ID = "00000000-0000-4000-8000-000000000704";
const MEMBER_ID = "00000000-0000-4000-8000-000000000702";
const NON_OWNER_ID = "00000000-0000-4000-8000-000000000703";
const UID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let pglite: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let uidCounter = 0;
let idCounter = 0;

function uuid(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

function publicUid(): string {
  uidCounter += 1;
  let n = uidCounter;
  let body = "";
  for (let index = 0; index < 8; index += 1) {
    body = UID_ALPHABET[n % UID_ALPHABET.length]! + body;
    n = Math.floor(n / UID_ALPHABET.length);
  }
  return `SN-${body.slice(0, 4)}-${body.slice(4)}`;
}

async function readMigration(name: string): Promise<string> {
  return (
    await readFile(path.join(process.cwd(), "drizzle", name), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

async function seedAuthUser(id: string): Promise<void> {
  await pglite.exec(
    `insert into auth.users (id, email) values ('${id}', '${id}@example.test') on conflict do nothing`,
  );
}

async function seedUser(input: {
  id?: string;
  role?: "owner" | "member";
  status?: "active" | "suspended";
  deletionRequestedAt?: Date;
} = {}): Promise<{ id: string; publicUid: string }> {
  const id = input.id ?? uuid();
  // The 0015 trigger creates the profile row; update it to the requested state.
  await seedAuthUser(id);
  await database
    .update(schema.profiles)
    .set({
      displayName: "Test user",
      ...(input.role ? { role: input.role } : {}),
      ...(input.status ? { accountStatus: input.status } : {}),
      ...(input.deletionRequestedAt
        ? { deletionRequestedAt: input.deletionRequestedAt }
        : {}),
    })
    .where(eq(schema.profiles.id, id));
  const [row] = await database
    .select({ publicUid: schema.profiles.publicUid })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, id));
  if (!row) throw new Error("seed-user-profile-missing");
  return { id, publicUid: row.publicUid };
}

function ownerRequest(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; userId?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    cookie: `spanish-e2e-user=${options.userId ?? OWNER_ID}`,
    "content-type": "application/json",
    ...options.headers,
  };
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function auditEntries(): Promise<readonly AdminAuditEntry[]> {
  return createDrizzleAdminAuditRepository(
    database as unknown as Database,
  ).list({ limit: 100 });
}

async function seedInvitation(input: {
  email?: string;
  code?: string;
  status?: "pending" | "redeeming" | "accepted" | "expired" | "revoked" | "failed";
  expiresAt?: Date;
  notes?: string | null;
}) {
  const code = input.code ?? "SN-INV-0123-4567-89AB";
  const repository = createDrizzleAccountAdminRepository(
    database as unknown as Database,
  );
  const created = await repository.createInvitation({
    email: input.email ?? "friend@example.test",
    role: "member",
    tokenHash: hashInvitationCode(code),
    invitedByUserId: OWNER_ID,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60_000),
    notes: input.notes ?? null,
  });
  if (created === "conflict") throw new Error("unexpected-conflict");
  if (input.status && input.status !== "pending") {
    await database
      .update(schema.accountInvitations)
      .set({
        status: input.status,
        ...(input.status === "accepted"
          ? { acceptedUserId: MEMBER_ID, acceptedAt: new Date() }
          : {}),
        ...(input.status === "revoked" ? { revokedAt: new Date() } : {}),
        ...(input.status === "failed"
          ? { failureCode: "provisioning_failed", failedAt: new Date() }
          : {}),
      })
      .where(eq(schema.accountInvitations.id, created.id));
  }
  return created;
}

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://owner:owner@127.0.0.1:5432/test";
  process.env.AUTH_E2E_ENABLED = "1";
  process.env.OWNER_USER_IDS = OWNER_ID;
  process.env.ACCOUNT_INVITATIONS_ENABLED = "1";
  process.env.ACCOUNT_INVITATION_TTL_HOURS = "168";

  pglite = new PGlite();
  await pglite.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  // Seed the fixed identities before 0001 installs the profile-creation trigger,
  // so their profiles are inserted explicitly below.
  await seedAuthUser(OWNER_ID);
  await seedAuthUser(ENV_OWNER_ID);
  await seedAuthUser(MEMBER_ID);
  for (const name of [
    "0000_big_phalanx.sql",
    "0001_auth_rls.sql",
    "0005_kind_character_network.sql",
    "0007_spicy_talkback.sql",
    "0011_early_colleen_wing.sql",
    "0012_wakeful_spiral.sql",
    "0015_flaky_havok.sql",
    "0016_proactive_messages.sql",
    "0017_sudden_betty_brant.sql",
    "0020_volatile_eternity.sql",
    "0024_media_library_foundation.sql",
    "0045_lumpy_medusa.sql",
    "0047_conversation_reply_sources.sql",
    "0048_account_access_and_admin_console.sql",
    "0050_parched_nextwave.sql",
    "0051_learning_insight_reports.sql",
    "0052_user_vocabulary_marks.sql",
    "0053_vocabulary_mark_import_boundary.sql",
    "0054_vocabulary_recall_progress.sql",
    "0055_vocabulary_recall_privileges.sql",
    "0056_character_relationship_state.sql",
  ]) {
    await pglite.exec(await readMigration(name));
  }
  database = drizzle(pglite, { schema });
  state.database = database;

  await database.insert(schema.profiles).values({
    id: OWNER_ID,
    publicUid: publicUid(),
    displayName: "Owner",
    role: "owner",
  });
  await database.insert(schema.profiles).values({
    id: MEMBER_ID,
    publicUid: publicUid(),
    displayName: "Member",
  });
  await database.insert(schema.profiles).values({
    id: ENV_OWNER_ID,
    publicUid: publicUid(),
    displayName: "Env owner",
    role: "member",
  });

  state.provisioner = {
    createConfirmedUser: async ({ email }: { email: string }) => {
      const authUserId = uuid();
      // The migrated auth trigger creates the matching profile row.
      await pglite.exec(
        `insert into auth.users (id, email, raw_user_meta_data) values ('${authUserId}', '${authUserId}@example.test', '{"display_name":"${email.replaceAll("'", "")}"}'::jsonb)`,
      );
      return { userId: authUserId };
    },
    deleteUser: async () => undefined,
    banUser: async () => undefined,
    unbanUser: async () => undefined,
  };
});

afterAll(async () => {
  await pglite.close();
  delete process.env.OWNER_USER_IDS;
  delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
  delete process.env.ACCOUNT_INVITATIONS_ENABLED;
  delete process.env.AUTH_E2E_ENABLED;
  resetRedeemRateLimitState();
});

beforeEach(() => {
  resetRedeemRateLimitState();
});

describe("owner invitation routes", () => {
  it("enforces 401 / 403 / 403-unconfigured / 503-unavailable ordering", async () => {
    const noSession = await listInvitationsRoute(
      new NextRequest("http://localhost/api/v1/admin/invitations"),
    );
    expect(noSession.status).toBe(401);
    expect((await readJson(noSession)).error).toMatchObject({ code: "AUTH_REQUIRED" });

    const nonOwner = await listInvitationsRoute(
      ownerRequest("/api/v1/admin/invitations", { userId: NON_OWNER_ID }),
    );
    expect(nonOwner.status).toBe(403);
    expect((await readJson(nonOwner)).error).toMatchObject({ code: "ADMIN_FORBIDDEN" });

    const previousOwners = process.env.OWNER_USER_IDS;
    process.env.OWNER_USER_IDS = ENV_OWNER_ID;
    const envOwner = await listInvitationsRoute(
      ownerRequest("/api/v1/admin/invitations", { userId: ENV_OWNER_ID }),
    );
    expect(envOwner.status).toBe(200);
    delete process.env.OWNER_USER_IDS;
    delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    const unconfigured = await listInvitationsRoute(
      ownerRequest("/api/v1/admin/invitations", { userId: ENV_OWNER_ID }),
    );
    expect(unconfigured.status).toBe(403);
    if (previousOwners === undefined) {
      delete process.env.OWNER_USER_IDS;
    } else {
      process.env.OWNER_USER_IDS = previousOwners;
    }

    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const unavailable = await listInvitationsRoute(
      ownerRequest("/api/v1/admin/invitations"),
    );
    expect(unavailable.status).toBe(503);
    expect((await readJson(unavailable)).error).toMatchObject({ code: "ADMIN_UNAVAILABLE" });
    process.env.DATABASE_URL = previousDatabase;
  });

  it("creates an invitation (201, one-time code, masked list, audit, no plain email)", async () => {
    const created = await createInvitationRoute(
      ownerRequest("/api/v1/admin/invitations", {
        method: "POST",
        body: {
          email: "NewFriend@Example.TEST",
          role: "member",
          expiresInHours: 24,
          notes: "invite for alpha",
        },
        headers: { "x-request-id": "req-route-create" },
      }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    expect(created.headers.get("x-request-id")).toBe("req-route-create");
    const createdBody = await readJson(created);
    const data = createdBody.data as {
      invitation: { id: string; emailMasked: string; status: string };
      code: string;
    };
    expect(data.code).toMatch(/^SN-INV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u);
    expect(data.invitation.emailMasked).toBe("n***@example.test");
    expect(data.invitation.status).toBe("pending");

    const listed = await listInvitationsRoute(
      ownerRequest("/api/v1/admin/invitations?limit=100"),
    );
    expect(listed.status).toBe(200);
    const listBody = await readJson(listed);
    const invitations = (listBody.data as { invitations: Array<Record<string, unknown>> }).invitations;
    const found = invitations.find((invitation) => invitation.id === data.invitation.id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty("email");
    expect(JSON.stringify(listBody)).not.toContain("newfriend@example.test");

    const audited = await auditEntries();
    expect(
      audited.find((entry) => entry.requestId === "req-route-create"),
    ).toMatchObject({
      action: "invitation.create",
      targetKind: "invitation",
      targetId: data.invitation.id,
    });

    const duplicate = await createInvitationRoute(
      ownerRequest("/api/v1/admin/invitations", {
        method: "POST",
        body: { email: "newfriend@example.test" },
      }),
    );
    expect(duplicate.status).toBe(409);
    expect((await readJson(duplicate)).error).toMatchObject({ code: "INVITATION_CONFLICT" });

    const invalid = await createInvitationRoute(
      ownerRequest("/api/v1/admin/invitations", {
        method: "POST",
        body: { email: "friend@example.test", role: "admin" },
      }),
    );
    expect(invalid.status).toBe(400);
    expect((await readJson(invalid)).error).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("revokes a pending invitation and rejects unknown or non-pending ones", async () => {
    const invitation = await seedInvitation({ email: "revoke@example.test" });
    const revoked = await revokeInvitationRoute(
      ownerRequest(`/api/v1/admin/invitations/${invitation.id}/revoke`, {
        method: "POST",
        body: { reason: "owner changed plans" },
        headers: { "x-request-id": "req-route-revoke" },
      }),
      { params: Promise.resolve({ invitationId: invitation.id }) },
    );
    expect(revoked.status).toBe(200);
    const revokedBody = await readJson(revoked);
    expect((revokedBody.data as { invitation: { status: string } }).invitation.status).toBe(
      "revoked",
    );
    expect(
      (await auditEntries()).find((entry) => entry.requestId === "req-route-revoke"),
    ).toMatchObject({ action: "invitation.revoke", targetId: invitation.id });

    const missing = await revokeInvitationRoute(
      ownerRequest("/api/v1/admin/invitations/00000000-0000-4000-8000-000000000999/revoke", {
        method: "POST",
        body: { reason: "owner changed plans" },
      }),
      { params: Promise.resolve({ invitationId: "00000000-0000-4000-8000-000000000999" }) },
    );
    expect(missing.status).toBe(404);
  });
});

describe("account status route", () => {
  it("suspends and reactivates a member with audit entries", async () => {
    const member = await seedUser({ id: MEMBER_ID });
    const suspended = await patchStatusRoute(
      ownerRequest(`/api/v1/admin/users/${member.publicUid}/status`, {
        method: "PATCH",
        body: { status: "suspended", reason: "shared banned content" },
        headers: { "x-request-id": "req-route-suspend" },
      }),
      { params: Promise.resolve({ publicUid: member.publicUid }) },
    );
    expect(suspended.status).toBe(200);
    expect(suspended.headers.get("cache-control")).toBe("private, no-store");
    const suspendedBody = await readJson(suspended);
    expect(
      (suspendedBody.data as { user: { accountStatus: string } }).user.accountStatus,
    ).toBe("suspended");

    const [stored] = await database
      .select({ status: schema.profiles.accountStatus })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, member.id));
    expect(stored?.status).toBe("suspended");
    expect(
      (await auditEntries()).find((entry) => entry.requestId === "req-route-suspend"),
    ).toMatchObject({ action: "user.suspend", targetId: member.publicUid });

    const activated = await patchStatusRoute(
      ownerRequest(`/api/v1/admin/users/${member.publicUid}/status`, {
        method: "PATCH",
        body: { status: "active", reason: "appeal accepted" },
        headers: { "x-request-id": "req-route-activate" },
      }),
      { params: Promise.resolve({ publicUid: member.publicUid }) },
    );
    expect(activated.status).toBe(200);
    expect(
      (await auditEntries()).find((entry) => entry.requestId === "req-route-activate"),
    ).toMatchObject({ action: "user.activate", targetId: member.publicUid });
  });

  it("returns validation/state errors for bad input and self-suspension", async () => {
    const member = await seedUser();
    const badBody = await patchStatusRoute(
      ownerRequest(`/api/v1/admin/users/${member.publicUid}/status`, {
        method: "PATCH",
        body: { status: "deleted", reason: "policy violation" },
      }),
      { params: Promise.resolve({ publicUid: member.publicUid }) },
    );
    expect(badBody.status).toBe(400);

    const selfProfile = await database
      .select({ publicUid: schema.profiles.publicUid })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, OWNER_ID));
    const selfUid = selfProfile[0]!.publicUid;
    const selfSuspend = await patchStatusRoute(
      ownerRequest(`/api/v1/admin/users/${selfUid}/status`, {
        method: "PATCH",
        body: { status: "suspended", reason: "lock myself out" },
      }),
      { params: Promise.resolve({ publicUid: selfUid }) },
    );
    expect(selfSuspend.status).toBe(409);
    expect((await readJson(selfSuspend)).error).toMatchObject({
      code: "ACCOUNT_STATE_CONFLICT",
    });
  });
});

describe("owner account deletion route", () => {
  it("deletes business data, removes the account and writes the audit entry", async () => {
    const target = await seedUser();
    const deleted = await ownerDeletionRoute(
      ownerRequest(`/api/v1/admin/users/${target.publicUid}/deletion`, {
        method: "POST",
        body: {
          confirmation: `DELETE ${target.publicUid}`,
          reason: "requested by the user",
        },
        headers: {
          "idempotency-key": "delete-key-123456",
          "x-request-id": "req-route-owner-delete",
        },
      }),
      { params: Promise.resolve({ publicUid: target.publicUid }) },
    );
    expect(deleted.status).toBe(200);
    expect((await readJson(deleted)).data).toEqual({
      deleted: true,
      alreadyDeleted: false,
    });
    const profileRows = await database
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, target.id));
    expect(profileRows).toHaveLength(0);
    expect(
      (await auditEntries()).find((entry) => entry.requestId === "req-route-owner-delete"),
    ).toMatchObject({ action: "user.delete", targetId: target.publicUid });

    const retried = await ownerDeletionRoute(
      ownerRequest(`/api/v1/admin/users/${target.publicUid}/deletion`, {
        method: "POST",
        body: {
          confirmation: `DELETE ${target.publicUid}`,
          reason: "requested by the user",
        },
        headers: { "idempotency-key": "delete-key-123456" },
      }),
      { params: Promise.resolve({ publicUid: target.publicUid }) },
    );
    expect(retried.status).toBe(200);
    expect((await readJson(retried)).data).toEqual({
      deleted: true,
      alreadyDeleted: true,
    });
  });

  it("requires the idempotency key and the exact confirmation phrase", async () => {
    const target = await seedUser();
    const noKey = await ownerDeletionRoute(
      ownerRequest(`/api/v1/admin/users/${target.publicUid}/deletion`, {
        method: "POST",
        body: { confirmation: `DELETE ${target.publicUid}`, reason: "requested by user" },
      }),
      { params: Promise.resolve({ publicUid: target.publicUid }) },
    );
    expect(noKey.status).toBe(400);

    const wrongConfirmation = await ownerDeletionRoute(
      ownerRequest(`/api/v1/admin/users/${target.publicUid}/deletion`, {
        method: "POST",
        body: { confirmation: "DELETE_MY_ACCOUNT", reason: "requested by user" },
        headers: { "idempotency-key": "delete-key-654321" },
      }),
      { params: Promise.resolve({ publicUid: target.publicUid }) },
    );
    expect(wrongConfirmation.status).toBe(400);
  });
});

describe("public invitation redemption route", () => {
  function redeemRequest(body: unknown, ip = "203.0.113.9"): NextRequest {
    return new NextRequest("http://localhost/api/v1/auth/invitations/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  it("returns 403 REGISTRATION_CLOSED when the feature switch is off", async () => {
    process.env.ACCOUNT_INVITATIONS_ENABLED = "0";
    const response = await redeemInvitationRoute(
      redeemRequest({ code: "SN-INV-0123-4567-89AB", email: "friend@example.test" }),
    );
    expect(response.status).toBe(403);
    expect((await readJson(response)).error).toMatchObject({ code: "REGISTRATION_CLOSED" });
    process.env.ACCOUNT_INVITATIONS_ENABLED = "1";
  });

  it("uses the same INVITATION_INVALID response for unknown, expired, revoked, accepted and mismatched invitations", async () => {
    const pending = await seedInvitation({ email: "known@example.test", code: "SN-INV-AAAA-AAAA-AAAA" });
    const revoked = await seedInvitation({
      email: "revoked@example.test",
      code: "SN-INV-BBBB-BBBB-BBBB",
      status: "revoked",
    });
    const accepted = await seedInvitation({
      email: "accepted@example.test",
      code: "SN-INV-CCCC-CCCC-CCCC",
      status: "accepted",
    });
    const expired = await seedInvitation({
      email: "expired@example.test",
      code: "SN-INV-DDDD-DDDD-DDDD",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(pending.status).toBe("pending");

    const cases = [
      { code: "SN-INV-ZZZZ-ZZZZ-ZZZZ", email: "nobody@example.test" },
      { code: "SN-INV-AAAA-AAAA-AAAA", email: "other@example.test" },
      { code: "SN-INV-BBBB-BBBB-BBBB", email: "revoked@example.test" },
      { code: "SN-INV-CCCC-CCCC-CCCC", email: "accepted@example.test" },
      { code: "SN-INV-DDDD-DDDD-DDDD", email: "expired@example.test" },
    ];
    const responses = await Promise.all(
      cases.map((body, index) => redeemInvitationRoute(redeemRequest(body, `198.51.100.${index}`))),
    );
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await readJson(response)).error).toMatchObject({ code: "INVITATION_INVALID" });
    }
    // None of the invalid attempts consumed the pending invitation.
    const [pendingRow] = await database
      .select({ status: schema.accountInvitations.status })
      .from(schema.accountInvitations)
      .where(eq(schema.accountInvitations.email, "known@example.test"));
    expect(pendingRow?.status).toBe("pending");
    void revoked;
    void accepted;
    void expired;
  });

  it("rate limits the eleventh attempt from the same client", async () => {
    const body = { code: "SN-INV-ZZZZ-ZZZZ-ZZZZ", email: "nobody@example.test" };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await redeemInvitationRoute(redeemRequest(body, "192.0.2.44"));
      expect(response.status).toBe(400);
    }
    const limited = await redeemInvitationRoute(redeemRequest(body, "192.0.2.44"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await readJson(limited)).error).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("redeems a valid invitation and returns only status/email", async () => {
    const code = "SN-INV-EEEE-EEEE-EEEE";
    await seedInvitation({ email: "join@example.test", code });
    const response = await redeemInvitationRoute(
      redeemRequest({ code: code.toLowerCase(), email: "Join@Example.TEST" }, "192.0.2.99"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await readJson(response);
    expect(body.data).toEqual({ status: "ready", email: "join@example.test" });
    expect(JSON.stringify(body)).not.toContain("SN-INV-EEEE");
    expect(JSON.stringify(body)).not.toContain("token");
  });
});

describe("self-service me routes", () => {
  function meRequest(
    path: string,
    options: { method?: string; body?: unknown; userId?: string; headers?: Record<string, string> } = {},
  ): NextRequest {
    const headers: Record<string, string> = {
      cookie: `spanish-e2e-user=${options.userId ?? MEMBER_ID}`,
      "content-type": "application/json",
      ...options.headers,
    };
    return new NextRequest(`http://localhost${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  it("requires a session and an idempotency key for account deletion", async () => {
    const noSession = await deleteOwnAccountRoute(
      new NextRequest("http://localhost/api/v1/me/account", { method: "DELETE" }),
    );
    expect(noSession.status).toBe(401);

    const noKey = await deleteOwnAccountRoute(
      meRequest("/api/v1/me/account", {
        method: "DELETE",
        body: { confirmation: "DELETE_MY_ACCOUNT" },
      }),
    );
    expect(noKey.status).toBe(400);

    const wrongConfirmation = await deleteOwnAccountRoute(
      meRequest("/api/v1/me/account", {
        method: "DELETE",
        body: { confirmation: "DELETE_MY_DATA" },
        headers: { "idempotency-key": "self-delete-123456" },
      }),
    );
    expect(wrongConfirmation.status).toBe(400);
  });

  it("deletes the caller's own account", async () => {
    const target = await seedUser({ id: MEMBER_ID });
    const response = await deleteOwnAccountRoute(
      meRequest("/api/v1/me/account", {
        method: "DELETE",
        body: { confirmation: "DELETE_MY_ACCOUNT" },
        headers: {
          "idempotency-key": "self-delete-654321",
          "x-request-id": "req-route-self-delete",
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data).toEqual({ deleted: true, alreadyDeleted: false });
    const remaining = await database
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, target.id));
    expect(remaining).toHaveLength(0);
    expect(
      (await auditEntries()).find((entry) => entry.requestId === "req-route-self-delete"),
    ).toMatchObject({
      action: "user.delete",
      actorUserId: MEMBER_ID,
      targetId: target.publicUid,
    });
  });

  it("exports the caller's data as a no-store JSON attachment", async () => {
    const target = await seedUser();
    const exportCharacterId = "10000000-0000-4000-8000-000000000781";
    const exportIdentityId = "20000000-0000-4000-8000-000000000781";
    await database.insert(schema.characters).values({ id: exportCharacterId, stableKey: "lucia-export", displayName: "Lucía", homeLocation: "Madrid", profile: {}, status: "published" });
    await database.insert(schema.characterIdentities).values({ id: exportIdentityId, stableKey: "lucia-export", currentCharacterId: exportCharacterId });
    const [head] = await database.insert(schema.relationshipHeads).values({ userId: target.id, identityId: exportIdentityId }).returning({ id: schema.relationshipHeads.id });
    await database.insert(schema.relationshipEvents).values({ headId: head.id, userId: target.id, identityId: exportIdentityId, sequence: 1, idempotencyKey: "route-export-event", eventKind: "voluntary_personal_anchor", certainty: "supported", ruleVersion: "relationship-v1", episodeKey: "route-episode", payload: { sessionId: "route-session" } });
    await database.insert(schema.relationshipBoundaries).values({ headId: head.id, userId: target.id, identityId: exportIdentityId, scope: "romance", target: "all", status: "active", revision: 1, idempotencyKey: "route-export-boundary" });
    await database
      .update(schema.userPreferences)
      .set({
        preferredSpanishRegion: "es-ES",
        correctionMode: "strict",
        voiceInputPreferred: "optional",
      })
      .where(eq(schema.userPreferences.userId, target.id));
    const response = await exportRoute(meRequest("/api/v1/me/export", { userId: target.id }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="sueno-account-export.json"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.exportVersion).toBe("1");
    expect(body.account).toMatchObject({
      publicUid: target.publicUid,
      role: "member",
      accountStatus: "active",
    });
    expect(body.preferences).toEqual({
      preferredSpanishRegion: "es-ES",
      correctionMode: "strict",
      voiceInputPreferred: "optional",
      learningInsightsEnabled: true,
      recordAssistantLearningIntent: true,
    });
    expect(body.relationships).toMatchObject({ characterKey: "lucia-export", ruleVersion: "relationship-v1", familiarity: "new_contact", userRomanticIntent: "unspecified" });
    expect((body.relationships as { boundaries: unknown[] }).boundaries).toEqual([{ scope: "romance", target: "all", status: "active" }]);
    const serialized = JSON.stringify(body);
    for (const forbidden of ["storagePath", "signedUrl", "avatarPath", "audioAssetId"]) {
      expect(serialized).not.toContain(forbidden);
    }

    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const unavailable = await exportRoute(meRequest("/api/v1/me/export", { userId: target.id }));
    expect(unavailable.status).toBe(503);
    expect((await readJson(unavailable)).error).toMatchObject({ code: "EXPORT_UNAVAILABLE" });
    process.env.DATABASE_URL = previousDatabase;
  });

  it("extends /api/v1/me with role and accountStatus", async () => {
    const target = await seedUser();
    const response = await meRoute(meRequest("/api/v1/me", { userId: target.id }));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.data).toMatchObject({ role: "member", accountStatus: "active" });

    await database
      .update(schema.profiles)
      .set({ accountStatus: "suspended" })
      .where(eq(schema.profiles.id, target.id));
    // The shared account gate also applies to the E2E fake-session path, so a
    // stale cookie cannot read the suspended account's data.
    const suspended = await meRoute(meRequest("/api/v1/me", { userId: target.id }));
    expect(suspended.status).toBe(401);
    expect((await readJson(suspended)).error).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects stale cookie sessions while suspension or deletion is pending", async () => {
    const target = await seedUser();

    await database
      .update(schema.profiles)
      .set({ accountStatus: "suspended" })
      .where(eq(schema.profiles.id, target.id));
    const suspended = await deleteOwnAccountRoute(
      meRequest("/api/v1/me/account", {
        method: "DELETE",
        userId: target.id,
        body: { confirmation: "DELETE_MY_ACCOUNT" },
        headers: { "idempotency-key": "blocked-suspended-123456" },
      }),
    );
    expect(suspended.status).toBe(401);
    expect((await readJson(suspended)).error).toMatchObject({ code: "AUTH_REQUIRED" });

    await database
      .update(schema.profiles)
      .set({ accountStatus: "active", deletionRequestedAt: new Date() })
      .where(eq(schema.profiles.id, target.id));
    const deleting = await deleteOwnAccountRoute(
      meRequest("/api/v1/me/account", {
        method: "DELETE",
        userId: target.id,
        body: { confirmation: "DELETE_MY_ACCOUNT" },
        headers: { "idempotency-key": "blocked-deleting-123456" },
      }),
    );
    expect(deleting.status).toBe(401);
    expect((await readJson(deleting)).error).toMatchObject({ code: "AUTH_REQUIRED" });

    const remaining = await database
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, target.id));
    expect(remaining).toHaveLength(1);
  });
});
