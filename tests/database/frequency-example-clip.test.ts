// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import {
  FREQUENCY_CONTEXT_MAX_CHARS,
  FREQUENCY_EXAMPLE_MARGIN_CHARS,
  FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS,
  clippedFrequencyExample,
  readMaterialisedFormFrequencyRows,
  wantedFormList,
} from "@/src/modules/lexicon-corpus/repositories/corpus-form-frequency";
import { buildFrequencyContext, locateFrequencyExample } from "@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository";
import type { Database } from "@/src/shared/db/client";

/**
 * The example text is clipped **in SQL** on its way out of the database, because
 * a cold shelf read was transferring whole segments — 3.80 MB for the 6,296 rows
 * it reads, of which the page renders about a third — and the read was slow
 * enough to help trip the page's 30 s timeout.
 *
 * Clipping in the query is only acceptable if it is invisible, so that is what
 * this file proves: for every case, the string the shelf renders from the clipped
 * text is byte-identical to the string it renders from the whole segment. Three
 * failure modes in particular, all of which occurred on real rows:
 *
 * 1. **A branch flip.** The display renders the whole context when it fits in 180
 *    characters and clips it otherwise; a window that came back shorter than that
 *    pushed a 185-character segment down the wrong branch and it rendered without
 *    its `…`.
 * 2. **A manufactured token.** Cutting a window at an arbitrary character split
 *    `hermoso` into a leading `oso`, and the display anchored on that invented
 *    token instead of the real occurrence.
 * 3. **A window narrower than the limit** when the form is the last token in the
 *    segment and there is nothing to its right.
 *
 * The last block re-runs the proof over every row the shelf actually reads, when
 * a database is configured; without one it is skipped rather than faked.
 */

const dialect = new PgDialect();

/** Render the shipped clip expression and run it against a list of cases. */
async function clippedRows(cases: readonly (readonly [string, string])[]): Promise<readonly { text: string; word: string; clipped: string }[]> {
  const database = new PGlite();
  try {
    const values = cases.map(([text, word]) => sql`(${text}, ${word})`);
    const fragment = clippedFrequencyExample(sql`c.text`, sql`c.word`);
    const query = dialect.sqlToQuery(sql`
      select c.text, c.word, ${fragment} as clipped
      from (values ${sql.join(values, sql`, `)}) as c(text, word)
    `);
    const result = await database.query<{ text: string; word: string; clipped: string }>(query.sql, query.params as never[]);
    return result.rows;
  } finally {
    await database.close();
  }
}

/** What the shelf renders for a form in a text, or `null` when it cannot. */
function rendered(text: string, word: string): string | null {
  const occurrence = locateFrequencyExample({ title: "", text }, word);
  return occurrence ? buildFrequencyContext(occurrence) : null;
}

async function expectSameRendering(cases: readonly (readonly [string, string])[]): Promise<void> {
  const rows = await clippedRows(cases);
  expect(rows).toHaveLength(cases.length);
  for (const row of rows) {
    const full = rendered(row.text, row.word);
    const clipped = rendered(row.clipped, row.word);
    expect(clipped, `rendering for ${JSON.stringify(row.word)} in ${row.text.length} chars`).toBe(full);
  }
}

describe("the SQL clip renders exactly what the whole segment renders", () => {
  it("keeps the form, the ellipses and the branch on ordinary text", async () => {
    await expectSameRendering([
      ["Casa con parque.", "casa"],
      ["casa", "casa"],
      ["El ser y el servir.", "ser"],
      ["Los años pasan y los anos quedan.", "anos"],
      ["AÑOS.", "anos"],
      ["dijo: «casa», y se fue.", "casa"],
    ]);
  });

  it("does not anchor on a substring that is not a token", async () => {
    // `casa` inside `casamiento` is not a token; the display must return null for
    // both the whole text and the clip, never a context invented from the middle
    // of a word.
    await expectSameRendering([
      ["El casamiento fue largo.", "casa"],
      ["servir no es ser.", "ser"],
      ["palabras sueltas sin la forma.", "casa"],
    ]);
    expect(rendered("El casamiento fue largo.", "casa")).toBeNull();
  });

  it("survives a form at the very start, the very end, and repeated", async () => {
    await expectSameRendering([
      ["casa al final de un texto bastante largo que sigue y sigue sin parar nunca jamás de los jamases.", "casa"],
      ["Un texto largo que sigue y sigue sin parar nunca jamás de los jamases y termina en casa", "casa"],
      ["casa y casa y casa, siempre casa.", "casa"],
    ]);
  });

  it("never manufactures a token at the window's edge", async () => {
    // The real failure: the window's start landed inside `hermoso`, so the clipped
    // text began with `oso` and the display anchored on that instead of on the
    // occurrence at the end.
    const text = `${"hermoso ".repeat(40)}y aquí está el oso de verdad, al final del segmento.`;
    await expectSameRendering([[text, "oso"], [text, "hermoso"]]);
    const [row] = await clippedRows([[text, "oso"]]);
    expect(row?.clipped.startsWith("oso ")).toBe(false);
  });

  it("holds for every token position across the display's length thresholds", async () => {
    const words = ["casa", "oso", "ser"];
    const cases: (readonly [string, string])[] = [];
    for (const length of [178, 180, 181, 182, 183, 185, 200, 260, 400, 1_200, 7_872]) {
      for (const word of words) {
        for (const position of [0, 1, Math.floor(length / 2), length - 1, length]) {
          const filler = "palabra ".repeat(Math.ceil(length / 8)).slice(0, Math.max(0, position));
          const tail = "texto ".repeat(Math.ceil(length / 6)).slice(0, Math.max(0, length - position - word.length));
          cases.push([`${filler}${word}${tail}`, word]);
        }
      }
    }
    await expectSameRendering(cases);
  });

  it("keeps whitespace runs from changing the rendering", async () => {
    await expectSameRendering([
      [`${"palabra ".repeat(30)}   \n\n\t  casa   \n  ${"texto ".repeat(30)}`, "casa"],
      [`  ${"x".repeat(400)}  casa  ${"y".repeat(400)}  `, "casa"],
    ]);
  });

  it("clips long segments and leaves short ones whole", async () => {
    const short = "Casa con parque.";
    const long = `${"palabra ".repeat(60)}casa${" texto".repeat(60)}`;
    const rows = await clippedRows([[short, "casa"], [long, "casa"]]);
    expect(rows[0]?.clipped).toBe(short);
    const clippedLength = rows[1]?.clipped.length ?? 0;
    expect(clippedLength).toBeLessThan(long.length);
    expect(clippedLength).toBeLessThanOrEqual(FREQUENCY_EXAMPLE_MARGIN_CHARS * 2 + "casa".length + 32);
    expect(clippedLength).toBeGreaterThanOrEqual(FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS);
  });

  it("keeps the window wider than the display's own limit", () => {
    // The two constants have to stay in this relation or the branch above breaks.
    expect(FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS).toBeGreaterThan(FREQUENCY_CONTEXT_MAX_CHARS);
    expect(FREQUENCY_EXAMPLE_MARGIN_CHARS * 2).toBeGreaterThan(FREQUENCY_CONTEXT_MAX_CHARS);
  });
});

describe("the materialised read clips without changing what is rendered", () => {
  it("returns a bounded example that renders identically, and a short one untouched", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        create table lexicon_form_frequencies (
          word text primary key,
          occurrence_count integer not null,
          example_title text not null,
          example_text text not null
        );
        create table lexicon_form_frequency_state (
          id text primary key,
          refreshed_at timestamptz not null,
          form_count integer not null
        );
        insert into lexicon_form_frequency_state (id, refreshed_at, form_count)
        values ('corpus', '2026-10-12T00:00:00Z', 2);
      `);
      const long = `${"palabra ".repeat(80)}casa${" texto".repeat(80)}`;
      const short = "Casa con parque.";
      await client.exec(`
        insert into lexicon_form_frequencies (word, occurrence_count, example_title, example_text) values
          ('casa', 3, 'Podcast publicado', '${long.replace(/'/gu, "''")}'),
          ('parque', 1, 'Podcast publicado', '${short}')
      `);
      const database = drizzle(client) as unknown as Database;
      const read = await readMaterialisedFormFrequencyRows(database, "casa parque");
      expect(read.status).toBe("ok");
      if (read.status !== "ok") return;
      const byWord = new Map(read.rows.map((row) => [row.word, row.example]));
      const clipped = byWord.get("casa")?.[0] ?? "";
      expect(clipped.length).toBeLessThan(long.length);
      expect(rendered(clipped, "casa")).toBe(rendered(long, "casa"));
      expect(byWord.get("parque")?.[0]).toBe(short);
    } finally {
      await client.close();
    }
  });
});

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!connection)("every row the shelf reads (needs a database)", () => {
  const client = postgres(connection ?? "", { max: 1, prepare: false, connect_timeout: 30 });
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  // A cold read of the real table takes seconds, not milliseconds.
  it("renders identically from the clipped window for all of them", async () => {
    const wanted = wantedFormList();
    const fragment = clippedFrequencyExample(sql`f.example_text`, sql`f.word`);
    const query = dialect.sqlToQuery(sql`
      select f.word, f.example_text, ${fragment} as clipped
      from lexicon_form_frequencies f
      where f.word = any(string_to_array(${wanted}, ' '))
    `);
    const rows = (await client.unsafe(query.sql, query.params as never[])) as unknown as {
      word: string;
      example_text: string;
      clipped: string;
    }[];
    expect(rows.length).toBeGreaterThan(1_000);

    let compared = 0;
    let carried = 0;
    let fullBytes = 0;
    const mismatches: string[] = [];
    for (const row of rows) {
      const full = row.example_text ?? "";
      const clipped = row.clipped ?? "";
      fullBytes += full.length;
      carried += clipped.length;
      const expected = rendered(full, row.word);
      const actual = rendered(clipped, row.word);
      compared += 1;
      if (actual !== expected && mismatches.length < 5) {
        mismatches.push(`${row.word}: expected ${JSON.stringify(expected)?.slice(0, 80)} got ${JSON.stringify(actual)?.slice(0, 80)}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBe(rows.length);
    // The clip has to actually carry less, or the read is unchanged.
    expect(carried).toBeLessThan(fullBytes / 2);
  }, 180_000);
});
