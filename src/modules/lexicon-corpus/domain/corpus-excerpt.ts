import { corpusHighlightRanges } from "./corpus-highlight";

/** Keep original sentence boundaries and punctuation; never cut by word count. */
export function corpusArticleExcerpt(text: string, query: string, match: "phrase" | "all") {
  if (text.length <= 360 || typeof Intl.Segmenter !== "function") return text;
  const sentences = [...new Intl.Segmenter("es", { granularity: "sentence" }).segment(text)];
  if (sentences.length < 2) return text;
  if (!query.trim()) return sentences.slice(0, 2).map((sentence) => sentence.segment).join("").trim();
  const ranges = corpusHighlightRanges(text, query, match);
  if (!ranges.length) return text;
  const first = sentences.findIndex((sentence) => sentence.index + sentence.segment.length > ranges[0].start);
  const last = sentences.findIndex((sentence) => sentence.index + sentence.segment.length >= ranges.at(-1)!.end);
  if (first < 0 || last < first) return text;
  // A contiguous span preserves every match, including words in different sentences.
  return sentences.slice(first, last + 1).map((sentence) => sentence.segment).join("").trim();
}
