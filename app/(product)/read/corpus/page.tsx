import type { Metadata } from "next";

import { CorpusSearch, LexicalAssessment } from "@/src/modules/lexicon-corpus";

export const metadata: Metadata = { title: "语料" };

type CorpusPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function CorpusPage({ searchParams }: CorpusPageProps) {
  const params = await searchParams;
  const query = one(params.q) || one(params.query);
  const entryKind = one(params.entryKind);
  // Annotated, not inferred: the object below is passed to a `Partial<EntryKind>`
  // slot, and without the annotation TypeScript widens the narrowed ternary back
  // to `string` and the production build stops on the type check.
  const entryKindFilter: "lexeme" | "phrase" | undefined = entryKind === "lexeme" || entryKind === "phrase" ? entryKind : undefined;
  const assessmentKey = one(params.assessment).trim();
  const initialState = {
    query,
    match: one(params.match) === "all" ? "all" as const : "phrase" as const,
    documentKind: one(params.documentKind) as "" | "article" | "media",
    sourceKind: one(params.sourceKind),
    stableKey: one(params.stableKey),
    entryKind: entryKindFilter,
    entryId: one(params.entryId) || undefined,
  };
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(params.page) || "1", 10) || 1));
  return <main className="lexicon-shelf corpus-page">
    <header className="lexicon-shelf__header">
      <div><p className="lexicon-shelf__eyebrow">真实用法</p><h1>语料</h1><p className="page-lede">在真实文章、视频和播客里比较一个词或短语的上下文。</p></div>
      <p>浏览语料不会写入能力评分；只有完成文字考察才会产生词句证据。</p>
    </header>
    <CorpusSearch initialState={initialState} initialPage={page} />
    {assessmentKey ? <LexicalAssessment assessmentKey={assessmentKey} /> : null}
  </main>;
}
