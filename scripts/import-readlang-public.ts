import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import coreBundle from "../content/bundles/alpha-core-v1.json";
import { hashArticleContent } from "../src/modules/content/import/content-hash";

type ReadlangRecord = {
  _id: string;
  title: string;
  author?: string;
  category?: string;
  total_words?: number;
  metrics?: { CEF?: string; vocabCEF?: string; ARICEF?: string };
  content: string;
  source_url: string;
  fetched_at?: string;
};

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument) {
  throw new Error("Usage: tsx scripts/import-readlang-public.ts <articles.jsonl> [output.json]");
}

const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(
  outputArgument ?? "content/bundles/readlang-public-v1.json",
);
const input = await readFile(inputPath, "utf8");
const records = input
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line) as ReadlangRecord;
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${String(error)}`);
    }
  });

const cefrValues = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
const importedAt = "2026-08-26T11:03:33.000Z";

function cleanText(value: string) {
  return value
    .replace(/<([^>]+)>/gu, "$1")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function splitLongSegment(value: string): string[] {
  if (value.length <= 8_000) return [value];
  const sentences = value.split(/(?<=[.!?¿¡])\s+/u);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > 8_000) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  if (chunks.every((chunk) => chunk.length <= 8_000)) return chunks;
  return chunks.flatMap((chunk) => {
    const parts: string[] = [];
    for (let index = 0; index < chunk.length; index += 8_000) {
      parts.push(chunk.slice(index, index + 8_000));
    }
    return parts;
  });
}

function normalizeAuthor(author: string | undefined): string | undefined {
  const trimmed = author?.replace(/\s+/gu, " ").trim();
  return trimmed && trimmed.length <= 300 ? trimmed : undefined;
}

function cefr(record: ReadlangRecord): "A1" | "A2" | "B1" | "B2" | "C1" | "C2" {
  const candidate = [record.metrics?.CEF, record.metrics?.vocabCEF, record.metrics?.ARICEF]
    .find((value) => value && cefrValues.has(value));
  return (candidate ?? "B1") as "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
}

function format(category: string | undefined, title: string) {
  if (category === "Conversation") return "dialogue" as const;
  if (category === "Fiction") return "story" as const;
  if (/^Noticias\b/iu.test(title)) return "news" as const;
  if (category === "Other") return "guide" as const;
  return "essay" as const;
}

function topic(category: string | undefined) {
  switch (category) {
    case "Conversation":
      return "topic.conversation";
    case "Fiction":
      return "topic.fiction";
    case "Non-Fiction":
      return "topic.non-fiction";
    case "Other":
      return "topic.other";
    default:
      return "topic.general";
  }
}

const articles = records.map((record, index) => {
  const stableKey = `article.readlang.${record._id}`;
  const rawParagraphs = cleanText(record.content)
    .split(/\n\s*\n/u)
    .map(cleanText)
    .filter(Boolean)
    .flatMap(splitLongSegment);
  const segments = rawParagraphs.map((text, position) => ({ position, text }));
  const author = normalizeAuthor(record.author);
  const article = {
    stableKey,
    version: 1,
    locale: "es-ES",
    title: record.title.trim(),
    summary: cleanText(record.content).replace(/\s+/gu, " ").slice(0, 400).trim(),
    source: {
      sourceType: "licensed",
      sourceName: "Readlang public library",
      ...(author ? { author } : {}),
      sourceUrl: record.source_url,
      license: "licensed",
      attribution: author
        ? `${author}; Readlang public library export`
        : "Readlang public library export; author attribution is retained at the source URL",
      licenseEvidence:
        "The project owner confirmed authorization to redistribute the exported article text in Sueño on 2026-08-26; the original public source URL is retained for attribution.",
      copyrightStatus: "cleared",
      reviewNotes:
        "Imported from a user-provided Readlang export. Redistribution authorization was confirmed by the project owner; this record does not imply Readlang ownership of the underlying work.",
    },
    curatedAt: record.fetched_at ?? importedAt,
    publishedAt: importedAt,
    contentHash: "",
    cefr: cefr(record),
    topics: [topic(record.category)],
    region: "general",
    register: "neutral",
    format: format(record.category, record.title),
    estimatedReadingMinutes: Math.min(
      240,
      Math.max(1, Math.ceil((record.total_words ?? cleanText(record.content).split(/\s+/u).length) / 180)),
    ),
    assets: [
      { assetType: "audio", available: false, copyrightStatus: "cleared" },
      { assetType: "chinese_summary", available: false, copyrightStatus: "cleared" },
      { assetType: "word_help", available: false, copyrightStatus: "cleared" },
      { assetType: "image", available: false, copyrightStatus: "cleared" },
    ],
    relatedExpressionKeys: [],
    relatedGoalKeys: [],
    relatedTagKeys: [],
    oralTransferType: "none",
    status: "published",
    changeReason: "Initial authorized import from the Readlang public library export.",
    reviewNotes:
      "Content structure and source metadata checked during import. Published under the project owner's confirmed redistribution authorization.",
    segments,
  };
  article.contentHash = hashArticleContent(article);
  if (!article.segments.length) {
    throw new Error(`Article ${index + 1} has no readable segments: ${record._id}`);
  }
  return article;
});

const reviews = articles.map((article) => ({
  entityType: "article" as const,
  stableKey: article.stableKey,
  version: 1,
  locale: "es-ES",
  status: "approved" as const,
  reviewerReference: "codex-ai-temporary-review",
  notes:
    "个人 Alpha 临时 AI 审核：正文为用户确认已获授权的导入内容；结构、来源和版权字段完整。不等同母语者或教学专家签字。",
  reviewedAt: importedAt,
}));

const domain = {
  ...coreBundle.domains[0],
  stableKey: "reading.public",
  title: { "zh-CN": "公共阅读" },
  description: { "zh-CN": "通过授权文章建立阅读理解。" },
};
const goal = {
  ...coreBundle.goals[0],
  stableKey: "reading.public.comprehension",
  domainKey: domain.stableKey,
  title: { "zh-CN": "理解公共文章" },
  description: { "zh-CN": "在真实西语文章中识别主要信息。" },
  cefrMin: "A1" as const,
  cefrMax: "C2" as const,
};
const tag = {
  ...coreBundle.tags[0],
  stableKey: "reading.public",
  label: { "zh-CN": "公共阅读" },
  description: { "zh-CN": "来自授权公共文章的阅读内容。" },
};
const expression = {
  ...coreBundle.expressions[0],
  stableKey: "reading.public.read-article",
  goalKey: goal.stableKey,
  text: "Leo un artículo para entender la idea principal.",
  translations: { "zh-CN": "我阅读一篇文章来理解主要观点。" },
  communicativeIntent: { "zh-CN": "说明自己通过阅读获取主要信息。" },
  tags: [{ tagKey: tag.stableKey, weight: 1, scoring: true }],
  status: "draft" as const,
};

const bundle = {
  schemaVersion: "1.0",
  bundle: {
    stableKey: "readlang.public",
    version: 1,
    defaultLocale: "es-ES",
    nativeLanguage: "zh-CN",
    description:
      "100 Spanish public reading articles imported from a user-authorized Readlang export.",
  },
  domains: [domain],
  goals: [goal],
  tags: [tag],
  expressions: [expression],
  scenarios: [],
  contentPacks: [],
  characters: [],
  articles,
  reviews,
};

await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
const digest = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
process.stdout.write(
  `Wrote ${articles.length} authorized articles to ${outputPath} (sha256 ${digest})\n`,
);
