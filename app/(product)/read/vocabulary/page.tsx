import type { Metadata } from "next";
import { z } from "zod";

import {
  createDrizzleLexiconCorpusRepository,
  LexiconPagination,
  listFrequencyWords,
  listVocabulary,
  ReadSectionNavigation,
  VocabularyLibrary,
  vocabularyQuerySchema,
  VocabularyShelfControls,
} from "@/src/modules/lexicon-corpus";
import { listStudyVocabularyWords } from "@/src/modules/reading/domain/study-vocabulary";
import { VocabularyStudyList } from "@/src/modules/reading/ui/vocabulary-study-list";
import { VocabularyWordGrid, type VocabularyWordGridItem } from "@/src/modules/reading/ui/vocabulary-word-grid";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "词汇" };

type VocabularyPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

const viewSchema = z.enum(["study", "frequency", "lexicon"]).catch("study");
const LEXICON_LOAD_TIMEOUT_MS = 2_500;
const FREQUENCY_LOAD_TIMEOUT_MS = 20_000;
const SESSION_LOAD_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("LEXICON_LOAD_TIMEOUT")), milliseconds); }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
}

export default async function VocabularyPage({ searchParams }: VocabularyPageProps) {
  const params = await searchParams;
  const parsed = vocabularyQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : vocabularyQuerySchema.parse({});
  const view = viewSchema.parse(params.view);
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);

  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let frequencyItems: Awaited<ReturnType<typeof listFrequencyWords>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let frequencyUnavailable = !databaseUrlConfigured;
  let result: Awaited<ReturnType<typeof listVocabulary>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let unavailable = !databaseUrlConfigured;

  if (view === "study") {
    // The study shelf renders without reading the database; only the local
    // study marks need the account scope, so a slow or missing session must
    // never block the list.
    user = await withTimeout(getCurrentUser(), SESSION_LOAD_TIMEOUT_MS).catch(() => null);
  }

  if (databaseUrlConfigured && view !== "study") {
    try {
      const database = getDatabase();
      const repository = createDrizzleLexiconCorpusRepository(database);
      if (view === "frequency") {
        try {
          frequencyItems = await withTimeout(listFrequencyWords(repository, { search: query.search, page: query.page, pageSize: query.pageSize }), FREQUENCY_LOAD_TIMEOUT_MS);
          frequencyUnavailable = false;
        } catch {
          frequencyUnavailable = true;
        }
      }
      if (view === "lexicon") {
        user = await getCurrentUser();
        try {
          result = await withTimeout(listVocabulary(repository, user?.id, query), LEXICON_LOAD_TIMEOUT_MS);
          unavailable = false;
        } catch {
          unavailable = true;
        }
      }
    } catch {
      frequencyUnavailable = true;
      unavailable = true;
    }
  }

  const filtered = Boolean(query.search || query.intent || query.lemmaStatus);
  const resultKey = [query.search, query.intent, query.lemmaStatus, query.page, query.pageSize].join(":");
  const frequencyWords: readonly VocabularyWordGridItem[] = frequencyItems.items.map((item) => ({
    id: item.id,
    text: item.word,
    count: item.occurrenceCount,
    meaning: null,
    context: item.context,
    source: item.sourceTitle,
    saved: false,
  }));
  const studyWords = listStudyVocabularyWords();

  return <div className="page-stack read-page">
    <ReadSectionNavigation active="vocabulary" />
    <main className="lexicon-shelf">
      {/* Keep one page-level heading for assistive technology and the document
          outline; it stays visually hidden so the shelf starts directly with
          the word list. The section navigation already labels this page. */}
      <h1 className="sr-only">词汇</h1>

      {view === "study" ? <VocabularyStudyList words={studyWords} storageScope={user?.id ?? "anonymous"} /> : null}

      {view === "frequency" ? <>
        <VocabularyShelfControls query={query} total={frequencyItems.total} view="frequency" />
        <VocabularyWordGrid items={frequencyWords} search={query.search ?? ""} total={frequencyItems.total} />
        {frequencyUnavailable && !frequencyWords.length ? <div className="lexicon-empty lexicon-empty--error" role="alert"><h2>语料高频词暂时不可用</h2><p>已发布内容仍然安全保留，请稍后刷新。</p></div> : null}
        {!frequencyUnavailable && !frequencyWords.length ? <div className="lexicon-empty"><h2>还没有可用高频词</h2><p>发布并审核文章或媒体字幕后，这里会自动统计。</p></div> : null}
        <LexiconPagination basePath="/read/vocabulary" page={frequencyItems.page} pageSize={query.pageSize} total={frequencyItems.total} query={{ view: "frequency", search: query.search, pageSize: query.pageSize }} />
      </> : null}

      {view === "lexicon" ? <>
        <div className="lexicon-formal-section">
          <div className="lexicon-saved-section__heading">
            <div>
              <p className="lexicon-shelf__eyebrow">Corpus vocabulary</p>
              <h2>正式词元</h2>
              <p>已确认或待确认的词形，按来源出现次数整理。</p>
            </div>
          </div>
          <VocabularyShelfControls query={query} total={result.total} view="lexicon" />
          <VocabularyLibrary key={resultKey} filtered={filtered} items={result.items} total={result.total} unavailable={unavailable} />
        </div>
        <LexiconPagination basePath="/read/vocabulary" page={result.page} pageSize={query.pageSize} total={result.total} query={{ view: "lexicon", search: query.search, intent: query.intent, lemmaStatus: query.lemmaStatus, pageSize: query.pageSize }} />
      </> : null}
    </main>
  </div>;
}
