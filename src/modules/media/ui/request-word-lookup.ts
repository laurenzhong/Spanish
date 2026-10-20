import { z } from "zod";

const details = z.object({
  found: z.literal(true), word: z.string().min(1).max(64),
  meanings: z.array(z.object({ meaning: z.string().min(1).max(500), usage: z.string().max(700) })).max(20),
  meaningSource: z.enum(["language-reactor", "reviewed-glossary", "none"]),
  partOfSpeech: z.string().nullable(), cefr: z.string().nullable(),
  usageNotes: z.array(z.string()), collocations: z.array(z.string()), examples: z.array(z.string()), forms: z.array(z.string()),
});
export type MediaWordDetails = z.infer<typeof details>;
const lookup = z.object({ data: z.discriminatedUnion("found", [details, z.object({ found: z.literal(false), word: z.string() })]) });

export async function requestWordLookup(word: string, signal: AbortSignal): Promise<MediaWordDetails | null> {
  const response = await fetch("/api/v1/read/word-lookup", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ word }), signal,
  });
  if (!response.ok) throw new Error("词典暂时不可用。");
  const result = lookup.parse(await response.json()).data;
  signal.throwIfAborted();
  return result.found ? result : null;
}
