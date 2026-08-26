import { z } from "zod";

import { parseArticleId } from "@/src/modules/content/domain/article";

export const readingItemSchema = z.object({
  position: z.number().int().min(0),
  text: z.string().trim().min(1).max(500),
});

export const readingStatePatchSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/iu),
  highlights: z.array(readingItemSchema).max(500),
  note: z.string().max(2_000),
  position: z.number().int().min(0),
  saved: z.boolean(),
  savedPhrases: z.array(readingItemSchema).max(500),
  status: z.enum(["in_progress", "completed"]),
});

export type ReadingItem = Readonly<z.infer<typeof readingItemSchema>>;
export type ReadingProgressStatus = "in_progress" | "completed";
export type ReadingStatePatch = Readonly<z.infer<typeof readingStatePatchSchema>>;
export type ReadingState = Readonly<{
  articleId: string;
  contentHash: string;
  highlights: readonly ReadingItem[];
  lastOpenedAt: Date;
  note: string;
  position: number;
  saved: boolean;
  savedPhrases: readonly ReadingItem[];
  status: ReadingProgressStatus;
}>;

export type SavedArticleSource = Readonly<{
  author: string | null;
  copyrightStatus: "unverified" | "cleared" | "restricted";
  createdAt: Date;
  id: string;
  license: "original" | "public_domain" | "creative_commons" | "licensed" | "short_quote" | null;
  normalizedUrl: string;
  sourceName: string | null;
  sourceUrl: string;
  status: "saved" | "blocked";
  title: string | null;
}>;

export const savedArticleSourceInputSchema = z.object({
  author: z.string().trim().max(240).optional().nullable(),
  license: z.enum(["original", "public_domain", "creative_commons", "licensed", "short_quote"]).optional().nullable(),
  sourceName: z.string().trim().max(240).optional().nullable(),
  title: z.string().trim().max(500).optional().nullable(),
  url: z.string().trim().url().max(2_048),
});

export type SavedArticleSourceInput = Readonly<z.infer<typeof savedArticleSourceInputSchema>>;

export function normalizeSourceUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) source URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Source URLs cannot include credentials.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}

export function articleReference(articleId: string): { stableKey: string; version: number } {
  const parsed = parseArticleId(articleId);
  if (!parsed) throw new Error("A versioned article ID is required.");
  return parsed;
}

export function articleId(stableKey: string, version: number): string {
  return `${stableKey}@${version}`;
}
