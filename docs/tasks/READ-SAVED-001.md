# Handoff: fold saved articles + private stories into 已保存

Status: **Phase 1 and Phase 2 both done and verified (committed in `ee66f9a`).**

Context: the reading area was restructured this session. `/read?saved=1` ("我的文章")
was removed entirely, and `已保存` (`/read/saved-items`) is the single personal shelf.
Phase 1 removed the old state; Phase 2 folded saved articles **and** the owner's
private AI stories into `/read/saved-items`, so the bookmark star and story
generation both have a visible destination again.

## Phase 1 — DONE (verified)

| File | Change |
|---|---|
| `app/(product)/read/page.tsx` | Rewritten: public library only. Dropped `saved`/`savedOnly`, `listSavedArticles`, `listPrivateStories`, `initialGeneratedArticles`. Keeps only `listReadingProgress`. |
| `app/(product)/read/read-shelf.tsx` | Rewritten: no source tabs, no `savedOnly`/`generatedArticles`/`pendingSource`/`sourceTransitionPending`/`displayedArticleCount`. Keeps the bookmark star (POST `/api/v1/read/saved`) and `?source=web` empty state. Added a `查看已保存` link in the 添加内容 menu. |
| `src/modules/lexicon-corpus/ui/read-section-navigation.tsx` | Single nav: 文章・词汇・短语・语料・已保存 |
| `tests/unit/article-library.test.tsx` | 14 → 6 tests; obsolete tab/pending/private-story tests removed |
| `tests/unit/read-page.test.tsx` | Removed the saved-page parallel-read test; `saved=1` now asserts personal reads never happen |
| `tests/e2e/product-shell.spec.ts` | `我的文章` asserted absent; the saved-article flow now goes via `/read/saved-items` |

Verified: `pnpm typecheck` 0 errors; `vitest` article-library 6/6, read-page 4/4,
lexicon-pages 5/5; `lexicon-library` e2e 6/6.

## Phase 2 — DONE (verified)

The shelf lists saved articles together with the owner's private AI stories; an
earlier revision of this note claimed the article kind had no UI entry point,
which no longer matched the code.

| Piece | Where |
|---|---|
| `article` is a first-class shelf kind (`全部 ｜ 文章 ｜ 保存词语 / 短语 ｜ 高亮`) | `savedShelfItemTypeSchema`, `SavedItemsLibrary` tabs |
| One query serves saved articles and private stories (published + `copyright_status='cleared'` + owner guard, `coalesce(save.createdAt, generated.createdAt)` timeline) | `listSavedArticleShelf` |
| 全部 merges the article source with the annotation source by `createdAt` DESC; type tabs paginate their own source exactly | `listSavedShelfItems` |
| CSV export and cards distinguish 已收藏文章 vs 私人 AI 故事 | `SavedItemsLibrary` |
| Guards | another user's private story never appears even with a stale save row |

Verified: `saved-shelf-items` 3/3, `saved-items-page` 4/4, `saved-items-routes` 10/10,
`saved-items-library` 9/9, plus the reading-area set 14 files / 67 tests green.

## Phase 2 — original decisions and locked interfaces (historical)

Tabs on `/read/saved-items`: **全部 ｜ 文章 ｜ 保存词语 / 短语 ｜ 高亮**.
Private AI stories are folded in as part of the article kind (not a separate tab).

## Phase 2 — locked interfaces

Recon confirmed: **no DB migration needed.** `user_article_saves` already has
`user_id`, `article_version_id`, `created_at`, `updated_at`, a unique index on
`(user_id, article_version_id)` and `(user_id, created_at)`. Article metadata is
reachable via joins the reading module already uses (`article_versions.title`,
`article_sources.source_name/source_url/copyright_status`, `user_generated_articles`
for ownership).

Critical constraints discovered:

- `listSavedItems` is driven by `FROM user_article_highlights`, so it can **never**
  return article saves. A new repository method is required.
- `listSavedArticleIds` returns ids only (`created_at DESC`), with **no**
  published-status and **no** generated-ownership filter — do not reuse it for a shelf.
- `savedReadingItemTypeSchema` (`z.enum(["phrase","highlight"])`) is shared by the
  domain query schema, `contracts/openapi/v1/openapi.json` (itemType enum) and
  `contracts/schemas/v1/saved-reading-items-response.schema.json` (`itemType` enum,
  and `data` is `additionalProperties: false`). Widening it touches all three.
- Pagination models differ: items = page/pageSize/total; generated stories =
  offset-cursor `{articles, nextCursor, hasMore}` with **no total**.
- **Do not delete** `src/modules/content/domain/article.ts` `savedOnly` /
  `savedFilterAvailable` / `filterArticles`: they are still used by
  `app/api/v1/content/articles/route.ts`, `drizzle-article-repository.ts`,
  `runtime-article-repository.ts` and their tests. Removing `/read?saved=1` only
  strands them for the page, not for the API.

Suggested shape (implementer may refine, but keep the public DTO explicit):

1. `domain/saved-items.ts` — add a saved-article entry type carrying
   `id` (save id), `stableKey`, `version`, `title`, `sourceName`, `sourceUrl`,
   `createdAt`, `origin: "public" | "generated"`, plus an `articleKind` discriminator
   if the UI needs to distinguish a private story. Widen the shelf-level type enum to
   include `"article"`; keep the DB-facing query enum at `phrase|highlight` if that
   keeps `listSavedItems` honest.
2. `repositories/reading-repository.ts` + `drizzle-reading-repository.ts` — new method
   listing saved articles with metadata, filtering
   `article_versions.status = 'published'` and
   `(user_generated_articles.id IS NULL OR user_generated_articles.user_id = userId)`,
   ordering by `user_article_saves.created_at DESC`, page/pageSize/total. Assert the
   `user_article_saves_user_created_idx` path in a DB test if `DATABASE_URL` exists.
3. `application/list-saved-items.ts` — an adapter returning `{ items, page, pageSize,
   total }` for both kinds. For 全部, either merge both sources by `createdAt` after
   fetching each page, or fetch each source at the requested page and slice; state the
   chosen semantics in the response or a comment. Private stories already pass
   `listSavedItems` visibility (they are `published` with a `cleared` source), so they
   may already appear in the 高亮/词语 tabs — decide and document whether that is wanted.
4. `app/api/v1/read/saved-items/route.ts` — accept the widened `itemType`; keep the
   `type` alias and the 400-on-invalid behaviour (`?itemType=word` must stay 400).
5. `contracts/openapi/v1/openapi.json` + `contracts/schemas/v1/*.json` — update enums
   and the item shape. `tests/contracts/api-contract.test.ts` loads every schema into
   Ajv with `strict: true` and requires every `$ref` to resolve, so a new schema file
   must be strict-valid. `data` is `additionalProperties: false` — adding an
   `data.articles` sibling array breaks it.
6. `src/modules/reading/ui/saved-items-library.tsx` — add the 文章 tab and an article
   card (title → `/read/article/<id>`, source, saved date, 取消收藏, plus 删除 with
   confirm for private stories). Keep the nav's accessible name matchable — the e2e
   test uses `getByRole("navigation", { name: "已保存词句类型" })` and clicks `高亮`.
7. `app/(product)/read/vocabulary/page.tsx` — delete the now-duplicated
   `view === "saved"` block (the 我的已保存词汇 section, lines ~138-148) and its
   loader (~76-91) and state (~52-53). Keep the `lexicon-saved-section__heading` class,
   which the `view === "lexicon"` block also uses. Then remove `"saved"` from
   `viewSchema`.
8. Tests to update: `tests/unit/saved-items-library.test.tsx` (tabs),
   `tests/unit/saved-items-routes.test.ts` (response shape, 400 case),
   `tests/database/saved-items-persistence.test.ts` (totals if fixtures gain saves),
   `tests/e2e/lexicon-library.spec.ts:60` (tab set), and the `product-shell` reading
   test's final saved-shelf assertions.

## Acceptance criteria

- `/read/saved-items` lists saved public articles and private stories under 文章, and
  words/phrases + highlights under their tabs; 全部 shows everything newest-first.
- Unsaving from the public shelf star removes the article from 已保存.
- Deleting a private story from 已保存 requires confirmation and removes it.
- No evidence/profile write on any of these paths (reading aids only).
- `pnpm typecheck`, focused `vitest`, `pnpm exec eslint <changed files>` and the
  `lexicon-library` + `product-shell` e2e specs pass. Report pre-existing failures
  separately (`tests/unit/vocabulary-speech-feedback.test.tsx` fails independently).
