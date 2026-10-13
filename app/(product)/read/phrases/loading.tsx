import { PhraseShelfSkeleton } from "./phrase-shelf-skeleton";

export default function PhrasesLoading() {
  return (
    <>
      <header className="lexicon-shelf__header">
        <div><h1>短语</h1><p className="page-lede">语料片段与已审核短语会在同一处呈现。</p></div>
        <p>浏览、保存和筛选不会形成口语证据。</p>
      </header>
      <PhraseShelfSkeleton />
    </>
  );
}
