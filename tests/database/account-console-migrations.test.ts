// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ownerId = "00000000-0000-4000-8000-000000000001";

async function readMigration(name: string): Promise<string> {
  return (
    await readFile(path.join(process.cwd(), "drizzle", name), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

async function createMigratedDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
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
    await database.exec(await readMigration(name));
  }
  return database;
}

describe("account access and admin console migrations (0048/0049)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createMigratedDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  it("backfills existing profiles as active members and enforces role/status checks", async () => {
    await database.exec(
      `insert into auth.users (id, email) values ('${ownerId}', 'owner@example.test')`,
    );
    const profile = await database.query<{
      role: string;
      account_status: string;
      deletion_requested_at: Date | null;
    }>(
      `select role, account_status, deletion_requested_at from profiles where id = '${ownerId}'`,
    );
    expect(profile.rows).toEqual([
      { role: "member", account_status: "active", deletion_requested_at: null },
    ]);

    await expect(
      database.exec(
        `update profiles set role = 'admin' where id = '${ownerId}'`,
      ),
    ).rejects.toThrow(/profiles_role_check/u);
    await expect(
      database.exec(
        `update profiles set account_status = 'deleted' where id = '${ownerId}'`,
      ),
    ).rejects.toThrow(/profiles_account_status_check/u);
  });

  it("keeps invitations and the audit log server-only", async () => {
    const state = await database.query<{
      invitations_rls: boolean;
      audit_rls: boolean;
    }>(`
      select
        (select rowsecurity from pg_tables where schemaname='public' and tablename='account_invitations') as invitations_rls,
        (select rowsecurity from pg_tables where schemaname='public' and tablename='admin_audit_log') as audit_rls
    `);
    expect(state.rows[0]).toEqual({ invitations_rls: true, audit_rls: true });

    for (const table of ["account_invitations", "admin_audit_log"] as const) {
      for (const privilege of ["select", "insert", "update", "delete"] as const) {
        const result = await database.query<{ allowed: boolean }>(
          `select has_table_privilege('anon', '${table}', '${privilege}') as allowed`,
        );
        expect(result.rows[0]?.allowed, `anon ${privilege} ${table}`).toBe(false);
        const authenticated = await database.query<{ allowed: boolean }>(
          `select has_table_privilege('authenticated', '${table}', '${privilege}') as allowed`,
        );
        expect(
          authenticated.rows[0]?.allowed,
          `authenticated ${privilege} ${table}`,
        ).toBe(false);
      }
    }
  });

  it("allows only one pending or redeeming invitation per email", async () => {
    await database.exec(
      `insert into auth.users (id, email) values ('${ownerId}', 'owner@example.test')`,
    );
    await database.exec(`
      insert into account_invitations (email, token_hash, invited_by_user_id, expires_at)
      values ('friend@example.test', '${"a".repeat(64)}', '${ownerId}', now() + interval '7 days')
    `);
    await expect(
      database.exec(`
        insert into account_invitations (email, token_hash, invited_by_user_id, expires_at)
        values ('friend@example.test', '${"b".repeat(64)}', '${ownerId}', now() + interval '7 days')
      `),
    ).rejects.toThrow(/account_invitations_pending_email_uidx/u);
    await expect(
      database.exec(`
        insert into account_invitations (email, token_hash, invited_by_user_id, expires_at)
        values ('Friend@Example.test', '${"d".repeat(64)}', '${ownerId}', now() + interval '7 days')
      `),
    ).rejects.toThrow(/account_invitations_email_check/u);

    await database.exec(
      `update account_invitations set status='revoked', revoked_at=now() where email='friend@example.test'`,
    );
    await database.exec(`
      insert into account_invitations (email, token_hash, invited_by_user_id, expires_at)
      values ('friend@example.test', '${"c".repeat(64)}', '${ownerId}', now() + interval '7 days')
    `);
  });

  it("requires consistent accepted/failure/revoked fields on invitations", async () => {
    await database.exec(
      `insert into auth.users (id, email) values ('${ownerId}', 'owner@example.test')`,
    );
    await database.exec(`
      insert into account_invitations (email, token_hash, invited_by_user_id, expires_at)
      values ('friend@example.test', '${"a".repeat(64)}', '${ownerId}', now() + interval '7 days')
    `);
    await expect(
      database.exec(
        `update account_invitations set status='accepted' where email='friend@example.test'`,
      ),
    ).rejects.toThrow(/account_invitations_accepted_fields_check/u);
    await expect(
      database.exec(
        `update account_invitations set status='revoked' where email='friend@example.test'`,
      ),
    ).rejects.toThrow(/account_invitations_revoked_at_check/u);
    await expect(
      database.exec(
        `update account_invitations set status='failed' where email='friend@example.test'`,
      ),
    ).rejects.toThrow(/account_invitations_failure_fields_check/u);
  });

  it("makes the audit log append-only at the database layer", async () => {
    await database.exec(`
      insert into admin_audit_log (actor_user_id, action, target_kind, target_id, reason)
      values ('${ownerId}', 'user.suspend', 'user', '${ownerId}', 'test reason')
    `);
    await expect(
      database.exec(
        `update admin_audit_log set reason='rewritten' where actor_user_id='${ownerId}'`,
      ),
    ).rejects.toThrow(/admin_audit_log_append_only/u);
    await expect(
      database.exec(
        `delete from admin_audit_log where actor_user_id='${ownerId}'`,
      ),
    ).rejects.toThrow(/admin_audit_log_append_only/u);
    await expect(database.exec(`truncate admin_audit_log`)).rejects.toThrow(
      /admin_audit_log_append_only/u,
    );
    await expect(
      database.exec(`
        insert into admin_audit_log (actor_user_id, action, target_kind, target_id)
        values ('${ownerId}', 'user.explode', 'user', '${ownerId}')
      `),
    ).rejects.toThrow(/admin_audit_log_action_check/u);
  });
});
