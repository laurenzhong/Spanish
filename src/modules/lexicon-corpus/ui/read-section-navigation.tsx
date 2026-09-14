import Link from "next/link";

export function ReadSectionNavigation({ active }: Readonly<{ active: "articles" | "vocabulary" | "phrases" | "corpus" }>) {
  const links = [
    ["articles", "文章", "/read"],
    ["vocabulary", "词汇", "/read/vocabulary"],
    ["phrases", "短语", "/read/phrases"],
    ["corpus", "语料", "/read/corpus"],
  ] as const;
  return <nav className="read-section-navigation" aria-label="阅读内容类型">{links.map(([key, label, href]) => <Link key={key} href={href} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>;
}
