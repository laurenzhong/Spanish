import type { Metadata } from "next";

import { CorpusSearch, LexicalAssessment, ReadSectionNavigation } from "@/src/modules/lexicon-corpus";

export const metadata: Metadata = { title: "语料" };

type CorpusPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function CorpusPage({ searchParams }: CorpusPageProps) {
  const params = await searchParams;
  const assessmentKey = typeof params.assessment === "string" ? params.assessment.trim() : "";
  return <div className="page-stack read-page"><ReadSectionNavigation active="corpus" /><main><h1>语料</h1><p className="read-page__intro">在真实内容里查看词汇和短语的上下文。</p><CorpusSearch />{assessmentKey ? <LexicalAssessment assessmentKey={assessmentKey} /> : null}</main></div>;
}
