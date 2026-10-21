import { sql } from "drizzle-orm";
import type { Database } from "@/src/shared/db/client";
import { normalizeCorpusQuery } from "../domain/kwic";
import { corpusExamplesPageSchema, type CorpusExamplesPage, type CorpusExamplesQuery } from "../schemas/corpus-examples";

export interface CorpusExamplesRepository {
  list(userId: string, query: CorpusExamplesQuery): Promise<CorpusExamplesPage>;
}

/** A read-only projection; source publication, rights and ownership are rechecked on every read. */
export function createCorpusExamplesRepository(database: Pick<Database, "execute">): CorpusExamplesRepository {
  return {
    async list(userId, query) {
      const terms = normalizeCorpusQuery(query.query);
      // Tokens contain letters only; SQL parameters keep user text out of SQL syntax.
      const folded = sql`translate(lower(normalize(text, NFC)), 'áéíóúüñ', 'aeiouun')`;
      const pattern = (term: string) => `(^|[^[:alpha:]'’])${term}([^[:alpha:]'’]|$)`;
      const match = !query.query ? sql`true` : !terms.length ? sql`false`
        : query.match === "all" ? sql.join(terms.map((term) => sql`${folded} ~ ${pattern(term)}`), sql` and `)
        : sql`${folded} ~ ${pattern(terms.join("[^[:alpha:]'’]+"))}`;
      const entryFilter = query.entryId && query.entryKind ? sql`exists (
        select 1 from corpus_occurrences co where
          ${query.entryKind === "phrase" ? sql`co.phrase_entry_id` : sql`co.lexeme_id`} = ${query.entryId}::uuid
          and co.document_kind::text = contextual.document_kind
          and co.document_stable_key = contextual.stable_key and co.document_version = contextual.version
          and (co.source_position->>'segmentIndex')::integer = contextual.segment_index
          and (co.owner_user_id is null or co.owner_user_id = ${userId}::uuid)
      )` : sql`true`;
      const rows = await database.execute(sql`
        with visible as (
          select 'article'::text content_kind, 'article'::text document_kind, a.stable_key, av.version,
            av.title source_title, src.source_name, s.position segment_index,
            s.source_text text, null::text translation, null::integer start_ms, null::integer end_ms
          from article_segments s join article_versions av on av.id = s.article_version_id
          join articles a on a.id = av.article_id join article_sources src on src.id = av.source_id
          left join user_generated_articles generated on generated.article_version_id = av.id
          where av.status = 'published' and src.copyright_status = 'cleared'
            and av.version = (select max(latest.version) from article_versions latest where latest.article_id = a.id and latest.status = 'published')
            and (generated.id is null or generated.user_id = ${userId}::uuid)
          union all
          select mi.kind::text, 'media'::text, mi.stable_key, mv.version, mv.title, mv.source_name,
            s.segment_index, s.source_text, s.translation, s.start_ms, s.end_ms
          from media_segments s join media_versions mv on mv.id = s.media_version_id
          join media_items mi on mi.id = mv.media_item_id
          where mv.status = 'published' and mv.copyright_status = 'cleared'
            and mi.current_version = mv.version and s.review_status = 'approved'
        ), contextual as (
          select *, lag(text) over w before, lead(text) over w after from visible
          window w as (partition by document_kind, stable_key, version order by segment_index)
        ), matched as (
          select *, row_number() over (partition by document_kind, stable_key, version order by segment_index) source_rank,
            dense_rank() over (partition by content_kind order by stable_key, version) document_rank
          from contextual where (${match}) and btrim(text) <> '' and ${entryFilter}
            and ${query.contentKind ? sql`content_kind = ${query.contentKind}` : sql`true`}
            and ${query.documentKind ? sql`document_kind = ${query.documentKind}` : sql`true`}
            and ${query.stableKey ? sql`stable_key = ${query.stableKey}` : sql`true`}
            and ${query.sourceKind ? sql`source_name = ${query.sourceKind}` : sql`true`}
        ), paged as (
          select * from matched order by source_rank, document_rank, content_kind, stable_key, version, segment_index
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
        )
        select (select count(*)::integer from matched) total,
          coalesce(jsonb_agg(jsonb_build_object(
            'id', document_kind || ':' || stable_key || ':' || version || ':' || segment_index,
            'text', text, 'translation', translation, 'before', before, 'after', after,
            'sourceTitle', source_title, 'sourceName', source_name, 'contentKind', content_kind,
            'document', jsonb_build_object('kind', document_kind, 'stableKey', stable_key, 'version', version),
            'location', case when document_kind = 'article' then jsonb_build_object('kind', 'text', 'paragraphId', 'segment-' || segment_index, 'segmentIndex', segment_index)
              else jsonb_build_object('kind', 'media', 'startMs', start_ms, 'endMs', end_ms, 'segmentIndex', segment_index) end
          ) order by source_rank, document_rank, content_kind, stable_key, version, segment_index), '[]'::jsonb) items from paged
      `);
      const row = rows[0];
      return corpusExamplesPageSchema.parse({ ...row, page: query.page, pageSize: query.pageSize });
    },
  };
}
