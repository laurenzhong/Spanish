import type { Metadata } from "next";
import Link from "next/link";

import { getArticles } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";

import { ReadShelf } from "./read-shelf";

export const metadata: Metadata = { title: "阅读" };

type ReadPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReadPage({ searchParams }: ReadPageProps) {
  const params = await searchParams;
  const search = first(params.search)?.trim() || undefined;
  const topic = first(params.topic)?.trim() || undefined;
  const savedOnly = first(params.saved) === "1";
  const result = await getArticles(new BundleArticleRepository(), {
    search,
    topic,
    savedOnly: false,
    cursor: first(params.cursor),
  });

  return (
    <div className="page-stack read-page">
      <header className="read-page__utility">
        <h1 className="sr-only">阅读</h1>
        <Link className="text-link" href="/learn">回到今天 <span aria-hidden="true">→</span></Link>
      </header>
      <ReadShelf result={result} search={search ?? ""} topic={topic ?? ""} savedOnly={savedOnly} />
    </div>
  );
}
