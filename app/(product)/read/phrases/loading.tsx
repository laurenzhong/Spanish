import { PhraseShelfSkeleton } from "./phrase-shelf-skeleton";

export default function PhrasesLoading() {
  return (
    <>
      <header className="lexicon-shelf__header">
        <div><h1>短语</h1><p className="page-lede">正式表达、自然变体和实际语用会在同一处保留。</p></div>
        <p>浏览、保存和筛选不会形成口语证据。</p>
      </header>
      <PhraseShelfSkeleton />
    </>
  );
}
