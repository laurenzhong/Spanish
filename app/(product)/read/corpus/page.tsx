import type { Metadata } from "next";

import { LexicalAssessment } from "@/src/modules/lexicon-corpus";
import { CorpusWorkbench } from "@/src/modules/lexicon-corpus/ui/corpus-workbench";
import { corpusExamplesQuerySchema } from "@/src/modules/lexicon-corpus/schemas/corpus-examples";
import "./corpus-workbench.css";

export const metadata: Metadata = { title: "语料" };

type CorpusPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function CorpusPage({ searchParams }: CorpusPageProps) {
  const params = await searchParams;
  const query = one(params.q) || one(params.query);
  const entryKind = one(params.entryKind);
  const entryKindFilter: "lexeme" | "phrase" | undefined = entryKind === "lexeme" || entryKind === "phrase" ? entryKind : undefined;
  const assessmentKey = one(params.assessment).trim();
  const contentKind = one(params.contentKind);
  const contentKindFilter: "" | "article" | "video" | "podcast" = contentKind === "article" || contentKind === "video" || contentKind === "podcast" ? contentKind : "";
  const initialState = {
    query,
    match: one(params.match) === "all" ? "all" as const : "phrase" as const,
    documentKind: one(params.documentKind) as "" | "article" | "media",
    contentKind: contentKindFilter,
    sourceKind: one(params.sourceKind),
    stableKey: one(params.stableKey),
    entryKind: entryKindFilter,
    entryId: one(params.entryId) || undefined,
  };
  const page = Math.max(1, Math.min(100000, Number.parseInt(one(params.page) || "1", 10) || 1));
  const parsed = corpusExamplesQuerySchema.safeParse({ ...initialState, documentKind: initialState.documentKind || undefined, contentKind: contentKindFilter || undefined, sourceKind: initialState.sourceKind || undefined, stableKey: initialState.stableKey || undefined, page });
  return <main className="corpus-lab">
      <header className="corpus-lab-header">
        <div><p className="corpus-lab-header__eyebrow">PALABRAS EN CONTEXTO</p><h1>语料</h1><p className="corpus-lab-header__description">在真实内容里，查清一个词怎么用。</p></div>
        <span className="corpus-lab-header__index" lang="es">Leer. Escuchar. Comparar.</span>
      </header>
      <CorpusWorkbench initialState={parsed.success ? parsed.data : corpusExamplesQuerySchema.parse({})} />
      {assessmentKey ? <LexicalAssessment assessmentKey={assessmentKey} /> : null}
  </main>;
}
