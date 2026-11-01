// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleAccountAdminRepository,
  deleteAccountAsOwner,
  deleteOwnAccount,
} from "@/src/modules/account";
import type { AccountProvisioner } from "@/src/modules/account";
import {
  createDrizzleAdminAuditRepository,
} from "@/src/modules/admin";
import {
  createDrizzlePrivacyRepository,
  type StorageObjectDeleter,
} from "@/src/modules/privacy";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

/**
 * PGlite coverage for the shared account-deletion orchestration
 * (ACCT-ADMIN-001): marker ordering, data clearing, retryable partial failure
 * and the single `user.delete` audit entry. The Supabase Admin provisioner and
 * Storage deleter are in-memory fakes — no real provider is called.
 */
const ownerId = "00000000-0000-4000-8000-000000000611";
const memberId = "00000000-0000-4000-8000-000000000612";
const attemptId = "30000000-0000-4000-8000-000000000611";
const sessionId = "20000000-0000-4000-8000-000000000611";
const audioId = "60000000-0000-4000-8000-000000000611";

async function readMigration(name: string): Promise<string> {
  return (
    await readFile(path.join(process.cwd(), "drizzle", name), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let memberPublicUid = "";
let deletedUserIds: string[] = [];
let failingDeletions = 0;

const storageDeleter: StorageObjectDeleter = {
  async delete() {
    return { deferred: false };
  },
};

const provisioner: AccountProvisioner = {
  async createConfirmedUser() {
    throw new Error("not used");
  },
  async deleteUser(userId) {
    if (failingDeletions > 0) {
      failingDeletions -= 1;
      throw new Error("fake-provisioning-failed");
    }
    deletedUserIds.push(userId);
  },
  async banUser() {},
  async unbanUser() {},
};

function accountRepository() {
  return createDrizzleAccountAdminRepository(database as unknown as Database);
}

function privacyRepository() {
  return createDrizzlePrivacyRepository(database as unknown as Database);
}

function auditRepository() {
  return createDrizzleAdminAuditRepository(database as unknown as Database);
}

function deletionDeps() {
  return {
    repository: accountRepository(),
    auditRepository: auditRepository(),
    privacyRepository: privacyRepository(),
    storageDeleter,
    provisioner,
  };
}

beforeEach(async () => {
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
    "0002_content_import_registry.sql",
    "0003_chunky_black_knight.sql",
    "0004_calm_iron_monger.sql",
    "0005_kind_character_network.sql",
    "0006_opposite_centennial.sql",
    "0007_spicy_talkback.sql",
    "0008_broad_chronomancer.sql",
    "0009_oval_namora.sql",
    "0010_watery_ogun.sql",
    "0011_early_colleen_wing.sql",
    "0012_wakeful_spiral.sql",
    "0013_smart_stick.sql",
    "0014_parallel_liz_osborn.sql",
    "0015_flaky_havok.sql",
    "0016_proactive_messages.sql",
    "0017_sudden_betty_brant.sql",
    "0018_dusty_sue_storm.sql",
    "0040_happy_wolverine.sql",
    "0045_lumpy_medusa.sql",
    "0048_account_access_and_admin_console.sql",
    "0050_parched_nextwave.sql",
    "0051_learning_insight_reports.sql",
    "0052_user_vocabulary_marks.sql",
    "0053_vocabulary_mark_import_boundary.sql",
    "0054_vocabulary_recall_progress.sql",
  ]) {
    await client.exec(await readMigration(name));
  }
  database = drizzle(client, { schema });
  await client.exec(`
    insert into auth.users (id, email) values
      ('${ownerId}', 'owner-delete@example.test'),
      ('${memberId}', 'member-delete@example.test');
    update profiles set role = 'owner' where id = '${ownerId}';
  `);
  const [memberProfile] = await database
    .select({ publicUid: schema.profiles.publicUid })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, memberId));
  memberPublicUid = memberProfile!.publicUid;
  deletedUserIds = [];
  failingDeletions = 0;

  await database.insert(schema.practiceSessions).values({
    id: sessionId,
    userId: memberId,
    primaryModality: "speech",
    contentVersion: 1,
  });
  await database.insert(schema.practiceAttempts).values({
    id: attemptId,
    userId: memberId,
    sessionId,
    clientAttemptId: "account-deletion-attempt",
    modality: "speech",
    responseText: "Tengo una reserva.",
    contentVersion: 1,
    algorithmVersion: "training-v1",
  });
  await database.insert(schema.audioAssets).values({
    id: audioId,
    userId: memberId,
    storageBucket: "milestones",
    storagePath: "member/milestone.webm",
    purpose: "milestone",
    mimeType: "audio/webm",
    sizeBytes: 100,
    retentionPolicy: "milestone",
  });
  await database.insert(schema.providerCalls).values({
    userId: memberId,
    providerType: "stt",
    provider: "fake",
    metadata: { requestId: "private-request" },
  });
  await database.insert(schema.evidenceEvents).values({
    userId: memberId,
    practiceAttemptId: attemptId,
    idempotencyKey: "account-deletion-evidence",
    sourceType: "test",
    sourceReference: {},
    skillKey: "task.start",
    modality: "speech",
    outcomeScore: 0.8,
    evidenceWeight: 0.7,
    confidence: 0.8,
    contentVersion: 1,
    algorithmVersion: "evidence-v1",
  });
});

afterEach(async () => {
  await client.close();
});

describe("owner account deletion orchestration (PGlite)", () => {
  it("clears business data, removes the account, reserves the UID and audits once", async () => {
    const result = await deleteAccountAsOwner(deletionDeps(), {
      ownerId,
      requestId: "req-delete-1",
      publicUid: memberPublicUid,
      confirmation: `DELETE ${memberPublicUid}`,
      reason: "requested by the user",
    });
    expect(result).toEqual({ deleted: true, alreadyDeleted: false });
    expect(deletedUserIds).toEqual([memberId]);

    const profiles = await database
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, memberId));
    expect(profiles).toHaveLength(0);
    const evidence = await database
      .select({ id: schema.evidenceEvents.id })
      .from(schema.evidenceEvents)
      .where(eq(schema.evidenceEvents.userId, memberId));
    expect(evidence).toHaveLength(0);
    const [providerCall] = await database
      .select()
      .from(schema.providerCalls)
      .where(eq(schema.providerCalls.provider, "fake"));
    expect(providerCall).toMatchObject({ userId: null, metadata: { anonymized: true } });
    const cleanup = await database
      .select()
      .from(schema.privacyCleanupTasks)
      .where(eq(schema.privacyCleanupTasks.storagePath, "member/milestone.webm"));
    expect(cleanup).toEqual([expect.objectContaining({ status: "completed" })]);
    const reserved = await database
      .select()
      .from(schema.reservedPublicUids)
      .where(eq(schema.reservedPublicUids.publicUid, memberPublicUid));
    expect(reserved).toHaveLength(1);

    const audit = await auditRepository().list({ limit: 10 });
    expect(audit).toEqual([
      expect.objectContaining({
        actorUserId: ownerId,
        action: "user.delete",
        targetKind: "user",
        targetId: memberPublicUid,
        reason: "requested by the user",
        requestId: "req-delete-1",
      }),
    ]);

    // Idempotent retry: the public UID is reserved, so the second attempt is a
    // success without a second audit row.
    await expect(
      deleteAccountAsOwner(deletionDeps(), {
        ownerId,
        requestId: "req-delete-2",
        publicUid: memberPublicUid,
        confirmation: `DELETE ${memberPublicUid}`,
        reason: "requested by the user",
      }),
    ).resolves.toEqual({ deleted: true, alreadyDeleted: true });
    expect(await auditRepository().list({ limit: 10 })).toHaveLength(1);
  });

  it("keeps the deletion marker and retries after a partial Auth deletion failure", async () => {
    failingDeletions = 1;
    await expect(
      deleteAccountAsOwner(deletionDeps(), {
        ownerId,
        requestId: "req-delete-partial",
        publicUid: memberPublicUid,
        confirmation: `DELETE ${memberPublicUid}`,
        reason: "requested by the user",
      }),
    ).rejects.toMatchObject({
      name: "AccountActionError",
      code: "ACCOUNT_PROVISIONING_FAILED",
      status: 503,
    });

    const [tombstone] = await database
      .select({
        status: schema.profiles.accountStatus,
        deletionRequestedAt: schema.profiles.deletionRequestedAt,
      })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, memberId));
    expect(tombstone).toBeDefined();
    expect(tombstone?.status).toBe("suspended");
    expect(tombstone?.deletionRequestedAt).not.toBeNull();
    expect(await auditRepository().list({ limit: 10 })).toHaveLength(0);
    const evidence = await database
      .select({ id: schema.evidenceEvents.id })
      .from(schema.evidenceEvents)
      .where(eq(schema.evidenceEvents.userId, memberId));
    expect(evidence).toHaveLength(0);

    const retried = await deleteAccountAsOwner(deletionDeps(), {
      ownerId,
      requestId: "req-delete-retry",
      publicUid: memberPublicUid,
      confirmation: `DELETE ${memberPublicUid}`,
      reason: "requested by the user",
    });
    expect(retried).toEqual({ deleted: true, alreadyDeleted: false });
    expect(deletedUserIds).toEqual([memberId]);
    expect(await auditRepository().list({ limit: 10 })).toHaveLength(1);
  });
});

describe("self-service account deletion orchestration (PGlite)", () => {
  it("lets a member delete their own account", async () => {
    const result = await deleteOwnAccount(deletionDeps(), {
      userId: memberId,
      requestId: "req-self-delete",
    });
    expect(result).toEqual({ deleted: true, alreadyDeleted: false });
    expect(deletedUserIds).toEqual([memberId]);
    const audit = await auditRepository().list({ limit: 10 });
    expect(audit).toEqual([
      expect.objectContaining({
        actorUserId: memberId,
        action: "user.delete",
        targetId: memberPublicUid,
      }),
    ]);
  });

  it("returns idempotent success when the profile is already gone", async () => {
    await deleteOwnAccount(deletionDeps(), { userId: memberId, requestId: "req-1" });
    await expect(
      deleteOwnAccount(deletionDeps(), { userId: memberId, requestId: "req-2" }),
    ).resolves.toEqual({ deleted: true, alreadyDeleted: true });
  });
});
