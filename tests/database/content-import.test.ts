// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ContentImportConflictError,
  importContentBundle,
} from "@/src/modules/content/import";
import * as schema from "@/src/shared/db/schema";

const fixturePath = path.join(
  process.cwd(),
  "contracts",
  "fixtures",
  "content",
  "v1",
  "content-bundle-valid.json",
);

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

async function createTestDatabase() {
  const client = new PGlite();
  await client.exec(`
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
    "0002_content_import_registry.sql",
  ]) {
    await client.exec(await migration(name));
  }
  return { client, database: drizzle(client, { schema }) };
}

async function readFixture() {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<
    string,
    unknown
  >;
}

function setLearningContentStatus(
  fixture: Record<string, unknown>,
  status: "draft" | "published",
) {
  for (const domain of fixture.domains as Array<Record<string, unknown>>) {
    domain.status = status;
  }
  for (const goal of fixture.goals as Array<Record<string, unknown>>) {
    goal.status = status;
  }
  for (const expression of fixture.expressions as Array<Record<string, unknown>>) {
    expression.status = status;
    for (const variant of expression.variants as Array<Record<string, unknown>>) {
      variant.status = status;
    }
    if (status === "draft") delete expression.publishedAt;
  }
  for (const scenario of fixture.scenarios as Array<Record<string, unknown>>) {
    scenario.status = status;
  }
  for (const pack of fixture.contentPacks as Array<Record<string, unknown>>) {
    pack.status = status;
    if (status === "draft") delete pack.publishedAt;
  }
}

function removeCharacters(fixture: Record<string, unknown>) {
  fixture.characters = [];
  fixture.reviews = (fixture.reviews as Array<Record<string, unknown>>).filter(
    (review) => review.entityType !== "character",
  );
}

describe("content bundle importer", () => {
  let client: PGlite;
  let database: Awaited<ReturnType<typeof createTestDatabase>>["database"];

  beforeEach(async () => {
    ({ client, database } = await createTestDatabase());
  });

  afterEach(async () => {
    await client.close();
  });

  it("imports a complete bundle and treats an identical retry as unchanged", async () => {
    const fixture = await readFixture();

    await expect(importContentBundle(database, fixture)).resolves.toMatchObject({
      status: "imported",
      bundleKey: "alpha.contract-fixture",
      bundleVersion: 1,
    });
    await expect(importContentBundle(database, fixture)).resolves.toMatchObject({
      status: "unchanged",
    });

    const [expressionCount] = await database
      .select({ value: count() })
      .from(schema.expressions);
    const [importCount] = await database
      .select({ value: count() })
      .from(schema.contentBundleImports);
    expect(expressionCount?.value).toBe(1);
    expect(importCount?.value).toBe(1);
  });

  it("rejects changed content under the same bundle identity", async () => {
    const fixture = await readFixture();
    await importContentBundle(database, fixture);
    const changed = structuredClone(fixture);
    const expressions = changed.expressions as Array<Record<string, unknown>>;
    expressions[0]!.text = "Hola, ¿cómo va?";

    await expect(importContentBundle(database, changed)).rejects.toBeInstanceOf(
      ContentImportConflictError,
    );
  });

  it("serializes concurrent retries behind one bundle claim", async () => {
    const fixture = await readFixture();

    const results = await Promise.all([
      importContentBundle(database, fixture),
      importContentBundle(database, fixture),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "imported",
      "unchanged",
    ]);
    const [importCount] = await database
      .select({ value: count() })
      .from(schema.contentBundleImports);
    expect(importCount?.value).toBe(1);
  });

  it("allows a new bundle and entity version to coexist", async () => {
    const first = await readFixture();
    await importContentBundle(database, first);
    const second = structuredClone(first);
    (second.bundle as Record<string, unknown>).version = 2;
    for (const collection of [
      "expressions",
      "scenarios",
      "contentPacks",
      "characters",
    ]) {
      for (const item of second[collection] as Array<Record<string, unknown>>) {
        item.version = 2;
      }
    }
    for (const review of second.reviews as Array<Record<string, unknown>>) {
      if (review.version !== undefined) review.version = 2;
    }

    await expect(importContentBundle(database, second)).resolves.toMatchObject({
      status: "imported",
      bundleVersion: 2,
    });

    const [expressionCount] = await database
      .select({ value: count() })
      .from(schema.expressions);
    const [importCount] = await database
      .select({ value: count() })
      .from(schema.contentBundleImports);
    expect(expressionCount?.value).toBe(2);
    expect(importCount?.value).toBe(2);
  });

  it("advances existing content statuses when immutable fields match", async () => {
    const draft = await readFixture();
    removeCharacters(draft);
    setLearningContentStatus(draft, "draft");
    await importContentBundle(database, draft);

    const published = await readFixture();
    removeCharacters(published);
    (published.bundle as Record<string, unknown>).version = 2;
    await expect(importContentBundle(database, published)).resolves.toMatchObject({
      status: "imported",
      bundleVersion: 2,
    });

    const [domain] = await database
      .select({ status: schema.communicationDomains.status })
      .from(schema.communicationDomains);
    const [goal] = await database
      .select({ status: schema.learningGoals.status })
      .from(schema.learningGoals);
    const [expression] = await database
      .select({ status: schema.expressions.status })
      .from(schema.expressions);
    const [scenario] = await database
      .select({ status: schema.scenarios.status })
      .from(schema.scenarios);
    const [pack] = await database
      .select({ status: schema.contentPacks.status })
      .from(schema.contentPacks);

    expect({ domain, goal, expression, scenario, pack }).toEqual({
      domain: { status: "published" },
      goal: { status: "published" },
      expression: { status: "published" },
      scenario: { status: "published" },
      pack: { status: "published" },
    });
  });

  it("rolls back status advances when a later update fails", async () => {
    const draft = await readFixture();
    removeCharacters(draft);
    setLearningContentStatus(draft, "draft");
    await importContentBundle(database, draft);

    await client.exec(`
      create function fail_expression_status_update()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'forced expression update failure';
      end;
      $$;
      create trigger fail_expression_status_update_trigger
        before update on expressions
        for each row execute function fail_expression_status_update();
    `);

    const published = await readFixture();
    removeCharacters(published);
    (published.bundle as Record<string, unknown>).version = 2;
    await expect(importContentBundle(database, published)).rejects.toThrow();

    const [domain] = await database
      .select({ status: schema.communicationDomains.status })
      .from(schema.communicationDomains);
    const [goal] = await database
      .select({ status: schema.learningGoals.status })
      .from(schema.learningGoals);
    const [importCount] = await database
      .select({ value: count() })
      .from(schema.contentBundleImports);

    expect(domain?.status).toBe("draft");
    expect(goal?.status).toBe("draft");
    expect(importCount?.value).toBe(1);
  });

  it("rejects attempts to downgrade an existing content status", async () => {
    await importContentBundle(database, await readFixture());
    const draft = await readFixture();
    (draft.bundle as Record<string, unknown>).version = 2;
    setLearningContentStatus(draft, "draft");

    await expect(importContentBundle(database, draft)).rejects.toBeInstanceOf(
      ContentImportConflictError,
    );
  });

  it("rejects immutable field changes disguised as a status advance", async () => {
    const draft = await readFixture();
    setLearningContentStatus(draft, "draft");
    await importContentBundle(database, draft);

    const changed = await readFixture();
    (changed.bundle as Record<string, unknown>).version = 2;
    (changed.domains as Array<Record<string, unknown>>)[0]!.title = {
      "zh-CN": "被改写的领域",
      "es-ES": "Dominio modificado",
    };

    await expect(importContentBundle(database, changed)).rejects.toBeInstanceOf(
      ContentImportConflictError,
    );
  });

  it("rolls back reference rows when a later write fails", async () => {
    await client.exec(`
      create function fail_expression_import()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'forced expression failure';
      end;
      $$;
      create trigger fail_expression_import_trigger
        before insert on expressions
        for each row execute function fail_expression_import();
    `);

    await expect(
      importContentBundle(database, await readFixture()),
    ).rejects.toThrow();

    for (const table of [
      schema.communicationDomains,
      schema.learningGoals,
      schema.tags,
      schema.contentBundleImports,
    ]) {
      const [result] = await database.select({ value: count() }).from(table);
      expect(result?.value).toBe(0);
    }
  });
});
