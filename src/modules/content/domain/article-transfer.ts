import type { ArticleReaderProjection, ArticleOralTransferType } from "./article";

export const articleTransferTypes = [
  "summary",
  "opinion",
  "personal_transfer",
  "character_dialogue",
] as const;

export type ArticleTransferType = (typeof articleTransferTypes)[number];

export type ArticleTransferTask = Readonly<{
  type: ArticleTransferType;
  label: string;
  description: string;
  prompt: string;
}>;

const taskCopy: Record<
  ArticleTransferType,
  Readonly<{ label: string; description: string; prompt: string }>
> = {
  summary: {
    label: "说说文章讲了什么",
    description: "抓住一到两个关键变化，用自己的话复述。",
    prompt: "用自己的话说说这篇文章讲了什么，先说最重要的一件事。",
  },
  opinion: {
    label: "说说你的看法",
    description: "选一个细节，说说你赞同、意外或不理解的地方。",
    prompt: "选一个文章里的细节，说说你的看法，并补一句为什么。",
  },
  personal_transfer: {
    label: "联系到自己的生活",
    description: "把文章里的场景换成你真实经历过的一个片段。",
    prompt: "把文章里的一个场景联系到自己的生活，讲一个具体片段。",
  },
  character_dialogue: {
    label: "和角色聊两句",
    description: "假设你把文章分享给一位朋友，自然回应并追问一句。",
    prompt: "假设你把这篇文章分享给一位朋友，先说你的反应，再追问一句。",
  },
};

export function parseArticleTransferType(value: unknown): ArticleTransferType | null {
  return typeof value === "string" && (articleTransferTypes as readonly string[]).includes(value)
    ? (value as ArticleTransferType)
    : null;
}

export function articleTransferTask(
  article: Pick<ArticleReaderProjection, "title">,
  type: ArticleTransferType,
): ArticleTransferTask {
  const copy = taskCopy[type];
  return {
    type,
    label: copy.label,
    description: copy.description,
    prompt: `${copy.prompt}（文章：《${article.title}》）`,
  };
}

export function recommendedArticleTransferType(
  value: ArticleOralTransferType,
): ArticleTransferType | null {
  return value === "none" ? null : value;
}
