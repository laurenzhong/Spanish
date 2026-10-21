import { PhraseShelfSkeleton } from "./phrase-shelf-skeleton";
import "./phrasebook.css";

export default function PhrasesLoading() {
  return (
    <>
      <header className="phrasebook-header">
        <div><h1>短语</h1><p className="page-lede">让想说的话，顺口说出来。</p></div>
      </header>
      <PhraseShelfSkeleton />
    </>
  );
}
