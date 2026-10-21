import { z } from "zod";

export const phraseTopics = [
  { id: "connect", title: "自然接话", description: "让聊天继续下去", label: "接得上话" },
  { id: "repair", title: "没听懂时", description: "听不清，也能从容继续", label: "化解卡壳" },
  { id: "opinion", title: "表达想法", description: "说出态度，留一点余地", label: "说出想法" },
  { id: "plans", title: "邀约与安排", description: "从提议到约好时间", label: "约个时间" },
  { id: "requests", title: "请求与婉拒", description: "把需要说得得体", label: "有话好说" },
  { id: "everyday", title: "日常办事", description: "点单、购物与问路", label: "日常用得上" },
] as const;

export type PhraseTopic = typeof phraseTopics[number]["id"];

const line = z.object({ es: z.string().min(3), zh: z.string().min(2) }).strict();
export const phrasebookEntrySchema = z.object({
  id: z.string().regex(/^[a-z]+(?:-[a-z]+)+$/),
  topic: z.enum(["connect", "repair", "opinion", "plans", "requests", "everyday"]),
  expression: z.string().min(4),
  meaning: z.string().min(2),
  situation: z.string().min(8),
  register: z.enum(["日常口语", "中性礼貌", "熟人之间"]),
  level: z.enum(["A2", "B1"]),
  dialogue: z.tuple([line, line]),
  note: z.string().min(12),
  alternatives: z.array(line).min(2),
  pattern: z.string().min(4),
  replacement: line,
  prompt: z.string().min(8),
}).strict();

export type PhrasebookEntry = z.infer<typeof phrasebookEntrySchema>;

export function normalizePhrasebookSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function matchesPhrasebookSearch(entry: PhrasebookEntry, query: string): boolean {
  const terms = normalizePhrasebookSearch(query).split(/\s+/u).filter(Boolean);
  const haystack = normalizePhrasebookSearch([
    entry.expression, entry.meaning, entry.situation, entry.note, entry.pattern,
    ...entry.alternatives.flatMap((line) => [line.es, line.zh]),
    ...entry.dialogue.flatMap((line) => [line.es, line.zh]),
  ].join(" "));
  return terms.every((term) => haystack.includes(term));
}
