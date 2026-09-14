import type { Metadata } from "next";

import { ReadSectionNavigation } from "@/src/modules/lexicon-corpus";

export const metadata: Metadata = { title: "语料" };

export default function CorpusPage() {
  return <div className="page-stack read-page"><ReadSectionNavigation active="corpus" /><main><h1>语料</h1><div className="lexicon-empty"><h2>语料查询即将接入</h2><p>当前先从词汇和短语页整理跨来源出现记录；KWIC 查询和文字考察将在下一阶段开放。</p></div></main></div>;
}
