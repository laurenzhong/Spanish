export type ArticleFormat = "news" | "essay" | "dialogue" | "guide" | "story";
export type ArticleOralTransferType = "none" | "summary" | "opinion" | "personal_transfer";

export type ArticleCardProjection = Readonly<{
  id: string;
  stableKey: string;
  version: number;
  locale: string;
  title: string;
  summary: string;
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  topics: readonly string[];
  region: string;
  register: string;
  format: ArticleFormat;
  estimatedReadingMinutes: number;
  sourceName: string;
  author: string | null;
  publicationDate: string | null;
  assets: Readonly<{
    audio: boolean;
    chineseSummary: boolean;
    wordHelp: boolean;
    image: boolean;
  }>;
  oralTransferType: ArticleOralTransferType;
}>;

export type ArticleListQuery = Readonly<{
  search?: string;
  topic?: string;
  savedOnly?: boolean;
  cursor?: string;
  pageSize?: number;
}>;

export type ArticleListResult = Readonly<{
  articles: readonly ArticleCardProjection[];
  topics: readonly string[];
  nextCursor: string | null;
  hasMore: boolean;
  savedFilterAvailable: boolean;
}>;

export function articleId(stableKey: string, version: number): string {
  return `${stableKey}@${version}`;
}

type RawArticle = {
  stableKey: string;
  version: number;
  locale: string;
  title: string;
  summary: string;
  source: {
    sourceName: string;
    author?: string;
    publicationDate?: string;
    copyrightStatus: "unverified" | "cleared" | "restricted";
  };
  cefr: ArticleCardProjection["cefr"];
  topics: string[];
  region: string;
  register: string;
  format: ArticleFormat;
  estimatedReadingMinutes: number;
  assets: readonly { assetType: "audio" | "chinese_summary" | "word_help" | "image"; available: boolean }[];
  oralTransferType: ArticleOralTransferType;
  status: "draft" | "review" | "approved" | "published" | "archived";
};

export function projectPublicArticle(raw: RawArticle): ArticleCardProjection | null {
  if (raw.status !== "published" || raw.source.copyrightStatus !== "cleared") return null;
  const assets = { audio: false, chineseSummary: false, wordHelp: false, image: false };
  for (const asset of raw.assets) {
    if (asset.assetType === "audio") assets.audio = asset.available;
    if (asset.assetType === "chinese_summary") assets.chineseSummary = asset.available;
    if (asset.assetType === "word_help") assets.wordHelp = asset.available;
    if (asset.assetType === "image") assets.image = asset.available;
  }
  return {
    id: articleId(raw.stableKey, raw.version),
    stableKey: raw.stableKey,
    version: raw.version,
    locale: raw.locale,
    title: raw.title,
    summary: raw.summary,
    cefr: raw.cefr,
    topics: raw.topics,
    region: raw.region,
    register: raw.register,
    format: raw.format,
    estimatedReadingMinutes: raw.estimatedReadingMinutes,
    sourceName: raw.source.sourceName,
    author: raw.source.author ?? null,
    publicationDate: raw.source.publicationDate ?? null,
    assets,
    oralTransferType: raw.oralTransferType,
  };
}

export function filterArticles(
  articles: readonly ArticleCardProjection[],
  query: ArticleListQuery,
): ArticleListResult {
  const allTopics = [...new Set(articles.flatMap((article) => article.topics))].sort();
  if (query.savedOnly) return { articles: [], topics: allTopics, nextCursor: null, hasMore: false, savedFilterAvailable: false };

  const term = query.search?.trim().toLocaleLowerCase() ?? "";
  const filtered = articles.filter((article) => {
    const matchesTopic = !query.topic || article.topics.includes(query.topic);
    const haystack = `${article.title} ${article.summary} ${article.sourceName} ${article.topics.join(" ")}`.toLocaleLowerCase();
    return matchesTopic && (!term || haystack.includes(term));
  });
  const pageSize = Math.min(Math.max(query.pageSize ?? 12, 1), 24);
  const offset = Math.max(Number.parseInt(query.cursor ?? "0", 10) || 0, 0);
  const page = filtered.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  return {
    articles: page,
    topics: allTopics,
    nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
    hasMore: nextOffset < filtered.length,
    savedFilterAvailable: false,
  };
}
